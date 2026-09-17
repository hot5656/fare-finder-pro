-- The M1 schema migration created `flight` and enabled RLS on its tables,
-- but never granted schema/table privileges to the API roles. Postgres
-- checks GRANTs before RLS policies are even evaluated, so every PostgREST
-- call was failing with 42501 "permission denied for schema flight".

grant usage on schema flight to authenticated, anon, service_role;

grant select on flight.routes to authenticated, anon, service_role;
grant select, insert, update on flight.subscriptions to authenticated, service_role;
grant select, insert, update, delete on flight.notification_history to service_role;

alter default privileges in schema flight
  grant select on tables to authenticated, anon, service_role;
