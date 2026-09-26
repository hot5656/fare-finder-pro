// flight-admin-routes: an admin adds, enables or disables a route in
// flight.routes from /admin/routes.
//
// Called with the admin's own JWT (verify_jwt = true); the caller must be in
// flight.admins (checked server-side, never from app_metadata.apps). Body:
//
//   { action: "preview", origin, destination, origin_code?, destination_code? }
//       origin / destination are what the admin typed ("台北", "大阪", "OSA").
//       Resolves both to IATA codes and runs the parser's own live fare query
//       (next month, round trip, TWD). No write. 422 when a place is unknown
//       or no fare is found, 409 when the route already exists. The *_code
//       fields pick another candidate when a name matched several places.
//   { action: "create", origin, destination, origin_code, destination_code }
//       The same search as the preview, re-run here (its answer is not
//       trusted): the codes must still be among the matched places, and the
//       Chinese names are taken from those matches, never from the client. Then
//       re-runs the fare query and only inserts when a fare comes back, with
//       that fare as last_price.
//   { action: "update", plan_name, is_active }
//       The on/off switch only. Codes and names never change after creation:
//       existing subscriptions and history store the "TPE-TYO" route string,
//       and subscribers signed up under the name they saw.
//
// Routes are never deleted (subscriptions reference them); disabling one is
// handled by flight-subscribe (no new sign-ups) and flight-parser (keeps
// checking while anyone still pays for it).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchCheapestV3,
  nextMonth,
  type Place,
  resolvePlace,
  safe,
} from "../_shared/travelpayouts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const INVALID = "條件不正確，請重新輸入";
const IATA = /^[A-Z]{3}$/;

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

const displayName = (origin: string, destination: string) => `${origin} ✈ ${destination}`;

