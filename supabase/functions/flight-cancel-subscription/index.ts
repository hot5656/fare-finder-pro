// flight-cancel-subscription: a signed-in user cancels their monthly charge.
//
// Called with the user's own JWT (verify_jwt = true). Body: { plan_name }.
//   1. tell ECPay to stop future charges (CreditCardPeriodAction, Action=Cancel)
//   2. subscription_status -> 'cancelled' (a grace state, NOT 'expired'):
//      current_period_end is kept so alerts continue until the paid month ends
//   3. hand a "cancel" email to flight-status-notification
// A free row (payment_method 'free') skips ECPay and goes straight to 'expired'.
//
// If ECPay refuses the cancel for a real reason we return an error and leave
// the row untouched — otherwise the user could be charged with no service. But if
// ECPay says there is nothing left to stop (see NOTHING_TO_STOP) the user must still
// be able to cancel on our side, otherwise they are stuck `active`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkMacValue,
  ECPAY_MERCHANT_ID,
  PERIOD_ACTION_URL,
  sendStatusEmail,
} from "../_shared/ecpay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ECPay answers a cancel with these codes when there is nothing left to stop
// charging, so we cancel locally instead of failing:
//   90100150 不存在的訂單編號  - no such order (a checkout the user never finished)
//   90100149 該訂單狀態為停用中 - already deactivated: ECPay ends a series by itself when
//            every scheduled charge is done, after 6 consecutive failures, or when the
//            card expires, and it tells us nothing when it does.
// Any OTHER rejection is a real failure: 502, row untouched.
const NOTHING_TO_STOP = new Set(["90100150", "90100149"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let planName: string | undefined;
  try {
    planName = ((await req.json()) as { plan_name?: string }).plan_name;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!planName) return json({ error: "plan_name is required" }, 400);

  const { data: row, error } = await admin
    .from("subscriptions")
    .select("id, email, route, subscription_status, payment_method, merchant_trade_no, current_period_end")
    .eq("user_id", user.id)
    .eq("plan_name", planName)
    .maybeSingle();
  if (error) {
    console.error("row lookup failed", error);
    return json({ error: "lookup failed" }, 500);
  }
  if (!row) return json({ error: "no subscription for that plan" }, 404);
  if (row.subscription_status === "cancelled") {
    return json({ status: "cancelled", current_period_end: row.current_period_end });
  }
  if (row.subscription_status !== "active" && row.subscription_status !== "pending_payment") {
    return json({ error: `nothing to cancel (status: ${row.subscription_status})` }, 409);
  }

  // Free rows (payment_required was off) have nothing at ECPay and no paid
  // period to honour: cancelling ends them now.
  if (row.payment_method === "free" && row.subscription_status === "active") {
    const nowIso = new Date().toISOString();
    const { error: freeError } = await admin
      .from("subscriptions")
      .update({ subscription_status: "expired", current_period_end: nowIso, updated_at: nowIso })
      .eq("id", row.id)
      .eq("subscription_status", "active");
    if (freeError) {
      console.error("free cancel update failed", freeError);
      return json({ error: "cancel failed" }, 500);
    }
    sendStatusEmail({ event_type: "cancel", email: row.email, route: row.route, free: true });
    return json({ status: "expired", current_period_end: nowIso });
  }

  if (row.merchant_trade_no) {
    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: row.merchant_trade_no,
      Action: "Cancel",
      TimeStamp: String(Math.floor(Date.now() / 1000)),
    };
    params.CheckMacValue = await checkMacValue(params);

    const res = await fetch(PERIOD_ACTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const text = await res.text();
    const result = new URLSearchParams(text);
    const rtnCode = result.get("RtnCode");
    console.log(`ECPay cancel ${row.merchant_trade_no}: HTTP ${res.status} RtnCode=${rtnCode} ${result.get("RtnMsg")}`);
    if (rtnCode !== "1" && !NOTHING_TO_STOP.has(rtnCode ?? "")) {
      console.error("ECPay cancel rejected", text.slice(0, 300));
      return json({ error: "ECPay could not cancel the subscription", detail: result.get("RtnMsg") ?? text.slice(0, 200) }, 502);
    }
  }

  // Pre-period-tracking rows (active with no end date): give them a month so
  // the parser doesn't expire them the instant they cancel.
  let periodEnd = row.current_period_end as string | null;
  if (!periodEnd) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    periodEnd = d.toISOString();
  }

  const { error: updateError } = await admin
    .from("subscriptions")
    .update({
      subscription_status: "cancelled",
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updateError) {
    console.error("cancel update failed", updateError);
    return json({ error: "cancel recorded at ECPay but the update failed" }, 500);
  }

  sendStatusEmail({
    event_type: "cancel",
    email: row.email,
    route: row.route,
    current_period_end: periodEnd,
  });
  return json({ status: "cancelled", current_period_end: periodEnd });
});
