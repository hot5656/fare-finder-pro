-- flight-parser already fetches a departure date and a USD supplementary quote
-- for every route, but only ever persisted last_price/last_price_currency. A
-- manually-triggered notification (flight-admin-notify) reuses this cached row
-- instead of re-querying Travelpayouts, so without these it had to fall back to
-- an empty depart_date (breaks the Aviasales booking link entirely -- Aviasales
-- needs a date-shaped path segment, not just an absent one) and no USD line.
alter table flight.routes
  add column last_price_depart_date text,
  add column last_price_usd numeric,
  add column last_price_usd_currency text;
