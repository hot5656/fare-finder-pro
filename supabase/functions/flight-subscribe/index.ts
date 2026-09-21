// flight-subscribe: the only way a signed-in user creates or changes a
// flight.subscriptions row (M1's direct client upsert is gone in M2).
//
// Called from the browser with the user's own JWT (verify_jwt = true), NOT a
// service-role bearer. Body: { plan_name: string, target_price: number }.
//
//   no row / expired / pending_payment -> row = pending_payment + fresh
//       merchant_trade_no, respond text/html: an auto-submit form to ECPay.
//   active / cancelled (in grace), target_price change only -> plain update,
//       respond application/json, no new payment.
//
// This function only ever writes pending_payment (or a target_price on an
// already-paid row). Only the verified ECPay callbacks write `active`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allowedOrigin, buildCheckoutForm, ECPAY_AMOUNT, newTradeNo } from "../_shared/ecpay.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!Number.isInteger(ECPAY_AMOUNT) || ECPAY_AMOUNT <= 0) {
    console.error("ECPAY_AMOUNT is not a positive whole number");
    return json({ error: "payment is not configured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  // Identify the caller from their JWT; never trust an email/user_id in the body.
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user?.email) return json({ error: "unauthorized" }, 401);

  let body: { plan_name?: string; target_price?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const targetPrice = Number(body.target_price);
  if (!body.plan_name || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return json({ error: "plan_name and a positive target_price are required" }, 400);
  }

  // The route comes from our own table, not from the client.
  const { data: plan, error: planError } = await admin
    .from("routes")
    .select("plan_name, display_name, route")
    .eq("plan_name", body.plan_name)
    .maybeSingle();
  if (planError) {
    console.error("route lookup failed", planError);
    return json({ error: "lookup failed" }, 500);
  }
  if (!plan) return json({ error: "unknown plan" }, 400);

  const { data: existing, error: existingError } = await admin
    .from("subscriptions")
    .select("id, subscription_status")
    .eq("user_id", user.id)
    .eq("route", plan.route)
    .maybeSingle();
  if (existingError) {
    console.error("subscription lookup failed", existingError);
    return json({ error: "lookup failed" }, 500);
  }

  // Already paid (or paid-through in grace): just move the target price.
  if (existing && (existing.subscription_status === "active" || existing.subscription_status === "cancelled")) {
    const { error } = await admin
      .from("subscriptions")
      .update({ target_price: targetPrice, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      console.error("target price update failed", error);
      return json({ error: "update failed" }, 500);
    }
    return json({ status: existing.subscription_status, target_price: targetPrice });
  }

  // New, expired, or still-unpaid: (re)start checkout with a fresh trade number.
  const tradeNo = newTradeNo();
  const row = {
    user_id: user.id,
    email: user.email,
    plan_name: plan.plan_name,
    route: plan.route,
    target_price: targetPrice,
    currency: "TWD",
    subscription_status: "pending_payment",
    merchant_trade_no: tradeNo,
    current_period_end: null,
    updated_at: new Date().toISOString(),
  };
  const { error: writeError } = existing
    ? await admin.from("subscriptions").update(row).eq("id", existing.id)
    : await admin.from("subscriptions").insert(row);
  if (writeError) {
    console.error("pending_payment write failed", writeError);
    return json({ error: "could not start checkout" }, 500);
  }

  const html = await buildCheckoutForm({
    tradeNo,
    email: user.email,
    route: plan.route,
    itemName: `Flight Price Notifier ${plan.route} 月訂閱`,
    // Browsers always send Origin on this cross-origin POST; unknown -> "".
    siteOrigin: allowedOrigin(req.headers.get("Origin")),
  });
  return new Response(html, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
});
