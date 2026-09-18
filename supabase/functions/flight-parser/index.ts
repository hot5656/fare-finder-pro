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

    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("*")
      .eq("route", route.route);
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
