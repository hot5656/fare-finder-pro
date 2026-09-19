// flight-parser: scrapes each route's cheapest fare and hands matches off to
// flight-notification. Triggered every 30 min by pg_cron (see the M1 skill
// docs), or manually for testing.
//
// Env vars required (set via `supabase secrets set`):
//   TRAVELPAYOUTS_TOKEN   - Travelpayouts API token
//   TRAVELPAYOUTS_MARKER  - optional affiliate marker, appended to booking links
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Functions runtime.
//
// Deployed with verify_jwt = true (see supabase/config.toml), so the gateway
// rejects requests without a valid JWT. That accepts any project JWT (e.g. the
// anon key), so the exact service-role check below is what actually stops a
// random caller from triggering a scrape.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const TRAVELPAYOUTS_TOKEN = Deno.env.get("TRAVELPAYOUTS_TOKEN") as string;

const UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"; // some hosts behind Cloudflare 403 the default UA
const BATCH = 25;
// An `active` row whose current_period_end is this many days past with no
// renewal is treated as lapsed (ECPay retries failed charges over several days).
const RENEWAL_GRACE_DAYS = 7;

type Cheapest = {
  price: number;
  currency: string;
  airline: string;
  depart_date: string;
  return_date: string;
};

type Route = {
  plan_name: string;
  display_name: string;
  origin: string;
  destination: string;
  route: string;
};

type Subscription = {
  user_id: string;
  email: string;
  plan_name: string;
  route: string;
  target_price: number;
};

async function fetchCheapest(
  origin: string,
  destination: string,
  month: string,
  currency: string,
): Promise<Cheapest | null> {
  const q = new URLSearchParams({
    origin,
    destination,
    depart_date: month,
    currency,
    token: TRAVELPAYOUTS_TOKEN,
  });
  const res = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?${q}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`travelpayouts ${currency} ${origin}-${destination}: HTTP ${res.status}`);
    return null;
  }
  const body = await res.json();
  if (!body.success || !body.data?.[destination]) return null;
  const offers = Object.values(body.data[destination]) as any[];
  if (!offers.length) return null;
  const best = offers.reduce((a, b) => (a.price < b.price ? a : b));
  // NOTE: the real keys are departure_at / return_at, not depart_date / return_date.
  return {
    price: best.price,
    currency: currency.toUpperCase(),
    airline: best.airline,
    depart_date: best.departure_at,
    return_date: best.return_at,
  };
}

function nextMonth(): string {
  const now = new Date();
  // Date.UTC rolls month 12 over into January of the next year for us.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  const { data: routes, error: routesError } = await admin.from("routes").select("*");
  if (routesError) {
    console.error("failed to load routes", routesError);
    return Response.json({ error: routesError.message }, { status: 500 });
  }

  // M2 paywall. First retire subscriptions whose paid period has run out, and
  // tell each user once. Each update returns only the rows it actually flipped,
  // so a row can only ever trigger one "expired" email.
  const nowIso = new Date().toISOString();
  const lapsedBefore = new Date(Date.now() - RENEWAL_GRACE_DAYS * 86_400_000).toISOString();
  const expiredRows: Array<{ email: string; route: string; reason: "period_ended" | "payment_lapsed" }> = [];

  // 1) cancelled, and the period they paid for is over.
  const { data: endedCancelled, error: cancelledError } = await admin
    .from("subscriptions")
    .update({ subscription_status: "expired", updated_at: nowIso })
    .eq("subscription_status", "cancelled")
    .lt("current_period_end", nowIso)
    .select("email, route");
  if (cancelledError) console.error("failed to expire lapsed cancelled rows", cancelledError);
  for (const r of endedCancelled ?? []) expiredRows.push({ ...r, reason: "period_ended" });

  // 2) still `active`, but renewals stopped arriving. ECPay gives up after 6
  // consecutive failed charges without telling us, so the only signal is a
  // current_period_end that passed a while ago with no renewal to move it.
  const { data: endedActive, error: activeError } = await admin
    .from("subscriptions")
    .update({ subscription_status: "expired", updated_at: nowIso })
    .eq("subscription_status", "active")
    .lt("current_period_end", lapsedBefore)
    .select("email, route");
  if (activeError) console.error("failed to expire lapsed active rows", activeError);
  for (const r of endedActive ?? []) expiredRows.push({ ...r, reason: "payment_lapsed" });

  for (const r of expiredRows) {
    // Fire-and-forget; waitUntil lets it finish after we return. A failure here
    // is only logged: the row is already expired, so there is no retry.
    const p = fetch(`${SUPABASE_URL}/functions/v1/flight-status-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: "expired", ...r }),
    }).catch((e) => console.error(`expired email dispatch failed for ${r.route}`, e));
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  }
  if (expiredRows.length) console.log(`expired ${expiredRows.length} subscription(s)`);

  const month = nextMonth();
  const matches: Array<{
    user_id: string;
    email: string;
    route: string;
    plan_name: string;
    target_price: number;
    cheapest: Cheapest;
    cheapest_usd?: Cheapest | null;
  }> = [];

  for (const route of (routes ?? []) as Route[]) {
    const cheapest = await fetchCheapest(route.origin, route.destination, month, "TWD");
    if (!cheapest) {
      console.error(`skip ${route.route}: no TWD fare available`);
      continue;
    }
    console.log(`${route.route} ${month} cheapest ${cheapest.price} TWD`);

    const { error: lastPriceError } = await admin
      .from("routes")
      .update({
        last_price: cheapest.price,
        last_price_currency: cheapest.currency,
        last_checked_at: new Date().toISOString(),
      })
      .eq("plan_name", route.plan_name);
    if (lastPriceError) {
      console.error(`failed to record last_price for ${route.route}`, lastPriceError);
    }

    const cheapestUsd = await fetchCheapest(route.origin, route.destination, month, "USD").catch(
      (e) => {
        console.error(`USD fare fetch failed for ${route.route}`, e);
        return null;
      },
    );

    // ...then only serve paying users: active, or cancelled but still inside
    // the period they paid for. pending_payment / expired are never emailed.
    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("*")
      .eq("route", route.route)
      .or(
        `subscription_status.eq.active,and(subscription_status.eq.cancelled,current_period_end.gte.${nowIso})`,
      );
    if (subsError) {
      console.error(`failed to load subscriptions for ${route.route}`, subsError);
      continue;
    }

    for (const sub of (subs ?? []) as Subscription[]) {
      if (Number(sub.target_price) >= cheapest.price) {
        matches.push({
          user_id: sub.user_id,
          email: sub.email,
          route: route.route,
          plan_name: sub.plan_name,
          target_price: sub.target_price,
          cheapest,
          cheapest_usd: cheapestUsd,
        });
      }
    }
  }

  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    // Fire-and-forget: don't await the full response, so a slow email batch
    // never makes this cron tick time out. A batch that fails outright just
    // gets retried on the next scheduled run since no history row was written.
    fetch(`${SUPABASE_URL}/functions/v1/flight-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ matches: batch }),
    }).catch((e) => console.error("notify batch dispatch failed", e));
  }

  return Response.json({ routes: routes?.length ?? 0, matches: matches.length });
});
