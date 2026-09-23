-- Manually trigger flight-parser (normally run every 30 min by the
-- flight-price-check pg_cron job) and inspect its response.
--
-- Run against the linked project, e.g.:
--   supabase db query --linked --file supabase/scripts/manual-flight-parser-run.sql
-- or paste into the Supabase Studio SQL Editor.
--
-- net.http_post is async: the request runs via pg_net's own background
-- worker, not your client session, so a client-side pg_sleep between Step 1
-- and Step 2 is enough to let it finish -- no need to split into two runs.
-- If content still comes back empty (slow Travelpayouts response), just
-- re-run the Step 2 select by itself -- don't re-run Step 1.

-- Step 1: trigger the run
select net.http_post(
  url := 'https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/flight-parser',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flight_service_role_key'),
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
) as request_id;

select pg_sleep(8);

-- Step 2: check the response (status_code should be 200; response_body.matches
-- is the cleanest paywall test)
select
  id,
  status_code,
  content::jsonb as response_body,
  created
from net._http_response
order by id desc
limit 1;
