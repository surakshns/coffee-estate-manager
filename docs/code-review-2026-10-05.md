# Code review and updates — 5 October 2026

The review covered application entry and authentication, account data loading, all primary screens, calculation and loan helpers, CSV backup/import, document storage and PDF handling, shared styles and motion, the service worker, schema migrations and ownership policies, reminder functions, market-data scripts, tests and deployment configuration.

## Changes implemented

| Area | Finding and resulting behavior |
| --- | --- |
| Account isolation | Record loading is tied to the signed-in user. Signing out or changing accounts hides the previous records and resets open account UI. Superseded requests are cancelled and late responses cannot replace a newer snapshot. Initial Auth responses cannot overwrite a later Auth event. |
| Complete records | Queries use explicit account filters and stable 500-row pages instead of relying on the server's default row limit. Initial failures can be retried; background failures retain the last successfully loaded snapshot and show a warning. |
| Load and rendering performance | Seven heavier screens load on demand. Dashboard aggregations use memoization and one pass per record type, with paise accumulation. Loan grouping avoids copying a growing array for each record. Expense and document lists render 50/40 matches initially, with more available on demand; searches and totals still use every record. |
| Motion and accessibility | Existing page, navigation and panel motion is preserved. Screen navigation uses React transitions, refreshes retain the current screen, and a small progress bar communicates pending work. New movement respects reduced-motion preferences. Confirmation dialogs use the native modal layer, including when a sheet is already open. Rainfall location selection uses the shared accessible sheet. Swipe listeners attach before an arriving worker card is painted. |
| Bookkeeping | Currency retains paise. Harvest revenue and stock belong to the crop year; financial activity uses calendar-year record dates. Misleading crop profit and per-bag cost/profit labels are replaced with recorded activity, average sale price and stock remaining. Oversold harvests are flagged. Fractional bag arithmetic avoids tiny false stock shortfalls. |
| CSV reliability | Parsing supports quoted multiline notes, escaped quotes, CRLF and BOM. Malformed rows, repeated/missing column names, ambiguous references, invalid dates and non-finite/malformed amounts are rejected. Spreadsheet formula-like text is escaped for export and restored by app import. |
| Import safety | File selection validates the whole CSV and opens a preview without writing. Import limits are 5 MB and 10,000 rows. The preview identifies existing records that will be updated. Duplicate submissions are blocked, errors retain the review, and matching workers/categories update rather than clone those reference records. Other additive datasets explain duplicate-import behavior. |
| Wage/loan consistency | Reviewed wage imports call an account-scoped transaction that upserts wages and reconciles their linked repayments together. A failed later row rolls back the batch. Retrying a wage import does not duplicate linked repayments. Imported weeks remain reviewable in Labour. |
| Documents and form errors | Uploads check allowed formats and the 20 MB limit before network work, and use unique file paths. A denied record deletion preserves the file. A subsequent storage failure offers file-cleanup retry. Category mutations recover from exceptions and reject duplicate names; plain Supabase error objects retain their useful messages. |
| Property document privacy | Follow-up changes add an AES-GCM encrypted vault for contents and identifying details, independent password unlock, optional fingerprint/face/device-PIN passkey unlock, automatic locking and durable original-file cleanup. Restrictive owner policies remain effective alongside broad permissive policies. Production browser restrictions and public-key configuration guards add protection. See [the vault guide](document-vault-security.md). |
| Offline privacy | The service worker caches only public app files within its installation scope. Private endpoints, external data, authenticated requests and query-bearing reset/notification URLs are excluded. Old app caches are removed. Network loading still works when cache storage is unavailable. |
| Database checks | A new migration rejects non-finite financial numbers, deductions above included wages, foreign document paths and oversized metadata on new/updated records. Existing legacy rows are left untouched through `NOT VALID` checks. Two indexes support record reads. |
| Reminder endpoints | Body parsing is bounded to 8 KB before decoding, including streamed input and understated length headers. Invalid input returns 400; oversized input returns 413. Reminder eligibility uses exact counts so large teams cannot be misclassified through row truncation. Verified Auth identity continues to scope privileged queries. |
| Rainfall integrity | Missing, negative and unusable measurements are omitted rather than becoming dry days. Failed/empty history raises a recoverable error. Current rainfall cache expires after five minutes; older data and coordinate caches remain bounded. Search cancellation prevents stale results, coordinates are validated, and calendar weeks no longer shift when measurements are missing. Available coverage and incomplete comparisons are explained. Estate date defaults use India time. |
| Delivery checks | GitHub Pages deployment runs application tests before the build. README now describes current screens, accounting periods, restoration behavior and required migrations accurately. |

