// flight-ecpay-return: ECPay's ReturnURL for the FIRST 定期定額 charge. This
// (with flight-ecpay-period) is the source of truth for "paid": a verified
// CheckMacValue + RtnCode "1" flips the row pending_payment -> active.
//
// ECPay's servers call this with no JWT, so it is deployed with
// verify_jwt = false (see supabase/config.toml). The CheckMacValue is the
// authentication. Must reply plain-text `1|OK` or ECPay retries.

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
  // Empty-string fields (CustomField3=, CustomField4=) are part of the hash.
  if (!(await verifyCheckMacValue(p))) {
    console.error("CMV mismatch", p.MerchantTradeNo);
    return fail("CheckMacValue error");
  }
  if (p.MerchantID !== ECPAY_MERCHANT_ID) return fail("MerchantID mismatch");
  console.log(`CMV verified: return ${p.MerchantTradeNo} RtnCode=${p.RtnCode} SimulatePaid=${p.SimulatePaid}`);

  // The stage 後台's 「模擬付款」 sends SimulatePaid=1: acknowledge it, but never
  // let a bare simulate activate anyone.
  if (p.SimulatePaid === "1") return ok();
  if (p.RtnCode !== "1") {
    console.error(`first charge failed: ${p.MerchantTradeNo} RtnCode=${p.RtnCode} ${p.RtnMsg}`);
    return ok(); // acknowledged; the row stays pending_payment
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  // CustomField1/2 (email/route) are the join key ECPay echoes back; the
  // trade number pins it to this checkout attempt.
  const { data: row, error } = await admin
    .from("subscriptions")
    .select("id, email, route, subscription_status")
    .eq("merchant_trade_no", p.MerchantTradeNo)
    .eq("email", p.CustomField1)
    .eq("route", p.CustomField2)
    .maybeSingle();
  if (error) {
    console.error("row lookup failed", error);
    return fail("lookup error"); // non-1|OK -> ECPay retries
  }
  if (!row) {
    console.error(`no subscription for trade ${p.MerchantTradeNo}`);
    return ok();
  }

  // Idempotent on the trade number + current state (Gwsr is empty on the
  // real recurring first-period callback, so it can't be the key).
  if (row.subscription_status === "active") return ok();

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const { error: updateError } = await admin
    .from("subscriptions")
    .update({
      subscription_status: "active",
      current_period_end: periodEnd.toISOString(),
      // The first charge is charge #1, so flight-ecpay-period's renewal #2 is new.
      total_success_times: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("merchant_trade_no", p.MerchantTradeNo);
  if (updateError) {
    console.error("activate failed", updateError);
    return fail("update error");
  }

  console.log(`activated ${p.MerchantTradeNo} until ${periodEnd.toISOString()}`);
  sendStatusEmail({
    event_type: "welcome",
    email: row.email,
    route: row.route,
    current_period_end: periodEnd.toISOString(),
  });
  return ok();
});
