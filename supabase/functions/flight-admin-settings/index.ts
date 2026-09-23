// flight-admin-settings: an admin changes an app-wide setting in flight.settings.
//
// Called with the admin's own JWT (verify_jwt = true). Body: { key, value }.
// The caller must be in flight.admins (checked server-side, never from
// app_metadata.apps), and only keys listed in SETTINGS are accepted, each with
// its expected value type. Reads go straight from /admin through RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

// key -> typeof its value
const SETTINGS: Record<string, "boolean"> = {
  v1_compare_enabled: "boolean",
};

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

  let body: { key?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { key, value } = body;
  if (!key || !(key in SETTINGS)) return json({ error: "unknown setting" }, 400);
  if (typeof value !== SETTINGS[key]) {
    return json({ error: `value must be a ${SETTINGS[key]}` }, 400);
  }

  const { data, error } = await admin
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: user.id })
    .select("key, value, updated_at")
    .single();
  if (error) {
    console.error(`failed to save setting ${key}`, error);
    return json({ error: "failed to save setting" }, 500);
  }
  console.log(`setting ${key} = ${JSON.stringify(value)} by ${user.id}`);
  return json(data);
});