The initial JavaScript bundle fell from approximately **1,078 KB / 304 KB gzip** to approximately **526 KB / 151 KB gzip** (about 51% smaller before compression). This is a bundle-size measurement, not a measured device frame-rate or latency improvement. Charts and PDFs remain separate, substantial downloads when those features are opened.

## Verification

- Full Vitest suite after document security and Safari-compatible device-unlock updates: **347 tests passed across 38 files**.
- TypeScript and production build: passed. Vite still reports its existing 500 KB chunk-size advisory for the main bundle.
- Dependency audit: zero reported vulnerabilities in the installed dependency tree; dependencies were not changed.
- All migrations, plus the reminder, record-integrity and document-vault SQL regression checks, passed in an isolated PGlite PostgreSQL database. The SQL tests used disposable Auth/storage fixtures and exercised five clock positions around reminder days, India midnight and a year boundary. Integrity checks covered RLS, invalid amounts and paths, atomic import rollback, foreign-worker rejection and linked repayment reconciliation. Vault checks exercised anonymous/foreign denial with broad permissive policies present, immutable key settings/files, encrypted writes, transactional cleanup and account deletion.
- Biometric tests use real Web Crypto with simulated credential responses. They check encryption, user verification, PRF output, context/account binding, tampering, unsupported prompts, cancellation, local storage failures and stale completions. Safari-compatible setup uses separate creation/verification clicks and checks that each prompt starts before any asynchronous yield. Server identity must be verified before accepting or saving a result. Real device/passkey-provider verification remains outstanding.
- Reminder deployment script syntax and validation, execution from another working directory and fail-fast deployment order were checked using a mock CLI. No deployment was performed.
- Diff whitespace checks: passed.
- Browser visual inspection could not be completed: automatic computer-access approval denied Google Chrome access. Automated UI workflows cover mobile weekly pay, nested confirmations, import review/cancellation, document failure recovery and large-ledger search. Real-device animation and visual verification remains outstanding.
- No live estate records, live database configuration or deployed site were changed.

## Deployment order

1. Apply `supabase/migrations/202610050004_record_integrity.sql` after all previous migrations.
2. Apply `supabase/migrations/202610050005_encrypted_document_vault.sql` before publishing the vault UI.
3. Redeploy `estate-reminders` and `send-estate-reminders` using `scripts/deploy-reminder-functions.sh YOUR_PROJECT_REF` so the packaged shared request parser and status logic are current. See [CLI authentication and deployment instructions](advance-reminders-setup.md).
4. Publish the frontend build and updated service worker through the existing hosting workflow.
5. Create the vault password, encrypt existing documents and finish original-file cleanup. Optionally enable fingerprint/face unlock on a personal device.
6. Complete browser/device visual review and real-phone passkey verification once access is available.

The new wage-import RPC requires the migration. Notification delivery still requires the existing server keys, delivery switch and Cron setup documented in [advance-reminders-setup.md](advance-reminders-setup.md).

## Operational limits

CSV backups contain records; document files are downloaded separately. Imports of expenses, loan transactions, sales and harvest entries append records and can duplicate a previously imported file. Wage imports reconcile deductions but do not manufacture weekly completion markers.

Document storage and database writes are separate services. Original/deleted file paths are queued durably in the same database transaction as replacement/deletion; removal failures retry when the owner next unlocks the vault. Finish outstanding cleanup before treating existing plaintext conversion as complete. Old provider backups and prior downloads are outside this process. No system can guarantee immunity from hacking; device/host compromise can expose documents while unlocked. See [the detailed security limits](document-vault-security.md).

Rainfall totals describe available modeled data and can cover incomplete periods. Recorded balance is a bookkeeping comparison, rather than an inventory-valued profit calculation. Multi-table reads are paginated client requests, not a database-wide transactional snapshot.

Database checks do not rewrite legacy invalid records. An attempted update to such a record may require correcting its invalid values first. Production Auth settings, secrets, backups, Cron execution and notification delivery were not inspected or changed.

## Primary references consulted

- [Supabase query limits and pagination](https://supabase.com/docs/reference/javascript/select)
- [OWASP spreadsheet CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection)
- [PostgreSQL constraint validation](https://www.postgresql.org/docs/current/sql-altertable.html)
