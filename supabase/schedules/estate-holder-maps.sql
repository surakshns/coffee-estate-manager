-- Uses the existing farm sync secret. Run only after the private-holder
-- migration and authenticated farm-estate-holdings function are installed.
-- The worker leases one request at a time and caps official work at four
-- actions per minute across all accounts. Completed queues perform no fetches.
select cron.schedule(
  'estate-holder-maps', '* * * * *',
  $$ select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='farm_sync_url'),'/farm-intelligence-sync','/farm-estate-holdings'),
    headers := jsonb_build_object('Content-Type','application/json','x-farm-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='farm_sync_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000
  ); $$
);
