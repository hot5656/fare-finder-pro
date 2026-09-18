-- Lets the dashboard show the most recently fetched fare per route, not
-- just whether a subscriber's target was hit. flight-parser writes these
-- on every run (match or not); nothing here needs new RLS/grants since
-- "routes are readable" (select, authenticated) already covers new columns.

alter table flight.routes
  add column last_price numeric,
  add column last_price_currency text,
  add column last_checked_at timestamptz;
