-- Schedules flight-parser to run every 30 minutes. Requires the service
-- role key to already be stored in Vault under the name
-- 'flight_service_role_key' (done out-of-band via `vault.create_secret`,
-- not in this migration, since migrations are committed to git and the
-- key must never be).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'flight-price-check',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/flight-parser',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flight_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
