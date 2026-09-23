// flight-admin-notify: an admin manually forces a price-drop notification for one
// subscription, bypassing flight-notification's 24h dedup floor.
//
// Called with the admin's own JWT (verify_jwt = true). Body: { subscription_id }.
//   1. verify the caller is a real user, then check flight.admins (server-side --
//      never trust app_metadata.apps, see src/integrations/supabase/app-scope.ts)
//   2. re-validate the subscription is currently paying and matching -- never trust
//      that the front-end button was only shown for a valid row
//   3. build a Match from the subscription + flight.routes.last_price (cached, no
//      live re-fetch) and hand it to flight-notification with force: true
//
// flight-notification stays the single place that renders the email, calls
// Resend, and writes notification_history.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  const { data: adminRow } = await admin
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow) return json({ error: "not an admin" }, 403);

  let subscriptionId: string | undefined;
  try {
    subscriptionId = ((await req.json()) as { subscription_id?: string }).subscription_id;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!subscriptionId) return json({ error: "subscription_id is required" }, 400);

  const { data: sub } = await admin
    .from("subscriptions")
    .select("*")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (!sub) return json({ error: "subscription not found" }, 404);

  const paying =
    sub.subscription_status === "active" ||
    (sub.subscription_status === "cancelled" &&
      !!sub.current_period_end &&
      new Date(sub.current_period_end) >= new Date());
  if (!paying) {
    return json({ error: "subscription is not currently paying", reason: "not_paying" }, 409);
  }

  const { data: route } = await admin
    .from("routes")
    .select("*")
    .eq("plan_name", sub.plan_name)
    .maybeSingle();
  if (!route || route.last_price == null) {
    return json({ error: "no known price for this route yet", reason: "no_price" }, 409);
  }
  if (Number(sub.target_price) < Number(route.last_price)) {
    return json({ error: "subscription does not currently match", reason: "not_matching" }, 409);
  }

  // Full offers cached by flight-parser ({ twd, usd } per source). Rows last
  // written before those columns existed fall back to the flat last_price_* fields.
  const v3 = route.last_offer_v3 as { twd: unknown; usd: unknown } | null;
  const v1 = route.last_offer_v1 as { twd: unknown; usd: unknown } | null;

  const match = {
    user_id: sub.user_id,
    email: sub.email,
    route: sub.route,
    plan_name: sub.plan_name,
    target_price: sub.target_price,
    compare_v1: v1 ?? null,
    cheapest: v3?.twd ?? {
      price: route.last_price,
      currency: route.last_price_currency ?? "TWD",
      airline: route.last_price_airline ?? "",
      depart_date: route.last_price_depart_date ?? "",
      return_date: "",
    },
    cheapest_usd: v3
      ? (v3.usd ?? null)
      : route.last_price_usd != null
        ? {
            price: route.last_price_usd,
            currency: route.last_price_usd_currency ?? "USD",
            airline: route.last_price_airline ?? "",
            depart_date: route.last_price_depart_date ?? "",
            return_date: "",
          }
        : null,
    // route.last_checked_at, not "now" -- this reuses the cached price, so it can
    // be stale by however long it's been since flight-parser last ran.
    checked_at: route.last_checked_at,
  };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/flight-notification`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ matches: [match], force: true, triggered_by: user.id }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: "notification dispatch failed" }, 502);
  return json(data);
});
