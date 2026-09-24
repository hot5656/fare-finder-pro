-- Admins add routes from /admin (flight-admin-routes) instead of by migration.
--
-- origin_name / destination_name: the Chinese city names the admin typed (or
-- Travelpayouts returned), stored next to the IATA codes; display_name is still
-- what the UI and emails show and is built from them ("台北 ✈ 大阪").
--
-- is_active: off = hidden from new subscribers and refused by flight-subscribe.
-- Existing paying subscribers keep their alerts until they expire, so rows are
-- never deleted (subscriptions.plan_name references this table).
--
-- Writes stay service-role only; the existing "routes are readable" policy is
-- unchanged because a subscriber must still see a disabled route they hold.

alter table flight.routes
  add column origin_name text,
  add column destination_name text,
  add column is_active boolean not null default true,
  add column created_at timestamptz not null default now();

update flight.routes set origin_name = '台北' where origin = 'TPE';
update flight.routes set destination_name = '東京' where plan_name = 'tokyo';
update flight.routes set destination_name = '首爾' where plan_name = 'seoul';
update flight.routes set destination_name = '倫敦' where plan_name = 'london';

-- The dashboard lists routes by created_at; keep the original order
-- (Tokyo, Seoul from M1, London added later).
update flight.routes set created_at = '2026-09-17 00:00:00+00' where plan_name = 'tokyo';
update flight.routes set created_at = '2026-09-17 00:00:01+00' where plan_name = 'seoul';
update flight.routes set created_at = '2026-09-19 00:00:00+00' where plan_name = 'london';

alter table flight.routes
  alter column origin_name set not null,
  alter column destination_name set not null;

create unique index routes_origin_destination_key on flight.routes (origin, destination);
