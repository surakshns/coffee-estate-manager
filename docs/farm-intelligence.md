# Farm Intelligence setup and operation

This adds a separately loaded Farm Intelligence screen, private estate profiles and a server-ingested official reference feed. Existing bookkeeping, weekly reminders and the encrypted document vault remain in their existing workflows. Read the [audit](farm-intelligence-audit.md), [source inventory](data-sources.md) and [insurance methodology](insurance-methodology.md) first. The [final report](farm-intelligence-report.md) records completed work, actual source records and remaining gaps; use the [step-by-step activation guide](farm-intelligence-activation.md) for exact commands and dashboard actions.

Backend activation was completed for `mwqqetjgtmqeppckpwbf` on 7 October 2026. The migration, private secret, deployed function, successful first live sync and active cron are verified; no Farm Intelligence SQL Editor action remains for that project. Frontend publishing is still pending. The installation steps below describe a new or verified missing installation; do not repeat the already-installed migration.

## Implemented scope

- Nine-step editable estate setup: location; physical blocks; coffee; pepper; arecanut; irrigation/infrastructure and optional farmer eligibility; independent insurance metadata; equipment; per-crop alert preferences. Unknown agricultural values remain null. Intercropped areas do not add extra physical land. Coordinates and survey numbers are optional.
- Crop/category filters, relevance reasons, priority alerts, read state, verified upcoming deadlines, original publication/quote/financial-year/season dates, stale badges, separate expired history and source-access status.
- Four tested adapters: Coffee Board grower notice metadata, Coffee Board international indicators/futures, Spices Board indicative pepper prices and IMD Hassan district warnings. Original quote dates and units are preserved. Board component rules are not inferred from a headline.
- Owner-only RLS and composite ownership foreign keys; an atomic profile RPC; read-only reference tables; ingestion leases and minimum polling intervals; bounded publisher requests; redirect validation; sanitized plain text; atomic source batches; private fetch logs.
- Conservative matching/eligibility, verified-station proximity, separate station observations/forecast warning panels, and a risk engine that requires reviewed official advisory evidence plus matching fresh official weather. No unreviewed pest recommendations or doses are emitted.
- Insurance evidence checks list missing inputs and return no claim estimate. No observed-rainfall, arecanut-price or media-feed fallback is invented.

Alerts are **in-app** priorities/read state in this release. The saved preferences control highlighting, not phone push delivery. The existing weekly-payment push reminders are separate. There is no Farm Intelligence push scheduler in V1.

## Install

1. Preserve an existing configured `.env`; only copy `.env.example` when creating a new one. Set the public Supabase URL/publishable key. Never use a service-role key in React or a `VITE_` variable.
2. Install existing dependencies with `npm ci`, then run `npm test` and `npm run build`.
3. Apply all repository migrations in order to the intended Supabase project, including `supabase/migrations/202610070001_farm_intelligence.sql`. For a linked CLI project:

```sh
supabase migration list
supabase db push --dry-run
```

Review the CLI's pending migrations before running `supabase db push`; existing schema and migration history must agree. If earlier migrations were applied manually through SQL Editor, use the activation guide's one-time SQL Editor installation rather than replaying old files. The new migration is transactional. It does not seed estate profiles or fictional source records. Missing Farm Intelligence tables/functions produce a setup notice in its screen and do not change bookkeeping loading.

4. Generate a random server secret, store it in your secret manager, and set it using the Supabase CLI or dashboard. Enter a random value of at least 32 characters for `FARM_INTELLIGENCE_SYNC_SECRET`. Keep it separate from the existing reminder cron secret.

```sh
supabase secrets set --env-file /absolute/path/to/private-farm-secrets.env
supabase functions deploy farm-intelligence-sync
```

That private file contains `FARM_INTELLIGENCE_SYNC_SECRET=...`. Keep it outside the repository. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase on the server. `supabase/config.toml` disables JWT verification for this cron-only function; the handler itself requires the independent secret header and rejects missing/short secrets. It has no browser CORS endpoint and accepts no caller-provided URL, owner ID or profile.

5. Run a first sync from Supabase's function tester using POST and `x-farm-sync-secret`, or from an authorized server with that header. Confirm the response and `source_fetch_runs` before enabling the schedule. A `207` response means at least one source failed; previous valid records remain available.
6. Deploy the frontend through your existing hosting workflow. Frontend publishing alone does not apply migrations, set remote secrets or schedule jobs. The current project's backend activation is recorded above and in the final report.

## Scheduled sync

Enable `pg_cron`, `pg_net` and Vault through Supabase's integrations. Create two Vault secrets in the dashboard: `farm_sync_url` (your deployed function's exact HTTPS URL) and `farm_sync_secret` (the same random header secret). Vault values are server-only. Then schedule this SQL once in the database:

```sql
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
```

