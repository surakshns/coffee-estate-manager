-- Run in the intended Supabase project's SQL Editor after the first sync succeeds.
-- Enable pg_cron, pg_net and Vault first. Create these two Vault secrets:
-- farm_sync_url: https://YOUR_PROJECT_REF.supabase.co/functions/v1/farm-intelligence-sync
-- farm_sync_secret: the SAME value as FARM_INTELLIGENCE_SYNC_SECRET in Edge Function secrets.
-- No plaintext secret belongs in this file.

select cron.schedule(
  'farm-intelligence-sync',
  '0 */3 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'farm_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-farm-sync-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'farm_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $job$
);

-- The dispatcher runs every three hours in UTC. Per-source intervals still apply:
-- IMD six hours; Coffee Board/Spices Board twelve hours.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'farm-intelligence-sync';
