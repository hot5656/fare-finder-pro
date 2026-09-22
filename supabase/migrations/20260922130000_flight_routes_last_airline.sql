-- Lets flight-admin-notify (a manual, non-live-refetch send) tell recipients
-- which airline the cached price came from, matching what flight-parser already
-- gets from Travelpayouts for every automatic send.
alter table flight.routes add column last_price_airline text;
