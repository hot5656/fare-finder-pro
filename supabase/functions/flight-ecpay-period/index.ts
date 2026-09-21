// flight-ecpay-period: ECPay's PeriodReturnURL — the 2nd charge onward.
// Verified CheckMacValue + RtnCode "1" keeps the row active, pushes
// current_period_end out by one period and emails a "renewal charged" notice
// (once per charge, see below). A failed charge does NOT expire the
// row: ECPay retries and auto-terminates the series after 6 consecutive
// failures. Instead the user gets a one-time "payment failed" email, and
// flight-parser expires the row (with an "expired" email) if no renewal ever
// lands within its grace window.
//
// ECPay calls this with no JWT -> verify_jwt = false. Reply `1|OK`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ECPAY_AMOUNT,
  ECPAY_MERCHANT_ID,
  fail,
  ok,
  parseCallback,
  sendStatusEmail,
  verifyCheckMacValue,
} from "../_shared/ecpay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const p = await parseCallback(req);
  if (!(await verifyCheckMacValue(p))) {
    console.error("CMV mismatch", p.MerchantTradeNo);
    return fail("CheckMacValue error");
  }
  if (p.MerchantID !== ECPAY_MERCHANT_ID) return fail("MerchantID mismatch");
  console.log(
    `CMV verified: period ${p.MerchantTradeNo} RtnCode=${p.RtnCode} ` +
      `TotalSuccessTimes=${p.TotalSuccessTimes} ExecTimes=${p.ExecTimes} SimulatePaid=${p.SimulatePaid}`,
  );

  if (p.SimulatePaid === "1") return ok(); // see flight-ecpay-return

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  const { data: row, error } = await admin
    .from("subscriptions")
    .select("id, subscription_status, current_period_end")
    .eq("merchant_trade_no", p.MerchantTradeNo)
    .maybeSingle();
  if (error) {
    console.error("row lookup failed", error);
    return fail("lookup error");
  }
  if (!row) {
    console.error(`no subscription for trade ${p.MerchantTradeNo}`);
    return ok();
  }

  if (p.RtnCode === "1") {
    // A renewal that lands after a cancel must not resurrect the row.
    if (row.subscription_status === "cancelled" || row.subscription_status === "expired") return ok();

    // Known gap (K-9 in docs/test-report.md): the "every scheduled execution used"
    // check further down only runs for FAILED callbacks. If the LAST charge of a
    // series succeeds (TotalSuccessTimes >= ExecTimes) the row stays `active` with a
    // fresh current_period_end, and flight-parser only expires it once that date is
    // RENEWAL_GRACE_DAYS in the past. Harmless in production: checkout sets
    // ExecTimes=999 (monthly, ~83 years), so this needs a short test series
    // (PeriodType=D, ExecTimes=2) or a finite plan we don't sell today.

    // This charge covers the next month from now. A successful charge also
    // resets the "payment failed" flag so the next bad cycle emails again.
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // ECPay resends this callback until it gets `1|OK`, so "email on every
    // success" would double-send. TotalSuccessTimes is the running count of
    // successful charges: only a callback whose count is larger than the one we
    // last stored is a NEW charge. The guard is part of the update itself, so
    // "is this new?" and "record it" are one atomic step even if two copies race.
    const chargeNo = Number(p.TotalSuccessTimes);
    const haveCount = Number.isFinite(chargeNo) && chargeNo > 0;

    let update = admin
      .from("subscriptions")
      .update({
        subscription_status: "active",
        current_period_end: periodEnd.toISOString(),
        payment_failed_at: null,
        // undefined is dropped from the payload: without a usable count we leave
        // the stored one alone.
        total_success_times: haveCount ? chargeNo : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .in("subscription_status", ["active", "pending_payment"]);
    if (haveCount) update = update.or(`total_success_times.is.null,total_success_times.lt.${chargeNo}`);

    const { data: renewed, error: updateError } = await update
      .select("email, route, current_period_end")
      .maybeSingle();
    if (updateError) {
      console.error("renewal update failed", updateError);
      return fail("update error");
    }
    if (!haveCount) {
      // Can't tell a new charge from a resend, so don't risk a duplicate email.
      console.error(`renewal ${p.MerchantTradeNo}: no usable TotalSuccessTimes (${p.TotalSuccessTimes}), period extended without an email`);
      return ok();
    }
    if (!renewed) {
      console.log(`renewal ${p.MerchantTradeNo} charge #${chargeNo} already processed, no email`);
      return ok();
    }

    sendStatusEmail({
      event_type: "renewed",
      email: renewed.email,
      route: renewed.route,
      current_period_end: renewed.current_period_end,
      amount: Number(p.Amount || p.amount) || ECPAY_AMOUNT,
      charge_no: chargeNo,
    });
    return ok();
  }

  // Failed charge. ECPay keeps retrying, so leave the row's status alone.
  console.error(`renewal failed: ${p.MerchantTradeNo} RtnCode=${p.RtnCode} ${p.RtnMsg}`);

  // Every failed retry calls back, so only the first one per cycle emails: the
  // update matches only while payment_failed_at is null, which makes "first"
  // atomic even if two callbacks race. Only paying (active) rows are told.
  //
  // Known quirk (K-7 in docs/test-report.md): when this same failed callback also
  // exhausts the series (the ExecTimes block below), the user gets BOTH this "payment
  // failed, we will retry" mail and the "subscription ended" mail, which contradict
  // each other. Only reachable when TotalSuccessTimes >= ExecTimes, so never with the
  // production ExecTimes=999. If a finite plan is ever sold, compute that condition
  // first and skip this mail when it holds.
  if (row.subscription_status === "active") {
    const { data: firstFailure, error: flagError } = await admin
      .from("subscriptions")
      .update({ payment_failed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("subscription_status", "active")
      .is("payment_failed_at", null)
      .select("email, route")
      .maybeSingle();
    if (flagError) {
      console.error("failed to record payment failure", flagError);
    } else if (firstFailure) {
      sendStatusEmail(
        {
          event_type: "payment_failed",
          email: firstFailure.email,
          route: firstFailure.route,
          current_period_end: row.current_period_end,
        },
        // The flag above is set BEFORE the mail goes out (K-8 in docs/test-report.md). If
        // the mail is then rejected, release it: we still answer ECPay `1|OK`, but ECPay
        // keeps calling back on each failed retry (up to 6), so the next callback gets
        // to try the mail again instead of the notice being lost for the whole cycle.
        // A permanently bad address just costs a few extra rejected sends.
        async () => {
          const { error } = await admin
            .from("subscriptions")
            .update({ payment_failed_at: null })
            .eq("id", row.id);
          if (error) console.error("failed to release payment_failed_at after a rejected mail", error);
        },
      );
    }
  }

  // If ECPay says every scheduled execution has been used, the series is over.
  // (A run of 6 failures ends it too, but ECPay doesn't tell us — flight-parser
  // catches that case when current_period_end passes without a renewal.)
  const exec = Number(p.ExecTimes);
  const done = Number(p.TotalSuccessTimes);
  if (Number.isFinite(exec) && Number.isFinite(done) && exec > 0 && done >= exec) {
    // The .neq makes this once-only: only the call that actually flips the row
    // gets a result back, and only that call sends the email.
    const { data: ended } = await admin
      .from("subscriptions")
      .update({ subscription_status: "expired", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .neq("subscription_status", "expired")
      .select("email, route")
      .maybeSingle();
    if (ended) {
      sendStatusEmail({
        event_type: "expired",
        email: ended.email,
        route: ended.route,
        reason: "payment_lapsed",
      });
    }
  }
  return ok();
});
