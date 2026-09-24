// flight-parser: fetches each route's cheapest fare and hands matches off to
// flight-notification. Alerts trigger on Travelpayouts v3 prices_for_dates;
// v1 prices/cheap is fetched alongside and only listed in the email, unless an
// admin switched that off (flight.settings v1_compare_enabled).
// Triggered every 30 min by pg_cron (see the M1 skill docs), or manually for
// testing.
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
import {
  type Cheapest,
  fetchCheapestV1,
  fetchCheapestV3,
  nextMonth,
  safe,
} from "../_shared/travelpayouts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const BATCH = 25;
// An `active` row whose current_period_end is this many days past with no
// renewal is treated as lapsed (ECPay retries failed charges over several days).
const RENEWAL_GRACE_DAYS = 7;

type OfferPair = { twd: Cheapest | null; usd: Cheapest | null };

type Route = {
  plan_name: string;
  display_name: string;
  origin: string;
  destination: string;
  route: string;
  is_active: boolean;
};

type Subscription = {
  user_id: string;
  email: string;
  plan_name: string;
  route: string;
  target_price: number;
};

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
  const expiredRows: Array<{
    email: string;
    route: string;
    reason: "period_ended" | "payment_lapsed" | "free_period_ended";
  }> = [];

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
    .eq("payment_method", "ecpay")
    .lt("current_period_end", lapsedBefore)
    .select("email, route");
  if (activeError) console.error("failed to expire lapsed active rows", activeError);
  for (const r of endedActive ?? []) expiredRows.push({ ...r, reason: "payment_lapsed" });

  // 3) free (payment_required was off): one month, no renewal to wait for,
  // so no grace period. Runs whatever the switch says now.
  const { data: endedFree, error: freeError } = await admin
    .from("subscriptions")
    .update({ subscription_status: "expired", updated_at: nowIso })
    .eq("subscription_status", "active")
    .eq("payment_method", "free")
    .lt("current_period_end", nowIso)
    .select("email, route");
  if (freeError) console.error("failed to expire ended free rows", freeError);
  for (const r of endedFree ?? []) expiredRows.push({ ...r, reason: "free_period_ended" });

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

  // Admin switch (/admin, flight.settings): off = don't poll v1 at all and leave
  // it out of the email. A missing row or a failed read keeps it on.
  const { data: v1Setting, error: settingError } = await admin
    .from("settings")
    .select("value")
    .eq("key", "v1_compare_enabled")
    .maybeSingle();
  if (settingError) console.error("failed to read v1_compare_enabled", settingError);
  const v1Enabled = v1Setting?.value !== false;

  const month = nextMonth();
  const matches: Array<{
    user_id: string;
    email: string;
    route: string;
    plan_name: string;
    target_price: number;
    cheapest: Cheapest;
    cheapest_usd?: Cheapest | null;
    compare_v1?: OfferPair | null;
    checked_at: string;
  }> = [];

  // Paying users: active, or cancelled but still inside the period they paid
  // for. pending_payment / expired are never emailed.
  const payingFilter = `subscription_status.eq.active,and(subscription_status.eq.cancelled,current_period_end.gte.${nowIso})`;

  for (const route of (routes ?? []) as Route[]) {
    const { origin, destination } = route;

    // An admin disabled this route (/admin/routes): keep serving whoever still
    // pays for it, and stop calling Travelpayouts once nobody does.
    if (route.is_active === false) {
      const { count, error: countError } = await admin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("route", route.route)
        .or(payingFilter);
      if (countError) console.error(`failed to count subscribers for ${route.route}`, countError);
      else if (!count) {
        console.log(`skip ${route.route}: disabled, no paying subscribers`);
        continue;
      }
    }

    const [cheapest, cheapestUsd, v1Twd, v1Usd] = await Promise.all([
      safe(`v3 TWD ${route.route}`, fetchCheapestV3(origin, destination, month, "TWD")),
      safe(`v3 USD ${route.route}`, fetchCheapestV3(origin, destination, month, "USD")),
      v1Enabled
        ? safe(`v1 TWD ${route.route}`, fetchCheapestV1(origin, destination, month, "TWD"))
        : null,
      v1Enabled
        ? safe(`v1 USD ${route.route}`, fetchCheapestV1(origin, destination, month, "USD"))
        : null,
    ]);
    // null = comparison switched off (no v1 block in the email); a pair with
    // twd: null = switched on but v1 had nothing (email says so).
    const compareV1: OfferPair | null = v1Enabled ? { twd: v1Twd, usd: v1Usd } : null;
    console.log(
      `${route.route} ${month} v3 ${cheapest ? `${cheapest.price} TWD ${cheapest.airline}${cheapest.flight_number ?? ""} transfers=${cheapest.transfers ?? "?"}` : "none"}` +
        ` | v1 ${!v1Enabled ? "off" : v1Twd ? `${v1Twd.price} TWD ${v1Twd.airline}${v1Twd.flight_number ?? ""}` : "none"}`,
    );
    // v3 is the trigger; without a v3 TWD fare there is nothing to alert on.
    if (!cheapest) {
      console.error(`skip ${route.route}: no v3 TWD fare available`);
      continue;
    }

    // Also persisted so flight-admin-notify (a manual, non-live-refetch send) can
    // render the same detailed email from this cached row.
    const checkedAt = new Date().toISOString();
    const { error: lastPriceError } = await admin
      .from("routes")
      .update({
        last_price: cheapest.price,
        last_price_currency: cheapest.currency,
        last_price_depart_date: cheapest.depart_date,
        last_price_airline: cheapest.airline,
        last_price_usd: cheapestUsd?.price ?? null,
        last_price_usd_currency: cheapestUsd?.currency ?? null,
        last_offer_v3: { twd: cheapest, usd: cheapestUsd },
        last_offer_v1: compareV1,
        last_checked_at: checkedAt,
      })
      .eq("plan_name", route.plan_name);
    if (lastPriceError) {
      console.error(`failed to record last_price for ${route.route}`, lastPriceError);
    }

    // ...then only serve paying users.
    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("*")
      .eq("route", route.route)
      .or(payingFilter);
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
          compare_v1: compareV1,
          checked_at: checkedAt,
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
