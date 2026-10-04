# Editable weekly advance reminders

The app contains the reminder client, authenticated management function, scheduled
sender, database migration and tests. **Hosted delivery is not enabled by checking
out this code.** Apply the migration, configure the server and scheduler, then
connect notifications on each phone. Until then, the UI can save a preferred day
and time while clearly saying delivery needs setup.

The default is Wednesday at **8 PM, India time**. The user can edit the weekday
and time or turn reminders off. Settings belong to the account; iPhone and Android
subscriptions are separate. Changing the day still checks the latest Wednesday
on or before the scheduled occurrence. An enable/edit made after an occurrence
starts with the next occurrence; it never sends the past slot retroactively.

## Server setup

1. Apply `supabase/migrations/202610050001_advance_reminders.sql` after the earlier
   migrations. It preserves payment amounts, deductions and clear-week behaviour.
   It does not backfill subscriptions or declare legacy/imported weeks complete.

2. Generate a private secrets file outside the repository. The generator uses
   Node's Web Crypto API to create the P-256 JWK pair expected by the pinned
   `jsr:@negrel/webpush@0.5.0` library, plus a random scheduler token. It creates the
   file with owner-only permissions and refuses to overwrite a file.

   ```sh
   node scripts/generate-reminder-secrets.mjs /private/path/reminders.env https://your-app.example/coffee-estate-manager/ mailto:you@example.com
   ```

   `REMINDER_APP_URL` must be the actual HTTPS app root, including any hosting
   subdirectory. Keep these signing keys stable: changing them requires phones
   to reconnect. Never put the private JWK or cron token in `VITE_*` variables,
   browser code, Git, or a shared CSV backup.

3. Import the private file and deploy both functions with the Supabase CLI:

   ```sh
   supabase secrets set --env-file /private/path/reminders.env --project-ref YOUR_PROJECT_REF
   supabase functions deploy estate-reminders --project-ref YOUR_PROJECT_REF
   supabase functions deploy send-estate-reminders --project-ref YOUR_PROJECT_REF
   ```

   The platform supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge
   Functions. `supabase/config.toml` disables gateway JWT checks for these two
   functions because they perform their own checks: management validates the
   caller's session with `Auth.getUser`, while the sender accepts only the private
   `x-reminder-secret`. Neither endpoint accepts a caller-supplied account ID.

4. Enable `pg_cron` and `pg_net` in Supabase. In the SQL Editor, store the project
   URL and **the same `REMINDER_CRON_SECRET` from the private file** in Vault. These
   placeholders must be replaced locally; no real credentials are included here.

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
   a one-hour catch-up window, rather than creating a cron job for each user.

5. Once the functions and job are configured, enable delivery on the server:

   ```sh
   supabase secrets set REMINDER_DELIVERY_ENABLED=true --project-ref YOUR_PROJECT_REF
   ```

   Readiness requires valid VAPID keys, contact, app URL, cron token, migrated
   tables and this explicit flag. The flag is a setup declaration, not proof that
   a phone received a notification. Verify the actual delivery checklist below.

## Phone setup and delivery

On iPhone, install the web app using **Add to Home Screen**, open that installed
app and enable its notifications. On Android, use a browser with Web Push support
and allow notifications. Connect each phone using the app's reminder settings,
then send a test from each phone. Notification permission is requested only after
the user chooses to enable/connect notifications.

Notifications contain no worker names, wages or loan amounts. Tapping one opens
the exact Wednesday using `?advanceWeek=YYYY-MM-DD`; the URL retains the app's
hosting subdirectory. A test can be sent even if that week is already complete.
Tests are limited to one per minute per subscription.

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

A unique delivery record per account, Wednesday and endpoint prevents repeat
scheduled notifications, including after resubscription or a schedule edit.
Database claims use row locks with `SKIP LOCKED`. Only explicit HTTP 429/5xx push
service rejections retry, at five-minute intervals, up to three attempts inside
the catch-up window. Expired 404/410 subscriptions are removed. A network outcome
or crash that might already have delivered is recorded as **uncertain** and is
not resent automatically. This favours avoiding duplicate nags over claiming
impossible exactly-once network delivery. Explicit tests use a separate path.

## API

Call `supabase.functions.invoke('estate-reminders', { body: ... })` while signed in.

| Action | Body fields | Result |
|---|---|---|
| `status` | Optional current phone `endpoint` | Reminder status |
| `configure` | `enabled`, JS `weekday` 0–6, `time` in `HH:MM`; optional `endpoint` | Reminder status |
| `subscribe` | `subscription: PushSubscription.toJSON()` | Reminder status for that endpoint |
| `unsubscribe` | Current phone `endpoint` | Reminder status |
| `test` | Current phone `endpoint` | `{ sent: true }` on push-service acceptance |

Reminder status is `{ ready, settingsStorageReady, settings: { enabled, weekday, time, timezone },
vapidPublicKey, subscribed, subscriptionCount, weekStart, weekStatus,
setupMessage? }`. `weekStatus` is `complete`, `needs_review`, `not_saved` or
`no_workers`. Times always use `Asia/Kolkata`. The VAPID public key is returned
only by this server API; private material never leaves the server.

`settingsStorageReady: false` means the migration is incomplete. A configure call
with a missing settings table returns HTTP 409 and `code: REMINDER_SETUP_REQUIRED`;
the client can keep disabled preferences locally. It must not claim a local
fallback disabled an already enabled server reminder.

Disabled schedule preferences can be updated before delivery is ready. Enabling,
subscribing or testing is rejected until ready; enabling also requires an active
phone subscription. Turning the account reminder off leaves subscriptions in
place. Unsubscribing removes only the signed-in account's matching endpoint.
A browser endpoint follows its current signed-in account; reassociation requires
the same subscription keys, and cancels the old account's queued deliveries.

## Verification

The repository's Vitest suite tests date boundaries, editable schedule validation,
supported endpoint/SSRF checks, subscription keys/expiry, private generic payloads
and retry classification. `supabase/tests/advance_reminders.sql` is a transaction
that rolls back its fixtures and checks RPC completion/invalidation, loan cleanup,
partial imports, ownership, late edits, atomic claims and deduplication. Run it
against a local/test database with all migrations applied.

Before treating hosted delivery as working, verify both phones with the app
closed: unsaved sends once, saved/zero-pay/skipped-complete weeks do not send,
partial imports ask for review, no-worker accounts do not send, changed day/time
opens the intended Wednesday, late edits wait for the next occurrence, disable
stops remaining sends, expired subscriptions disappear, and notification taps
restore the right week/year. Inspect Cron and Edge Function outcomes without
logging subscription keys or signing secrets.

Sources: [Supabase function authentication](https://supabase.com/docs/guides/functions/auth-legacy-jwt),
[Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase dependency support](https://supabase.com/docs/guides/functions/dependencies),
[Web Push library API](https://github.com/negrel/webpush),
[iPhone/iPad Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
