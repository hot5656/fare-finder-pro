-- /admin/users: list the accounts registered for this app, paged and searchable.
--
-- auth.users is shared with other apps (see docs/shared-supabase-auth.md), so the
-- list is filtered on raw_app_meta_data.apps containing this app's tag
-- ('fare-finder-pro', APP_NAME in src/integrations/supabase/app-scope.ts). That tag
-- is client-declared, which is fine here: it only decides which accounts to list,
-- not who may see them. Who may call is decided by flight.is_admin(), the same
-- choke point as the other admin reads; a non-admin gets an exception.
--
-- The browser cannot read auth.users, so this is SECURITY DEFINER and returns only
-- the columns the page shows (no metadata, no phone, no identities).
-- total_count is the full match count (window count), repeated on every row.

create or replace function flight.admin_list_app_users(
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean,
  subscription_count bigint,
  paying_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = flight, pg_temp
as $$
begin
  if not flight.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.created_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    exists (select 1 from flight.admins a where a.user_id = u.id),
    (select count(*) from flight.subscriptions s where s.user_id = u.id),
    -- Same "paying" rule as flight-parser: active, or cancelled inside the paid period.
    (select count(*) from flight.subscriptions s
      where s.user_id = u.id
        and (s.subscription_status = 'active'
          or (s.subscription_status = 'cancelled' and s.current_period_end >= now()))),
    count(*) over ()
  from auth.users u
  where coalesce(u.raw_app_meta_data->'apps', '[]'::jsonb) ? 'fare-finder-pro'
    and (coalesce(p_search, '') = ''
      or u.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by u.created_at desc, u.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function flight.admin_list_app_users(text, int, int) from public, anon;
grant execute on function flight.admin_list_app_users(text, int, int) to authenticated;

-- Verify after applying:
--   select proacl from pg_proc where oid = 'flight.admin_list_app_users'::regproc;
--     expect no `=X/` (PUBLIC) or anon entry; authenticated=X present.
--   As a non-admin (or the SQL editor, where auth.uid() is null) the call raises 'admin only'.
