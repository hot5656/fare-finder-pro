-- Admin allowlist + read-only admin dashboard access.
--
-- flight.admins is a server-side allowlist (per docs/m1-session-handoff.md, backlog
-- item B-1): app_metadata.apps is a client-declared UI tag and must never gate real
-- data access (see src/integrations/supabase/app-scope.ts). This table has no
-- grants/policies for authenticated/anon at all -- mirroring notification_history's
-- existing lockdown -- so it stays opaque to the client even if a future policy on
-- another table is written carelessly. The only way to check admin status is through
-- flight.is_admin(), a SECURITY DEFINER function that is the single choke point.

create table flight.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table flight.admins enable row level security;
-- Deliberately no policies for authenticated/anon.

grant select, insert, update, delete on flight.admins to service_role;
-- 20260917140000_flight_schema_grants.sql set "alter default privileges in schema
-- flight grant select on tables to authenticated, anon" -- that applies to any new
-- table in this schema, including this one, regardless of what we grant above.
-- RLS (no policy for authenticated/anon) already blocks every row either way, but
-- revoke the inherited grant too so the table has no client-facing footprint at all.
revoke select on flight.admins from authenticated, anon;

create or replace function flight.is_admin()
returns boolean
language sql
stable
security definer
set search_path = flight, pg_temp
as $$
  select exists (select 1 from flight.admins where user_id = auth.uid());
$$;

revoke all on function flight.is_admin() from public;
grant execute on function flight.is_admin() to authenticated;

-- Additive: the existing "select own subscriptions" policy is untouched: RLS
-- policies for the same command OR together, so an admin sees their own row via
-- the old policy and everyone else's via this one.
create policy "admins can read all subscriptions"
  on flight.subscriptions
  for select
  to authenticated
  using (flight.is_admin());

-- notification_history had zero authenticated grants/policies before this
-- migration (service_role only). Grant select so PostgREST will run the query at
-- all, then gate every row with the same is_admin() choke point: a non-admin's
-- query runs but returns zero rows (no matching policy), never a 401/403.
grant select on flight.notification_history to authenticated;

create policy "admins can read all notification_history"
  on flight.notification_history
  for select
  to authenticated
  using (flight.is_admin());

-- flight.routes is already "select true" for authenticated -- no change needed.
