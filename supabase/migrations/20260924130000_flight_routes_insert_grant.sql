-- flight-admin-routes inserts new routes as service_role, which until now only
-- had SELECT (schema grants) and UPDATE (20260918030100, for flight-parser's
-- last_price write-back). Without INSERT the create call fails with 42501.
-- No DELETE: routes are disabled, never deleted (subscriptions reference them).

grant insert on flight.routes to service_role;
