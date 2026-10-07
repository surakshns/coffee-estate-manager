# Activate Farm Intelligence, step by step

These steps are for the existing app and Supabase project. The local implementation passed 509 tests and the production build. The [final report](farm-intelligence-report.md) records source gaps and verification limits.

**Current project status, 8 October 2026:** backend steps 2–7 have now been completed for `mwqqetjgtmqeppckpwbf`: migration installed, owner-only security checked, private server/Vault secret configured, function deployed, first live sync successful and cron active. **Do not rerun the migration or generate a replacement secret for this project.** The survey-location migration `202610070002_farm_survey_location.sql` and survey-cache migration `202610070003_farm_survey_cache.sql` are also installed. The three parcel/RTC migrations `202610080001_farm_parcel_reference_details.sql`, `202610080002_farm_rtc_lookup_limits.sql` and `202610080003_farm_rtc_reference_details.sql` are also installed, and `farm-rtc-lookup` is deployed with session authentication. Four verified public maps are preloaded; the deployed sync refreshes them in the background. There is no SQL Editor action left for this Farm Intelligence installation. Publishing the frontend in step 8 is still pending. The instructions below remain the procedure for a new project or a verified missing installation.

Run each step in order. Keep the same Terminal window for commands using `FARM_PROJECT_REF`. Only public Supabase configuration belongs in React; the sync secret stays server-side.

## 1. Open the project and check it

```sh
cd /Users/surakshns/Desktop/coffee-estate-manager
node --version
npm ci
npm test
npm run build
```

The installed Vite version requires Node 20.19+ within Node 20, or Node 22.12+. Keep the existing `.env` if already configured; do not overwrite it. It needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`), never a service-role/secret key.

If `npm ci` fails with npm-cache `EACCES`/permission errors and leaves missing imports or `tsc: command not found`, use an isolated writable cache:

```sh
npm ci --cache /private/tmp/coffee-estate-manager-npm-cache --no-audit --no-fund
npm run build
```

This resolved the reported `App.tsx` diagnostics without changing source code or package versions. If editor markers persist after installation, restart the editor's TypeScript server or reload the window.

## 2. Apply the Farm Intelligence migration once

The existing README permits SQL Editor installation, so old migrations may already be applied without CLI history. The simplest path for that setup is:

1. Open the **intended Supabase project → SQL Editor → New query**.
2. Run this small read-only check:

```sql
select
  to_regclass('public.estates') as estate_table,
  to_regclass('public.data_sources') as source_table,
  to_regprocedure('public.save_farm_profile(jsonb,uuid)') as profile_save;
```

3. If all three are null and Farm Intelligence has not been installed, copy the **entire** `supabase/migrations/202610070001_farm_intelligence.sql` into a new query and run it once. On your Mac, this command copies the full file:

```sh
pbcopy < supabase/migrations/202610070001_farm_intelligence.sql
```

4. Run the check again: all three should now be non-null. Also check the source registry:

```sql
select id, enabled, status from public.data_sources order by id;
```

There should be 14 sources, with four enabled/ready. Manual-review/unavailable sources should remain disabled. If the first check already returns existing Farm objects, verify the installed version before re-running this non-idempotent migration. If only some objects exist, inspect that partial/conflicting installation before applying it.

This new migration uses standard Supabase Auth/PostgreSQL primitives and does not depend on `advance_reminder_weeks`. Prior reminder installation is a separate task.

**CLI alternative, only if your migration history is already maintained:**

```sh
npx supabase login
FARM_PROJECT_REF='YOUR_20_CHARACTER_PROJECT_REF'
npx supabase link --project-ref "$FARM_PROJECT_REF"
npx supabase migration list
npx supabase db push --dry-run
```

Proceed with `npx supabase db push` only when the listed pending files are genuinely unapplied. If old migrations appear although their tables already exist, use the SQL Editor path above. Do not use a database reset, `--include-all` or blanket history repairs to bypass the mismatch. SQL Editor execution does not automatically record CLI migration history; reconcile that history against verified installations before adopting CLI migrations later. [Supabase migration CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push).

## 3. Log in to the CLI and select the correct project

Find the **Project reference** in the Supabase project settings. It is the identifier in your usual `https://PROJECT_REF.supabase.co` URL. Replace the placeholder below:

