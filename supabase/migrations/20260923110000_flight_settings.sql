-- App-wide settings an admin can change from /admin. Key/value so later
-- switches don't each need a migration.
--
-- v1_compare_enabled (boolean, default true): whether flight-parser also polls
-- Travelpayouts v1 prices/cheap and the alert email lists it next to the v3
-- fare. Off: no v1 calls, no v1 block in the email. A missing row reads as true.
--
-- Reads: admins only, via the same flight.is_admin() choke point as the other
-- admin policies; the service-role functions bypass RLS. Writes: service role
-- only, through flight-admin-settings (which checks flight.admins itself).

create table flight.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table flight.settings enable row level security;

grant select, insert, update, delete on flight.settings to service_role;
-- The schema's default privileges also grant select to anon; admins read as
-- authenticated, so drop anon's inherited grant.
revoke select on flight.settings from anon;
grant select on flight.settings to authenticated;

create policy "admins can read settings"
  on flight.settings
  for select
  to authenticated
  using (flight.is_admin());

insert into flight.settings (key, value) values ('v1_compare_enabled', 'true');
