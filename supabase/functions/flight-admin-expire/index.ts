// flight-admin-expire: an admin forces one cancelled subscription to expire now,
// instead of waiting for flight-parser to expire it after current_period_end.
// A testing aid: it only works while the admin setting force_expire_enabled is
// explicitly true (a missing row means off).
//
// Called with the admin's own JWT (verify_jwt = true). Body: { subscription_id }.
//   1. verify the caller is a real user, then check flight.admins (server-side --
//      never trust app_metadata.apps, see src/integrations/supabase/app-scope.ts)
//   2. check flight.settings.force_expire_enabled === true -- never trust that the
//      front-end only showed the button while the switch was on
//   3. cancelled -> expired with current_period_end = now, guarded on the status so
//      a row can only be flipped (and emailed) once, then the usual "expired" email
//
// There is nothing to stop at ECPay: a cancelled row was already cancelled there
// by flight-cancel-subscription.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendStatusEmail } from "../_shared/ecpay.ts";

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

  const { data: setting, error: settingError } = await admin
    .from("settings")
    .select("value")
    .eq("key", "force_expire_enabled")
    .maybeSingle();
  if (settingError) {
    console.error("failed to read force_expire_enabled", settingError);
    return json({ error: "failed to read setting" }, 500);
  }
  if (setting?.value !== true) return json({ error: "強制到期未開啟 force expire is off" }, 403);

  let subscriptionId: string | undefined;
  try {
    subscriptionId = ((await req.json()) as { subscription_id?: string }).subscription_id;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!subscriptionId) return json({ error: "subscription_id is required" }, 400);

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("subscriptions")
    .update({ subscription_status: "expired", current_period_end: nowIso, updated_at: nowIso })
    .eq("id", subscriptionId)
    .eq("subscription_status", "cancelled")
    .select("email, route");
  if (error) {
    console.error("force expire update failed", error);
    return json({ error: "force expire failed" }, 500);
  }
  const row = rows?.[0];
  if (!row) return json({ error: "只有 cancelled 的訂閱可以強制到期 only a cancelled subscription can be expired" }, 409);

  console.log(`force-expired subscription ${subscriptionId} (${row.route}) by admin ${user.id}`);
  sendStatusEmail({ event_type: "expired", email: row.email, route: row.route, reason: "period_ended" });
  return json({ status: "expired", current_period_end: nowIso });
});