type Body = {
  action?: string;
  origin?: string;
  destination?: string;
  origin_code?: string;
  destination_code?: string;
  origin_name?: unknown;
  destination_name?: unknown;
  plan_name?: string;
  is_active?: unknown;
};

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

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const routeExists = async (origin: string, destination: string) => {
    const { data } = await admin
      .from("routes")
      .select("plan_name, display_name")
      .eq("origin", origin)
      .eq("destination", destination)
      .maybeSingle();
    return data;
  };

  // What the admin typed -> candidate places, with the one to use picked by
  // code (or the best match). Preview and create both go through this, so a
  // route's names always come from the search, never from the client.
  const resolve = async (
    originInput: string,
    destinationInput: string,
    originCode?: string,
    destinationCode?: string,
  ) => {
    const [originCandidates, destinationCandidates] = await Promise.all([
      resolvePlace(originInput),
      resolvePlace(destinationInput),
    ]);
    const pick = (list: Place[], code?: string) =>
      (code && list.find((p) => p.code === code)) || list[0];
    return {
      originCandidates,
      destinationCandidates,
      origin: pick(originCandidates, originCode) as Place | undefined,
      destination: pick(destinationCandidates, destinationCode) as Place | undefined,
    };
  };

  if (body.action === "preview") {
    if (typeof body.origin !== "string" || typeof body.destination !== "string") {
      return json({ error: INVALID }, 400);
    }
    const { origin, destination, originCandidates, destinationCandidates } = await resolve(
      body.origin,
      body.destination,
      typeof body.origin_code === "string" ? body.origin_code.toUpperCase() : undefined,
      typeof body.destination_code === "string" ? body.destination_code.toUpperCase() : undefined,
    );
    if (!origin || !destination) {
      return json(
        {
          error: INVALID,
          reason: !origin ? "origin_not_found" : "destination_not_found",
          origin_candidates: originCandidates,
          destination_candidates: destinationCandidates,
        },
        422,
      );
    }
    if (origin.code === destination.code) {
      return json({ error: INVALID, reason: "same_place" }, 422);
    }
    const existing = await routeExists(origin.code, destination.code);
    if (existing) {
      return json(
        { error: `此航線已存在：${existing.display_name}`, reason: "exists", origin, destination },
        409,
      );
    }

    const month = nextMonth();
    const offer = await safe(
      `preview v3 TWD ${origin.code}-${destination.code}`,
      fetchCheapestV3(origin.code, destination.code, month, "TWD"),
    );
    const result = {
      origin,
      destination,
      origin_candidates: originCandidates,
      destination_candidates: destinationCandidates,
      month,
    };
    if (!offer) return json({ ...result, error: INVALID, reason: "no_fare" }, 422);
    return json({ ...result, offer });
  }

  if (body.action === "create") {
    const originCode = String(body.origin_code ?? "").toUpperCase();
    const destinationCode = String(body.destination_code ?? "").toUpperCase();
    if (
      typeof body.origin !== "string" ||
      typeof body.destination !== "string" ||
      !IATA.test(originCode) ||
      !IATA.test(destinationCode) ||
      originCode === destinationCode
    ) {
      return json({ error: INVALID }, 400);
    }
    // The codes must still be what the search finds for the typed places; the
    // names come from that same match.
    const { origin, destination } = await resolve(
      body.origin,
      body.destination,
      originCode,
      destinationCode,
    );
    if (origin?.code !== originCode || destination?.code !== destinationCode) {
      return json({ error: INVALID, reason: "place_mismatch" }, 422);
    }
    const originName = origin.name;
    const destinationName = destination.name;
    const existing = await routeExists(originCode, destinationCode);
    if (existing) return json({ error: `此航線已存在：${existing.display_name}` }, 409);

    // The same query flight-parser runs every 30 minutes: no fare now means the
    // route would never alert, so it is not saved.
    const month = nextMonth();
    const [cheapest, cheapestUsd] = await Promise.all([
      safe(`create v3 TWD`, fetchCheapestV3(originCode, destinationCode, month, "TWD")),
      safe(`create v3 USD`, fetchCheapestV3(originCode, destinationCode, month, "USD")),
    ]);
    if (!cheapest) return json({ error: INVALID, reason: "no_fare" }, 422);

    const checkedAt = new Date().toISOString();
    const { data, error } = await admin
      .from("routes")
      .insert({
        plan_name: `${originCode}-${destinationCode}`.toLowerCase(),
        display_name: displayName(originName, destinationName),
        origin: originCode,
        destination: destinationCode,
        origin_name: originName,
        destination_name: destinationName,
        is_active: true,
        // Same fields flight-parser writes, so the route shows a price at once.
        last_price: cheapest.price,
        last_price_currency: cheapest.currency,
        last_price_depart_date: cheapest.depart_date,
        last_price_airline: cheapest.airline,
        last_price_usd: cheapestUsd?.price ?? null,
        last_price_usd_currency: cheapestUsd?.currency ?? null,
        last_offer_v3: { twd: cheapest, usd: cheapestUsd },
        last_offer_v1: null,
        last_checked_at: checkedAt,
      })
      .select("*")
      .single();
    if (error) {
      // 23505: unique violation (a parallel create of the same route).
      if (error.code === "23505") return json({ error: "此航線已存在" }, 409);
      console.error("route insert failed", error);
      return json({ error: "failed to save route" }, 500);
    }
    console.log(`route ${data.route} created by admin ${user.id} at ${cheapest.price} TWD`);
    return json(data);
  }

  if (body.action === "update") {
    if (!body.plan_name) return json({ error: "plan_name is required" }, 400);
    if (body.origin_name !== undefined || body.destination_name !== undefined) {
      return json({ error: "航線名稱建立後不可修改 / Route names cannot be changed" }, 400);
    }
    if (typeof body.is_active !== "boolean") {
      return json({ error: "is_active must be a boolean" }, 400);
    }
    const { data: current } = await admin
      .from("routes")
      .select("plan_name")
      .eq("plan_name", body.plan_name)
      .maybeSingle();
    if (!current) return json({ error: "unknown route" }, 404);

    const patch = { is_active: body.is_active };

    const { data, error } = await admin
      .from("routes")
      .update(patch)
      .eq("plan_name", body.plan_name)
      .select("*")
      .single();
    if (error) {
      console.error(`route update failed for ${body.plan_name}`, error);
      return json({ error: "failed to update route" }, 500);
    }
    console.log(`route ${data.route} updated by admin ${user.id}: ${JSON.stringify(patch)}`);
    return json(data);
  }

  return json({ error: "unknown action" }, 400);
});