This follows [Supabase’s official scheduling/Vault guidance](https://supabase.com/docs/guides/functions/schedule-functions), using this function’s independent secret header. Database schedules use UTC. Source leases prevent overlapping fetches: IMD is eligible every six hours; Board news/prices every twelve hours. The three-hour dispatcher does not override each source's interval. Disabled/manual/permission sources are skipped. A failed fetch still respects its minimum interval; do not aggressively retry a publisher. Remove a schedule by looking up its job ID in `cron.job` and using `cron.unschedule(job_id)`.

Keep `net`, `vault` and `cron` out of the exposed Data API schemas, and grant direct database logins only to trusted services/operators. Supabase's pg_net request queue uses platform-managed PUBLIC grants; Vault encrypts the saved secret, but pg_net's transient queued headers can be read by direct database logins. Per-project revokes/RLS on these extension tables are unsupported. The current project's exposed schemas were verified as `public,graphql_public`. [Supabase pg_net permission guidance](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).

Inspect `source_fetch_runs` as an administrator for start/finish, HTTP status, record counts, parse errors, content hash and source-change detection. Those logs contain no profiles, publisher credentials or copied full articles, and are not exposed to React. A layout change, invalid price/date/unit, unknown warning colour, missing district, unsafe redirect or empty parse fails safely. Partial failed batches roll back; no job deletes previous valid records. Even unchanged HTML is revalidated and refreshes its retrieval time; price freshness still uses the original quote date.

## Source limitations

| State | Sources |
| --- | --- |
| Working retrieval/adapters | Coffee Board News/home; Spices Board indicative pepper; public IMD Hassan warning HTML |
| Partial access | IMD forecast/agromet PDFs; official arecanut filter metadata; DASD current action plan; Karnataka/Hassan pages; insurance archive |
| No verified public API | Coffee Board, Spices Board, DASD, Karnataka department/Hassan feeds, approved KSNDMC station dataset; see inventory for tested formats |
| Credentials/permission needed | IMD documented APIs return 401 without a key; KSNDMC requires approved validated access; Karnataka republication permission remains unresolved |
| Manual verification needed | Current scheme component eligibility and subsidy rates; district/crop agromet extraction; insurance crop/unit/season/insurer/station/formula chain; selected licensed media feed |
| Failed or unusable observations/prices | KSNDMC maintenance/empty Hassan response; AGMARKNET relevant daily report 500/dashboard no data; data.gov price API connection; older DASD domain; Hassan RSS |

The Spices Board programme page lists FY 2026–27 development enrollment ending 21 September, with continuation at most to 30 September. Its linked detailed guidelines are titled through 2025–26. As of 7 October these dates are past: do not label an application open or reuse a past subsidy percentage. Coffee Board's current index mixes old headings with newer component notices; the verified May 2026 roasting/grinding notice is a distinct component with August/September cutoffs, not general estate machinery entitlement. Current broad grower component rules remain unverified. See [board research](farm-research-boards.md).

## Accuracy boundaries

`OFFICIAL_CONFIRMED` confirms a recorded fact's official provenance; it does not certify personal eligibility, entitlement, diagnosis or insurance coverage. `UNVERIFIED` records state what is missing. Expired/older periods cannot produce current priority alerts. Secondary media records never edit official rules. Every enabled adapter uses a fixed verified HTTPS publisher URL; adding a source requires an actual response test and a new reviewed parser/fixture, not a user-supplied URL.

Station distance is derived from saved estate coordinates and verified active station coordinates, not a town preset. The rainfall panel displays measurements at the station with distance, period and quality. No verified KSNDMC station dataset is connected today, so it says unavailable. Insurance station mapping is independent and has no nearest-station/model fallback.

The existing rainfall analytics now use **Open-Meteo archive reanalysis only**, with recent missing days left missing. Forecast top-ups were removed to prevent mixed historical totals. These remain model estimates and are never official observations or insurance data. The provider's free hosted service is limited to non-commercial use; commercial deployment needs permitted access. No new paid API or automatic weather fallback was added.

## Validation and maintenance

`npm test` covers parsers against minimal official-page fixtures, invalid/changed layouts, India-date rollover, bounded fetching/SSRF, secret authentication, failed batch preservation, crop/location matching, unit conversion, stale/expired dates, independent insurance denial gates, reviewed-risk gating and private-account lifecycle. UI tests cover the wizard and safe empty/unverified states. SQL regression files `farm_intelligence.sql` and `farm_source_batches.sql` verify ownership even under a broad permissive policy, foreign-parent rejection, owner spoofing, atomic edits/persistence, deduplication and fetch leases. Run SQL tests against a **fresh disposable test database** after all migrations; each rolls back. Do not use production as a test fixture.

The UI loads reference data separately from bookkeeping, caps feed reads at 500 and renders forty matching cards initially, with more on demand. Sources/prices are bounded; the nearest station is ranked against the complete connected dataset in PostgreSQL, and only its recent observations are loaded; it does not claim the loaded history is complete. The screen is lazy loaded, uses native modal focus containment, responsive layouts and reduced-motion support. Private profile drafts stay in memory; they are not put in local storage or sent to external publishers. On account change, old private data is hidden immediately and pending work is aborted. Profile read/save RPCs also verify the expected account against `auth.uid()` before operating, so a token/account switch cannot save an open editor under another user.

For source changes, verify the real HTTP response/date/units/district, update the inventory, add or adjust parser fixtures, run tests and inspect a sample estate before activation. Keep unknown inputs unknown. The recommended next integrations are approved KSNDMC data, an authenticated permitted IMD feed, current component documents and reviewed insurance annexures; those require external source access/evidence, not placeholder API code.
