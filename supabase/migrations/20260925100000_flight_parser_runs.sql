-- One row per flight-parser run, so an admin can see from /admin when the
-- 30-min price check goes wrong (Travelpayouts 429 / HTTP errors, routes with
-- no fare, runs creeping toward the Edge Function time limit) without reading
-- the function logs.
--
-- flight-parser inserts the row as 'running' when it starts and finishes it at
-- the end; a row still 'running' long after started_at means the run crashed
-- or hit the wall-clock limit. No row at all for over an hour means pg_cron
-- (or the Vault key it sends) stopped working: the admin page checks that too.
--
-- issues is a list of { route, source, currency, kind, status?, message }:
--   kind = 'rate_limited' (HTTP 429) | 'http' (other non-2xx) | 'error'
--          (thrown fetch/parse) | 'no_fare' (v3 TWD empty, route skipped) | 'db'
--
-- Reads: admins only (flight.is_admin()); writes: service role only. The parser
-- deletes rows older than 90 days itself (48 runs a day).

create table flight.parser_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  status text not null default 'running' check (status in ('running', 'ok', 'warning', 'error')),
  routes_total integer,
  routes_checked integer,
  api_calls integer,
  matches integer,
  expired integer,
  issues jsonb not null default '[]'::jsonb
);

create index parser_runs_started_at_idx on flight.parser_runs (started_at desc);

alter table flight.parser_runs enable row level security;

grant select, insert, update, delete on flight.parser_runs to service_role;
-- The schema's default privileges also grant select to anon; admins read as
-- authenticated, so drop anon's inherited grant.
revoke select on flight.parser_runs from anon;
grant select on flight.parser_runs to authenticated;

create policy "admins can read parser_runs"
  on flight.parser_runs
  for select
  to authenticated
  using (flight.is_admin());