The existing local `.env` currently points to `mwqqetjgtmqeppckpwbf.supabase.co`. Use `mwqqetjgtmqeppckpwbf` only after confirming this is the intended project in your dashboard.

```sh
npx supabase login
FARM_PROJECT_REF='YOUR_20_CHARACTER_PROJECT_REF'
```

The following function commands use the explicit reference and do not require linking the database. No Docker installation is required with `--use-api`.

## 4. Create one private sync secret

On your Mac:

```sh
openssl rand -hex 32 | pbcopy
```

This copies a random secret to the clipboard without printing it. Save it in your password manager so the **same value** can be used in both places below. If a farm sync secret is already configured, reuse its securely saved value rather than generating a replacement unnecessarily.

In **Supabase → Edge Functions → Secrets**, add:

- Name: `FARM_INTELLIGENCE_SYNC_SECRET`
- Value: paste the saved random secret.

Do not put it in `.env`, `VITE_*`, GitHub variables, source code or a screenshot. Supabase supplies the function's server URL/service-role environment. The farm secret is independent of the existing reminder secret. [Supabase secret configuration](https://supabase.com/docs/guides/functions/secrets).

## 5. Deploy the function and shared modules

```sh
npx supabase functions deploy farm-intelligence-sync \
  --project-ref "$FARM_PROJECT_REF" \
  --use-api \
  --no-verify-jwt
```

For a new project that includes survey selection, also apply the survey and parcel/RTC migrations in filename order before deploying the signed-in lookup:

```sh
npx supabase functions deploy farm-rtc-lookup \
  --project-ref "$FARM_PROJECT_REF" \
  --use-api \
  --no-verify-jwt
```

This endpoint verifies the supplied user token with `Auth.getUser` inside the handler and uses a service-only rate limiter. It does not accept the sync secret and needs no additional external API credential.

