-- Hardening and honest documentation for flight.tag_app_metadata_on_signup().
--
-- Migration 20260904120000 created this trigger function. It is already applied, so it is
-- left untouched (applied migrations are history); this migration corrects two things.
--
-- 1. EXECUTE privilege.
--    The function is SECURITY DEFINER and still carried the default EXECUTE grant to PUBLIC
--    (proacl `=X/postgres`), which the Supabase advisor flags as "executable by anon /
--    authenticated". It is not exploitable today: Postgres refuses to call a trigger function
--    directly ("trigger functions can only be called as triggers") and PostgREST does not
--    expose it (POST /rest/v1/rpc/tag_app_metadata_on_signup as anon -> 404 PGRST202). But
--    nothing needs anon or authenticated to hold EXECUTE, so remove it. The explicit grant to
--    supabase_auth_admin — the role GoTrue writes auth.users with — is kept.
--
-- 2. The description of what the tag means.
--    The M0 migration and function comment call `app_metadata.apps` "tamper-proof". Only half
--    of that is true: a client cannot write app_metadata directly, but the tag's SOURCE,
--    raw_user_meta_data.app, is user-editable and this trigger copies it across on both
--    insert and update. Any signed-in user can add any app name to their own `apps` with
--    updateUser({ data: { app } }). Nothing in the database authorizes on it (no RLS policy
--    or function references app_metadata; flight's policies use auth.uid()); the only consumers
--    are front-end route guards. It is a convenience tag, not an authorization boundary.
--
-- Idempotent: REVOKE of a privilege that is not held and COMMENT ON are both safe to re-run.

revoke execute on function flight.tag_app_metadata_on_signup() from public, anon, authenticated;

comment on function flight.tag_app_metadata_on_signup() is
  'Copies raw_user_meta_data.app (set via supabase.auth signUp/updateUser options.data.app) into a deduplicated app_metadata.apps array. Fires on insert (new account) and on update of raw_user_meta_data. The tag is CLIENT-DECLARED: raw_user_meta_data is user-editable, so any signed-in user can add any app name to their own apps. It is a convenience tag for UI route guards, NOT an authorization boundary: never use app_metadata.apps in RLS policies or other data-access decisions (key on auth.uid() instead). Any app sharing this Supabase project may reuse it by passing options: { data: { app: "<its-own-app-name>" } }.';

-- Verify after applying:
--   select proacl from pg_proc where oid = 'flight.tag_app_metadata_on_signup'::regproc;
--     expect {postgres=X/postgres,supabase_auth_admin=X/postgres} — no `=X/postgres` entry.
--   Then sign up (or updateUser with data.app for) a throwaway user and confirm
--   raw_app_meta_data.apps is still populated, i.e. the trigger still fires.
