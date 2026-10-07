# Farm Intelligence repository audit

Audit date: 2026-10-07. This describes the checked-out application, not its live Supabase project.

## Baseline before implementation

- 347 tests passed across 38 Vitest files.
- TypeScript and the Vite production build passed. The existing main chunk is 526.91 kB; Vite reports its existing size advisory.
- The working tree was clean before this request.

## Architecture and reuse

| Area | Existing behavior | Implementation decision |
| --- | --- | --- |
| React | React 19, TypeScript, Vite; `App.tsx` owns page selection without an external router. Larger screens load lazily with Suspense and PageBoundary. | Add a lazy Farm Intelligence screen to existing desktop navigation and mobile Menu. |
| Auth | Supabase Auth controls the session; account changes hide the previous user's records immediately. | Retain Auth; isolate intelligence snapshots by account and cancel stale requests. |
| Supabase | `src/lib/supabase.ts` uses only a publishable/legacy anon key and rejects service credentials in browser configuration. | Use this client for owner-protected profiles and read-only reference data. Ingestion credentials stay in Edge Functions. |
| Data | `useEstateData` paginates bookkeeping and document records in batches of 500. Types live in `src/lib/types.ts`. | Load intelligence separately so new tables or source outages do not break bookkeeping. |
| Existing estates/crops | No estate, farm block, block crop, infrastructure, or crop insurance tables exist. `profiles` contains a display name. Harvest records are annual totals. | Add normalized profile tables; pepper intercropping must not double-count physical land. |
| Design system | Workspace headings, tabs, notices, empty states and accessible native-dialog Sheets; leaf/stony colours, cards and responsive styles. | Reuse these controls and existing typography; add a scoped intelligence stylesheet. |
| Guide | `monthly_tasks` and EstateGuide are user-maintained seasonal notes. | Keep them; they are not verified official advisories. |
| Existing reminders | Two Edge Functions, shared validation, service-only scheduled claims, owner subscriptions and Cron setup. | Keep weekly-payment reminders intact; intelligence preferences are separate. |
| Documents | Private encrypted property-document vault, owner-only storage policies and browser decryption. | No intelligence documents or personal identification are required in V1; preserve the vault. |

## Existing weather and markets

`src/lib/rainfall.ts` fetches Open-Meteo archive precipitation and fills recent missing dates with Open-Meteo forecast/model values. Coordinates are rounded to 0.01 degrees; presets include Sakleshpur. Data is cached in memory, requests can be aborted, missing/non-finite values are omitted, and summaries indicate incomplete coverage. This is model-based estate analytics, not KSNDMC station observations, and must never be used for insurance. The new system will preserve provenance and show official observed rainfall separately from forecast/model data. No KSNDMC station registry or verified official observation adapter exists in the baseline.

The current Prices screen uses a public saved futures CSV plus an unofficial Buon Ma Thuot Coffee API and an exchange-rate API. It already labels these as global ICE benchmarks rather than Sakleshpur spot rates. Official Coffee Board indicators and Spices Board indicative prices need separate provenance, units and date labels. No pepper/arecanut price ingestion exists.

`docs/crop-insurance-audit.md` contains a historical 2026-10-02 research audit. Its comment that missing rainfall becomes zero predates the current omission fix. It has no current verified Sakleshpur policy-year/season/unit/station/term-sheet chain and no enabled payout calculator.

## Accuracy boundaries

Research and actual retrieval precede adapter implementation. Source availability and sample retrieved records are recorded in `docs/data-sources.md`. Missing or old schemes remain unverified/old; absence of an accessible insurance notification does not mean a crop is not covered. No insurance calculation can use nearest-station guesses, generic rainfall models, or user-entered verification flags. No paid API, Aadhaar, bank credentials, password or OTP collection is introduced.
