-- flight-parser now writes last_price/last_checked_at back onto flight.routes
-- on every run. The earlier grants migration only gave service_role SELECT
-- on routes (it was read-only at the time), so UPDATE was still missing --
-- table-level GRANTs are checked independently of service_role's BYPASSRLS.

grant update on flight.routes to service_role;
