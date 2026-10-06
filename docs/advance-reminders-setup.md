# Editable weekly advance reminders

The app contains the reminder client, authenticated management function, scheduled
sender, database migration and tests. **Hosted delivery is not enabled by checking
out this code.** Apply the migration, configure the server and scheduler, then
connect notifications on each phone. Until then, the UI can save a preferred day
and time while clearly saying delivery needs setup.

The default is Wednesday at **8 PM, India time**. The user can edit the weekday
and time or turn reminders off. Settings belong to the account; iPhone and Android
subscriptions are separate. Changing the day still checks the latest Wednesday
on or before the first scheduled occurrence. Each pending week then repeats
**daily at the selected time until the full weekly payment is saved**, even if
the next Wednesday has arrived. A completed newer week does not stop an older
week's reminders. The Wednesday payment date stays fixed for each reminder.

Changing an enabled schedule's day or time queues a **reschedule confirmation**
for every connected phone in the same transaction as the settings save. The
every-minute sender delivers it even if that week's payment is complete or the
account has no workers. Unchanged saves and edits while reminders are off do not
send confirmations. A newer edit or disabling reminders cancels stale alerts.

New weeks start on the selected weekday/time. Already-started unpaid weeks
resume at the next daily occurrence of the saved time after an edit or re-enable;
they do not wait for that weekday again. For example, changing 11 PM to 11:30 PM
at 11:10 PM sends the pending payment reminder at 11:30 PM that night, even if
the 11 PM reminder already sent. If the new time has passed, it resumes tomorrow.
Past slots are never sent retroactively, and Wednesday payment dates stay fixed.
Connecting a new phone after a due slot starts with the next daily occurrence
for an already pending week, or the next initial weekly occurrence otherwise.
Reconnecting the same phone or saving an unchanged schedule preserves the current
occurrence for phones that were already connected.

## CLI prerequisite

Use Node.js **20 or later** and run these commands from the repository folder:

```sh
npx supabase --version
npx supabase login
```