Deploy from the repository root. The imported `_shared` files are packaged with the function. JWT verification is disabled because this cron-only handler authenticates its independent `x-farm-sync-secret` header; missing or wrong secrets are rejected. Do not deploy with `--prune`. [Supabase function deployment reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

## 6. Run and inspect the first sync

In **Supabase → Edge Functions → farm-intelligence-sync → Test**:

1. Method: **POST**.
2. Body: `{}`.
3. Header name: `x-farm-sync-secret`; value: your saved secret.
4. Send the request.

HTTP 200 means the attempted sources succeeded. HTTP 207 means one or more failed and previous valid data was retained. A response with an empty `results` array can mean sources are not due because polling intervals/leases apply. HTTP 401 indicates the header secret is missing or mismatched; HTTP 500 needs server-log inspection.

Run in SQL Editor:

```sql
select source_id, started_at, finished_at, http_status,
       records_found, records_inserted, records_updated,
       parse_errors, error_message
from public.source_fetch_runs
order by started_at desc
limit 20;

select source_name, title, source_published_at, retrieved_at, verification_status
from public.official_updates
order by retrieved_at desc
limit 20;
```

Resolve failed-source errors before relying on the feed. Do not repeatedly force fetches: IMD's minimum interval is six hours and Board sources' is twelve hours, including after failures. Real publishers may have changed since development; record counts are not fixed promises.

## 7. Enable automatic sync

In Supabase, enable **Cron (`pg_cron`), `pg_net` and Vault**. In Vault create these two named secrets (or update the existing named values):

| Vault name | Value |
| --- | --- |
| `farm_sync_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/farm-intelligence-sync` |
| `farm_sync_secret` | The exact same secret used for `FARM_INTELLIGENCE_SYNC_SECRET` |

Keep exactly one Vault secret for each name. Then copy the schedule SQL into SQL Editor and run it:

```sh
pbcopy < supabase/schedules/farm-intelligence.sql
```

Confirm the returned job is active. It dispatches every three hours in UTC; per-source six/twelve-hour limits still apply. The cron command reads secrets from Vault instead of storing plaintext in its SQL. [Supabase scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions).

After the next scheduled dispatch, inspect `source_fetch_runs` again. An empty fetch list immediately after the first sync is expected while intervals have not elapsed.

## 8. Publish the frontend

This repository contains a GitHub Pages workflow that runs on pushes to `main`. Ensure the repository's **Settings → Secrets and variables → Actions → Variables** contains the existing public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep secret/service-role keys out of these variables.

Stage only the intended application files. For the current phone-map/RTC update:

```sh
git add tsconfig.app.json src/farm-intelligence.css \
  src/components/FarmOnboarding.tsx src/components/FarmQuickSetup.tsx \
  src/components/FarmSurveyPicker.tsx src/components/FarmSurveyPicker.test.tsx \
  src/components/FarmParcelDetails.tsx src/components/FarmParcelDetails.test.tsx \
  src/lib/farmSurveyMap.ts src/lib/farmParcelDetails.ts src/lib/farmParcelDetails.test.ts \
  src/lib/farmRtcClient.ts src/lib/farmRtcClient.test.ts \
  src/lib/farmRtc.test.ts src/lib/farmRtcHandler.test.ts \
  docs/farm-survey-map.md docs/farm-intelligence-report.md docs/farm-intelligence-activation.md \
  supabase/config.toml supabase/functions/farm-rtc-lookup \
  supabase/functions/_shared/farmIntelligence.ts \
  supabase/functions/_shared/farmRtc.ts supabase/functions/_shared/farmRtcHandler.ts \
  supabase/migrations/202610080001_farm_parcel_reference_details.sql \
  supabase/migrations/202610080002_farm_rtc_lookup_limits.sql \
  supabase/migrations/202610080003_farm_rtc_reference_details.sql \
  supabase/tests/farm_intelligence.sql supabase/tests/farm_rtc_lookup_limits.sql
git diff --cached --stat
git diff --cached --check
```

After reviewing the staged changes, commit and push:

```sh
git commit -m "Add phone survey gestures and private official RTC lookup"
git push origin main
```

The remote named `origin` is the application's repository. Review any previously staged unrelated files before committing. The existing workflow will test, build and deploy the updated app; monitor **Actions → Deploy Coffee Estate Manager to GitHub Pages**. Running the workflow before pushing the new commit would deploy the earlier code.

If your live app uses Cloudflare Pages instead, use its existing connected-repository deploy with the same public variables, build command `npm run build` and output `dist`, as described in the repository README. Backend steps 2–7 still apply.

## 9. Check the deployed app

1. Sign in and open **Farm Intelligence** from the menu.
2. Create/edit your estate. Open the survey picker, select a village and survey, pinch/drag the map on a phone, then tap a numbered Hissa and check its live RTC details. Apply the location, confirm your own share and save. Add physical blocks and the crops actually present. Leave unknown details blank and save once.
3. Check All/Coffee/Pepper/Arecanut filters, source links/dates, relevance reasons and stale/expired states. Switch accounts to confirm each sees only its own profile.
4. Check the phone and desktop layout and reduced-motion setting. Local visual inspection was blocked by macOS permissions; automated component tests passed.
5. Expect official station rainfall, verified insurance calculations and numerical arecanut prices to remain unavailable until the documented official-data gaps are resolved. Farm alerts are in-app; this release does not add farm phone push delivery.

Optional local preview after backend activation:

```sh
npm run dev
```

Existing reminder deployments are separate. If you also need to redeploy the earlier packaged reminder functions and their database/secrets are already set up, run:

```sh
bash scripts/deploy-reminder-functions.sh "$FARM_PROJECT_REF"
```

That script only deploys `estate-reminders` and `send-estate-reminders`; it does not repair a missing reminder table. Follow [the reminder setup guide](advance-reminders-setup.md) for that installation.
