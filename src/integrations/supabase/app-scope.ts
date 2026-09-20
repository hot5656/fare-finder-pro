// The value written to auth.users.raw_user_meta_data.app at signup and copied by the
// flight.tag_app_metadata_on_signup() Postgres trigger into app_metadata.apps.
// Must match exactly what the trigger reads/writes
// (supabase/migrations/20260904120000_flight_app_scoped_auth.sql).
//
// NOTE: this is a CLIENT-DECLARED tag, not a permission. The value starts life in
// raw_user_meta_data, which the signed-in user can edit
// (supabase.auth.updateUser({ data: { app } })), and the trigger copies it across — so any
// user can add any app name to their own `apps`. What is protected is only that a client
// cannot write app_metadata directly.
//
// So treat hasAppAccess() as a UI route guard ("this user says they use this app"), never as
// data authorization. Row access must key on auth.uid() (as flight's RLS policies do), not on
// `apps`.
export const APP_NAME = "fare-finder-pro";

export function hasAppAccess(appMetadata: Record<string, unknown> | undefined): boolean {
  const apps = appMetadata?.["apps"];
  return Array.isArray(apps) && apps.includes(APP_NAME);
}