The `npx` prefix runs the CLI without requiring a global `supabase` command.
See the [official Supabase CLI setup guide](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Redeploy an existing installation

After signing in to the CLI, run this from the repository folder. Replace
`YOUR_PROJECT_REF` with the 20-character reference in Supabase Project Settings:

```sh
./scripts/deploy-reminder-functions.sh YOUR_PROJECT_REF
```

Alternatively, set `SUPABASE_PROJECT_REF` in your environment and run the script
without an argument. CI can supply `SUPABASE_ACCESS_TOKEN` through its secret
store instead of interactive login. The script works from another directory too,
as long as you call it using its full path.

It deploys `estate-reminders` first, then `send-estate-reminders`, stopping if
either fails. Imported `_shared` modules are bundled with each function, so the
request parser and status changes ship with the handlers. Deployment uses the
CLI's `--use-api` option and does not require Docker. The explicit
`--no-verify-jwt` matches this project's handler-level authentication: management
validates the signed-in user with `Auth.getUser`; the sender requires the private
cron secret. This is not a setting to copy to unrelated functions.

The script keeps the existing signing keys, secrets, delivery flag and cron job.
It does not apply migrations or publish the frontend. The reminder migrations
listed below must already be applied. After deploying, check both functions in
Supabase and open the signed-in reminder settings to confirm status loads, then
follow the phone delivery verification checklist below. See the official
[function deployment flags](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

## Upgrade the reminder database in SQL Editor

For an existing installation, open
[`supabase/upgrades/advance-reminders.sql`](../supabase/upgrades/advance-reminders.sql),
copy its **entire contents** into Supabase's **SQL Editor → New query** and run it
as one query. The script checks which reminder migrations are present, applies
missing `001`, `002` and `003` prerequisites, then applies the `006` rescheduling
fix in one transaction. It keeps account settings, subscriptions, completion
markers and delivery history, and can be run again after a successful upgrade.
The estate application's earlier schema migrations must already be installed.
Existing daily installations retain their daily scheduler; the upgrade does not
reapply the older weekly-only phone-connection scheduler on top of them.

If you saw `relation "public.advance_reminder_weeks" does not exist` when running
`006` alone, the daily reminder migration `003` was missing. Use the complete
upgrade file instead of creating that table manually: the daily feature also
needs its columns, constraints, functions, triggers and access policies.
A partial schema causes a clear error and the transaction rolls back.

The final result should say **Reminder database upgrade complete**, with
`daily_tracking_ready` and `reschedule_ready` both `true`. Then use the redeploy
script above so both Edge Functions contain the current shared modules. Database
upgrades do not change the existing signing secrets or Cron job.

The SQL file is generated from the canonical migrations. After changing a
reminder migration, regenerate and check it with:

```sh
node scripts/generate-reminder-upgrade.mjs
node scripts/generate-reminder-upgrade.mjs --check
```

## Server setup

1. Apply all migrations in filename order, including
   `supabase/migrations/202610050001_advance_reminders.sql`,
   `supabase/migrations/202610050002_reminder_phone_connections.sql`,
   `supabase/migrations/202610050003_repeating_advance_reminders.sql` and
   `supabase/migrations/202610050006_reminder_reschedule_daily_time.sql`.
   For a manual upgrade of an existing installation, use the complete SQL Editor
   upgrade file above so missing prerequisites are applied too. The `006` fix
   repairs known pending weeks delayed by the old weekday restart. Redeploying Edge
   Functions alone does not update this database trigger.
   These migrations preserve payment amounts, deductions and clear-week behaviour.
   They do not backfill subscriptions or declare legacy/imported weeks complete.

2. Generate a private secrets file outside the repository. The generator uses
   Node's Web Crypto API to create the P-256 JWK pair expected by the pinned
   `jsr:@negrel/webpush@0.5.0` library, plus a random scheduler token. It creates the
   parent directories and file with owner-only permissions and refuses to
   overwrite a file.

   ```sh
   node scripts/generate-reminder-secrets.mjs "$HOME/.config/coffee-estate-manager/reminders.env" https://your-app.example/coffee-estate-manager/ mailto:you@example.com
   ```

   `REMINDER_APP_URL` must be the actual HTTPS app root, including any hosting
   subdirectory. Keep these signing keys stable: changing them requires phones
   to reconnect. Never put the private JWK or cron token in `VITE_*` variables,
   browser code, Git, or a shared CSV backup.

3. Import the private file and deploy both functions with the Supabase CLI:

   ```sh
   npx supabase secrets set --env-file "$HOME/.config/coffee-estate-manager/reminders.env" --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy estate-reminders --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy send-estate-reminders --project-ref YOUR_PROJECT_REF
   ```

   The platform supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge
   Functions. `supabase/config.toml` disables gateway JWT checks for these two
   functions because they perform their own checks: management validates the
   caller's session with `Auth.getUser`, while the sender accepts only the private
   `x-reminder-secret`. Neither endpoint accepts a caller-supplied account ID.

4. Open your project's **SQL Editor → New query** and run the following to
   enable `pg_cron` and `pg_net` (already-enabled extensions are kept):

   ```sql
   create extension if not exists pg_cron with schema pg_catalog;
   create extension if not exists pg_net with schema extensions;
   grant usage on schema cron to postgres;
   grant all privileges on all tables in schema cron to postgres;
   ```

   See Supabase's [Cron installation](https://supabase.com/docs/guides/cron/install)
   and [pg_net setup](https://supabase.com/docs/guides/database/extensions/pg_net).
   On your Mac, open the private file with:

   ```sh
   open -e "$HOME/.config/coffee-estate-manager/reminders.env"
   ```

   Copy only the value after `REMINDER_CRON_SECRET=`. In the SQL Editor, store the
   project URL and **that same value** in Vault using the SQL below. Replace
   `YOUR_PROJECT_REF` with your project reference and
   `YOUR_PRIVATE_REMINDER_CRON_SECRET` with the copied value before running it.
   Keep the secret in the local file and Supabase; do not paste it into chat.

   ```sql
   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'estate_reminder_project_url');
   select vault.create_secret('YOUR_PRIVATE_REMINDER_CRON_SECRET', 'estate_reminder_cron_secret');

   select cron.schedule(
     'estate-advance-reminders',
     '* * * * *',
     $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'estate_reminder_project_url') || '/functions/v1/send-estate-reminders',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'estate_reminder_cron_secret')
         ),
         body := '{}'::jsonb,
         timeout_milliseconds := 10000
       );
     $$
   );
   ```

   Create this job once; check the Cron dashboard for an existing job before
   repeating the command. The sender scans editable schedules every minute, with
   a one-hour catch-up window for each daily slot and reschedule confirmation,
   rather than creating a cron job for each user. Missing the first weekly slot
   still allows the following daily reminders. For an existing installation,
   apply the third migration, redeploy both functions, and publish the updated
   frontend/service worker. Keep the existing secrets and cron job.

5. Once the functions and job are configured, enable delivery on the server:

   ```sh
   npx supabase secrets set REMINDER_DELIVERY_ENABLED=true --project-ref YOUR_PROJECT_REF
   ```

   Readiness requires valid VAPID keys, contact, app URL, cron token, migrated
   tables and this explicit flag. The flag is a setup declaration, not proof that
   a phone received a notification. Verify the actual delivery checklist below.

## Phone setup and delivery

On iPhone, install the web app using **Add to Home Screen**, open that installed
app and enable its notifications. On Android, use a browser with Web Push support
and allow notifications. Connect each phone using the app's reminder settings.
Notification permission is requested only after the user chooses to enable/connect
notifications.

Notifications contain no worker names, wages or loan amounts. Tapping one opens
the exact Wednesday using `?advanceWeek=YYYY-MM-DD`; the URL retains the app's
hosting subdirectory.

This is a phone notification. Its sound and visibility follow the phone's
notification, silent and Focus settings; it is not a continuous clock alarm.

## Completion and retry rules

`save_weekly_labour` writes a `weekly_pay_runs` marker in the same transaction as
payments and linked loan repayments, only when the submitted rows cover every
eligible worker. Eligibility matches weekly pay: active workers plus workers
already recorded on that Wednesday. The marker snapshots the worker IDs; someone
joining later does not turn a completed week back into an unsaved week. Zero-pay
and skipped workers count as completed when included in that save.

Partial saves retain their previous payment behaviour, but do not get a marker.
CSV imports and direct changes to weekly payment rows invalidate markers; they do
not mark a partial/imported week complete. Such weeks display **Needs review**.
Open the weekly advance and save the full week to establish completion.
`clear_weekly_labour` removes the marker with the payments and linked deductions.

The sender rechecks completion, account settings, worker eligibility and phone
ownership immediately before each push. Disabling reminders or saving the week
cancels remaining devices. An already accepted/in-flight push can still arrive;
the push TTL is only five minutes to limit stale alerts.

A unique delivery record per account, Wednesday, endpoint, notification kind,
schedule revision and scheduled occurrence prevents duplicate notifications
within a daily slot, including after resubscription. Each new daily occurrence
has its own record. `advance_reminder_weeks` retains the original pending
Wednesday across week/year boundaries and is removed when that payment is
complete. The migration resumes only known pending reminder weeks from the
existing ledger; arbitrary older missing payments are not backfilled.
Schedule revisions also protect claimed deliveries from rapid schedule changes.
Database claims use row locks with `SKIP LOCKED`. Only explicit HTTP 429/5xx push
service rejections retry, at five-minute intervals, up to three attempts inside
the catch-up window. Expired 404/410 subscriptions are removed. A network outcome
or crash that might already have delivered is recorded as **uncertain** and is
not retried for that occurrence. The next daily reminder remains independent.
The service worker uses a separate tag for confirmations and requests
[`renotify`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification)
for daily reminders, so replacing yesterday's notification can alert again
without accumulating duplicate notifications for the same pay week. Sound and
visibility still follow the phone's notification settings.

## API

Call `supabase.functions.invoke('estate-reminders', { body: ... })` while signed in.

| Action | Body fields | Result |
|---|---|---|
| `status` | Optional current phone `endpoint` | Reminder status |
| `configure` | `enabled`, JS `weekday` 0–6, `time` in `HH:MM`; optional `endpoint` | Reminder status |
| `subscribe` | `subscription: PushSubscription.toJSON()` | Reminder status for that endpoint |
| `unsubscribe` | Current phone `endpoint` | Reminder status |

Reminder status is `{ ready, settingsStorageReady, settings: { enabled, weekday, time, timezone },
vapidPublicKey, subscribed, subscriptionCount, weekStart, weekStatus,
setupMessage? }`. `weekStatus` is `complete`, `needs_review`, `not_saved` or
`no_workers`. Times always use `Asia/Kolkata`. The VAPID public key is returned
only by this server API; private material never leaves the server.

`settingsStorageReady: false` means the migration is incomplete. A configure call
with a missing settings table returns HTTP 409 and `code: REMINDER_SETUP_REQUIRED`;
the client can keep disabled preferences locally. It must not claim a local
fallback disabled an already enabled server reminder.

Disabled schedule preferences can be updated before delivery is ready. Enabling or
subscribing is rejected until ready; enabling also requires an active
phone subscription. Turning the account reminder off leaves subscriptions in
place. Unsubscribing removes only the signed-in account's matching endpoint.
A browser endpoint follows its current signed-in account; reassociation requires
the same subscription keys, and cancels the old account's queued deliveries.

## Verification

The repository's Vitest suite tests date boundaries, editable schedule validation,
supported endpoint/SSRF checks, subscription keys/expiry, private generic payloads
and retry classification. `supabase/tests/advance_reminders.sql`,
`supabase/tests/repeating_advance_reminders.sql` and
`supabase/tests/rescheduled_advance_reminders.sql` roll back their fixtures and
check RPC completion/invalidation, loan cleanup, partial imports, ownership,
late edits, atomic claims, daily deduplication, missed initial slots, multiple
pending weeks, same-night time changes and reschedule confirmations. Run them against a local/test
database with all migrations applied.

Before treating hosted delivery as working, verify both phones with the app
closed: unsaved sends on the chosen day and repeats daily at the chosen time,
saved/zero-pay/skipped-complete weeks stop repeating,
partial imports ask for review, no-worker accounts do not send, changed day/time
opens the intended Wednesday, rescheduling confirms the new day/time on both
phones, unchanged saves do not send confirmations, time edits before the new
time send that night even after the old reminder sent, edits after the new time
resume pending reminders tomorrow, disable
stops remaining sends, expired subscriptions disappear, and notification taps
restore the right week/year. Inspect Cron and Edge Function outcomes without
logging subscription keys or signing secrets.

Sources: [Supabase function authentication](https://supabase.com/docs/guides/functions/auth-legacy-jwt),
[Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase dependency support](https://supabase.com/docs/guides/functions/dependencies),
[Web Push library API](https://github.com/negrel/webpush),
[iPhone/iPad Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
