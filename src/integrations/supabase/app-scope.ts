// The value written to auth.users.raw_user_meta_data.app at signup and
// promoted by the flight.tag_app_metadata_on_signup() Postgres trigger into
// the tamper-proof app_metadata.apps array. Must match exactly what the
// trigger reads/writes (supabase/migrations/20260904120000_flight_app_scoped_auth.sql).
export const APP_NAME = "fare-finder-pro";

export function hasAppAccess(appMetadata: Record<string, unknown> | undefined): boolean {
  const apps = appMetadata?.["apps"];
  return Array.isArray(apps) && apps.includes(APP_NAME);
}
