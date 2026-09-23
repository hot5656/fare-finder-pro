-- flight-parser now triggers alerts on Travelpayouts' v3 prices_for_dates and
-- also fetches v1 prices/cheap for comparison; both are listed in the email.
-- Only the latest check is kept (overwritten every run). last_price* keep
-- holding the triggering (v3) TWD/USD price so existing readers are unchanged;
-- these hold the full per-source offer detail (flight number, times, durations,
-- transfers, airports, link) so flight-admin-notify can render the same email
-- from cache. Shape: { "twd": Offer | null, "usd": Offer | null }.
alter table flight.routes
  add column last_offer_v3 jsonb,
  add column last_offer_v1 jsonb;
