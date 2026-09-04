-- Generic, cross-app convention: any app sharing this Supabase project can tag
-- its signups by passing options: { data: { app: '<app-name>' } } to
-- supabase.auth.signUp() or supabase.auth.updateUser(). This trigger promotes
-- that value out of the user-editable raw_user_meta_data into the
-- tamper-proof raw_app_meta_data, keyed generically off whatever string is
-- passed (not hardcoded to 'fare-finder-pro'), so other apps can adopt the
-- identical convention later without touching this trigger.
--
-- Deliberately kept in the `flight` schema, not `public`, to keep this app's
-- footprint isolated from the shared public schema used by other apps in
-- this project. Independent of, and does not modify, the existing
-- on_auth_user_created / public.handle_new_user() trigger (different timing:
-- BEFORE vs AFTER INSERT), which is intentionally left untouched.
--
-- Fires on both INSERT (new account) and UPDATE OF raw_user_meta_data
-- (existing account gaining a new app, e.g. via updateUser after a
-- password-recovery-verified session or a matched-password sign-in).

create or replace function flight.tag_app_metadata_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_app text;
  existing_apps jsonb;
begin
  requested_app := new.raw_user_meta_data ->> 'app';
  if requested_app is null then
    return new;
  end if;

  existing_apps := new.raw_app_meta_data -> 'apps';
  if existing_apps is null or jsonb_typeof(existing_apps) != 'array' then
    existing_apps := '[]'::jsonb;
  end if;

  if not (existing_apps @> to_jsonb(requested_app)) then
    existing_apps := existing_apps || to_jsonb(requested_app);
  end if;

  new.raw_app_meta_data :=
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('apps', existing_apps);

  return new;
end;
$$;

comment on function flight.tag_app_metadata_on_signup() is
  'Promotes raw_user_meta_data.app (set via supabase.auth signUp/updateUser options.data.app) into a deduplicated app_metadata.apps array. Fires on both insert (new account) and update of raw_user_meta_data (existing account gaining a new app). Any app sharing this Supabase project may reuse this by passing options: { data: { app: "<its-own-app-name>" } }; needs no change to support additional apps.';

-- flight is a manually-created schema; unlike `public` it has no default
-- USAGE grant to PUBLIC. supabase_auth_admin is the role GoTrue uses for
-- auth.users writes — grant explicitly or the trigger fails at write time.
grant usage on schema flight to supabase_auth_admin;
grant execute on function flight.tag_app_metadata_on_signup() to supabase_auth_admin;

drop trigger if exists on_auth_user_created_tag_app_metadata on auth.users;
create trigger on_auth_user_created_tag_app_metadata
  before insert on auth.users
  for each row
  execute function flight.tag_app_metadata_on_signup();

drop trigger if exists on_auth_user_updated_tag_app_metadata on auth.users;
create trigger on_auth_user_updated_tag_app_metadata
  before update of raw_user_meta_data on auth.users
  for each row
  execute function flight.tag_app_metadata_on_signup();
