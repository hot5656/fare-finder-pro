// flight-ecpay-period: ECPay's PeriodReturnURL — the 2nd charge onward.
// Verified CheckMacValue + RtnCode "1" keeps the row active and pushes
// current_period_end out by one period. A failed charge does NOT expire the
// row: ECPay retries and auto-terminates the series after 6 consecutive
// failures. Instead the user gets a one-time "payment failed" email, and
// flight-parser expires the row (with an "expired" email) if no renewal ever
// lands within its grace window.
//
// ECPay calls this with no JWT -> verify_jwt = false. Reply `1|OK`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
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

    // This charge covers the next month from now. A successful charge also
    // resets the "payment failed" flag so the next bad cycle emails again.
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        subscription_status: "active",
        current_period_end: periodEnd.toISOString(),
        payment_failed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .in("subscription_status", ["active", "pending_payment"]);
    if (updateError) {
      console.error("renewal update failed", updateError);
      return fail("update error");
    }
    return ok();
  }

  // Failed charge. ECPay keeps retrying, so leave the row's status alone.
  console.error(`renewal failed: ${p.MerchantTradeNo} RtnCode=${p.RtnCode} ${p.RtnMsg}`);

  // Every failed retry calls back, so only the first one per cycle emails: the
  // update matches only while payment_failed_at is null, which makes "first"
  // atomic even if two callbacks race. Only paying (active) rows are told.
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
      sendStatusEmail({
        event_type: "payment_failed",
        email: firstFailure.email,
        route: firstFailure.route,
        current_period_end: row.current_period_end,
      });
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
