# Farm Intelligence implementation report

Completed in the local codebase on 7 October 2026. Backend activation has now also been completed for project `mwqqetjgtmqeppckpwbf`: the Farm migration, server/Vault secret, Edge Function and cron are installed and verified. **Frontend publishing is still pending.** Use [step 8 of the activation guide](farm-intelligence-activation.md#8-publish-the-frontend) to publish the local UI changes; do not re-run the installed migration.

## Live backend activation

- Catalog preflight confirmed all 23 Farm tables and all seven Farm functions were absent. Only `202610070001_farm_intelligence.sql` was applied through Supabase's management query API; earlier bookkeeping/reminder migrations were not replayed. The project has no CLI migration-history table, so a generic `db push` still requires verified history reconciliation first.
- All 23 tables now have RLS. Anonymous table access is denied; private tables have both owner-only and restrictive owner-guard policies; reference tables are read-only to authenticated users; fetch logs and ingestion RPCs are unavailable to browser roles.
- Fourteen source definitions are installed, with four enabled/ready. Unverified, unavailable, credential and permission sources remain disabled.
- The independent sync secret was generated without displaying it or saving plaintext locally, and stored in Edge Function secrets and Vault. Exactly one `farm_sync_secret` and one `farm_sync_url` exist.
- `farm-intelligence-sync` was deployed with its shared modules. A request without the secret returned HTTP 401. An authenticated request through pg_net/Vault returned HTTP 200: Coffee Board news 9 records, Coffee Board markets 8, Spices Board pepper 2, IMD Hassan warning 1. All four publisher responses were HTTP 200 with zero parse errors; live storage contains **20 updates, 10 prices and 1 forecast**.
- Cron job 2, `farm-intelligence-sync`, is active with `0 */3 * * *`. Per-source six/twelve-hour polling limits still apply. The first request verified pg_net delivery; a naturally scheduled future execution has not yet been observed.
- The Data API exposes only `public,graphql_public`; `net`, `vault` and `cron` are not exposed. Supabase's pg_net queue has platform-managed PUBLIC grants that cannot be changed per project; queued headers are readable to trusted direct database logins. This is an administrator/database-login boundary, not a browser API endpoint. Keep those schemas unexposed and direct database credentials restricted. [Supabase pg_net access guidance](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).

The reported `App.tsx` error was caused by an incomplete dependency installation after npm-cache permission failures. Restoring the original lockfile dependencies through a writable temporary cache fixed the diagnostics. TypeScript/build and all 417 tests passed again; no App.tsx source correction or package-version change was needed.

## Redesign after the initial UI review

The page now uses the shared centered page container and spacing. Regional weather, pepper market references and coffee indicators are visible before saving a profile, explicitly labeled as an unpersonalized Hassan/Sakleshpur overview. The short setup form collects location, a user-named physical block and actual crop selections; unprovided areas, coffee types, intercropping and policy details remain null. Inputs survive failed saves and carry into the full editor.

Current notices have readable summaries and a concrete next step. Prices use their original quote dates, with older futures in a collapsed archive. Source diagnostics and rainfall/insurance verification are collapsed instead of dominating the page. Full setup has direct section navigation and optional location details. Focus styling, responsive layout and reduced-motion support are retained.

The nine existing public Coffee Board notices were reprocessed from verified publisher headlines with their existing identities and original retrieval times preserved. Two April/early-May promotion notices are explicitly older-period records. The shared parser was redeployed with `farm-intelligence-sync` so scheduled ingestion retains the improvements. No private estate data, source polling interval, sync secret or schema was changed for this redesign. The redesign’s 407-test suite and production build passed; computer-control startup still prevents visual Safari verification.

## Official survey-map setup

A survey-map picker now works in quick setup and the full editor using two tested official KGIS layers. Hebbasale and Devihalli were resolved against government village identifiers in Kasaba hobli, Sakleshpura, Hassan. Whole-survey and matching numbered Hissa selection fill administrative location, survey identity and approximate coordinates inside the mapped polygon. Unverified elevation, acreage, crops and ownership remain unknown. Hissa entries marked Invalid, Not Matching, Kharab or without status are excluded; repeated identities keep all polygon parts.

The follow-up survey migration was tested and installed in the current project. It adds owner-protected source provenance and preserves the atomic account-bound profile RPC. Security checks confirmed RLS, source-column/RPC installation and denied anonymous access. Actual geometry validation covered 427 whole surveys/598 matching Hissa identities in Hebbasale and 91/74 in Devihalli, with every calculated point inside its selected polygon. See [the survey-map guide](farm-survey-map.md) for provider URLs, privacy boundaries, instructions and the remaining elevation gap.

## Delivered

The app now has a lazy-loaded Farm Intelligence screen and nine-step estate editor for location, physical blocks, intercropped coffee/pepper/arecanut, irrigation, optional farmer eligibility, equipment, independent crop insurance and alert preferences. Unknown details remain null. Survey numbers and coordinates are optional; coordinates are encouraged without assuming a location.

The feed shows crop/category filters, estate relevance reasons, missing information, confidence, original dates, stale status, expired history, verified deadlines and read state. Alerts are in-app in this release; saved farm preferences do not create phone push notifications. Existing weekly-payment push reminders remain separate.

Private records have owner-only RLS, restrictive ownership guards and composite foreign keys. Atomic profile reads/saves bind to the account that opened the screen, and account changes immediately hide old private data and abort pending work. Profile drafts stay in memory. No Aadhaar, bank account, password, OTP or policy/proposal reference is collected. Existing encrypted property documents remain in the document vault.

Server ingestion uses four fixed official-source adapters, independent secret authentication, HTTPS publisher allowlists, validated redirects, bounded requests, plain-text extraction, polling intervals, leases and atomic batches. Failed/empty parses retain previous valid records. Fetch logs and service credentials are unavailable to the frontend.

## Working live sources

These responses were actually retrieved and parsed during development. Dates below are the publisher's dates, not the download date. Availability can change; production must run its own first sync.

| Source | Actual records verified | Interpretation |
| --- | --- | --- |
| [Coffee Board News](https://coffeeboard.gov.in/News.aspx) | Nine grower-related notice metadata records, including the 7 September 2026 hybrid release | Recruitment excluded. Non-traditional-area notices do not automatically apply to Sakleshpur; expired training is history. Notice metadata does not establish scheme eligibility. |
| [Coffee Board market information](https://coffeeboard.gov.in/) | 2 October 2026 ICO: Other Milds 327.22 and Robustas 167.81 US cents/lb; six futures rows dated 5 June 2026 | International indicators/futures, never estate selling prices. June futures remain stale despite a newer homepage header. |
| [Spices Board indicative prices](https://www.indianspices.com/marketing/price/domestic/current-market-price) | 5 October 2026 Cochin/IPSTA pepper: garbled average 723 INR/kg; ungarbled 703 INR/kg | Indicative prices. Publisher dashes for minimum/maximum remain null. Market location is Kerala, not a promise of Sakleshpur proceeds. |
| [IMD Hassan district warning](https://mausam.imd.gov.in/imd_latest/contents/districtwise-warning_mc.php?id=13&day=Day_2) | Hassan district 83; source updated 6 October, Day 2 valid 7 October 2026; yellow thunderstorm/lightning/squall warning | District forecast warning, not observed estate rainfall. Yellow thunderstorm/lightning is not automatically heavy rain. |

Actual downloaded HTML was replayed into a fresh disposable database: **20 updates, 10 prices and 1 forecast**. A second ingestion updated the same 20 records and inserted zero duplicates. A synthetic 12-acre Sakleshpur estate with all three crops in the same physical block matched 15 updates after excluding two non-traditional-area notices, two past April/May promotional announcements and expired March training. This was a test estate, not an imported user profile. All three insurance claim estimates remained null.

## Partially working sources

- IMD district forecast and agromet PDFs downloaded successfully. Hassan guidance was found on agromet PDF page 48, but crop instructions need reviewed extraction before automatic risk alerts.
- Coffee Board and Spices Board scheme/programme documents are accessible. Current broad grower component rules remain unverified; reviewed August/September enrollment or claim deadlines are past as of this report. Older guideline percentages are not treated as current benefits.
- Karnataka Horticulture and Hassan pages are accessible. Inspected machinery notices were not proof of individual subsidy entitlement, and district beneficiary lists were historical and contained personal details that were not collected.
- DASD's current Karnataka-relevant programme research uses its accessible Kerala government site; the action plan is not an individual farmer entitlement.
- AGMARKNET returned real crop/location filter metadata, but no verified numerical Hassan-area arecanut prices.
- The 2026–27 Karnataka insurance notification archive downloaded, but scanned/legacy Kannada tables require manual verification of the exact crop, village/unit, season, insurer, station and terms.
- Spices Board RSS works as XML, but its ten items date from 2015–2019. It is not activated as a current feed.

## Sources without a verified public API

**NO VERIFIED PUBLIC API FOUND** for Coffee Board, Spices Board, DASD, the inspected Karnataka/Hassan feeds or an approved KSNDMC station-observation dataset. The working adapters use tested server-side official HTML instead. AGMARKNET filter metadata is not a verified live price endpoint.

IMD has documented APIs, but tested unauthenticated requests returned HTTP 401/API key missing. Credentialed, permitted access is needed before activation. Karnataka republication permission is unresolved. KSNDMC validated access and permitted decision/commercial use must be arranged. No licensed secondary-media feed has been selected.

## Sources requiring manual verification

Current financial-year scheme components, crop/location eligibility, landholding basis, subsidy percentages/caps, documents and deadlines; crop-specific agromet PDF extraction; reviewed risk conditions and valid periods; current insurance notification annexures; official station identities/coordinates and data quality; approved media rights; Karnataka publication permissions.

Disabled sources remain visible as unavailable, awaiting review, credentials or permission. No fake endpoint, assumed entitlement, numerical arecanut price or station data is substituted.

## Failed or unusable sources

- KSNDMC daily page showed maintenance; the actual Hassan request returned `[]`. This is unavailable data, not zero rainfall.
- Relevant AGMARKNET daily report returned HTTP 500 and the dashboard showed no data; the data.gov.in market API connection failed.
- The older supplied DASD domain was inaccessible during testing; the current official site was accessible.
- Hassan RSS failed. The accessible announcement page had no verified relevant current estate-crop announcement.

The existing Rainfall analytics now use Open-Meteo archive **reanalysis only**, with forecast top-ups removed and recent missing days left missing. These are explicitly model estimates, not official observations or insurance inputs. The provider's free hosted service has a non-commercial-use limitation; no paid integration was introduced.

## Insurance data still needed

Verify independently for **each crop and insurance unit**:

1. Policy year.
2. Season.
3. Crop coverage.
4. Notified village/insurance unit.
5. Insurer.
6. Current official term sheet and version/page.
7. Sum insured.
8. Premium/rate.
9. Trigger and applicable period.
10. Exact notified reference station and any expressly permitted backup.
11. Payout formula with official worked examples.
12. Official observation data for that station/period.

No payout formula has been implemented without those official examples. Even if inputs are manually flagged verified, V1 returns no estimate. Coverage is unknown, rather than assumed present or absent. See the [insurance methodology](insurance-methodology.md).

## Verification

| Check | Result |
| --- | --- |
| Baseline | 347 tests across 38 files passed; TypeScript/production build passed |
| Final automated suite | **434 tests across 46 files passed** |
| Final TypeScript and Vite production build | Passed |
| Database migration/regressions | All 20 repository migrations applied in disposable PGlite/PostgreSQL; eight SQL regression scripts passed across five clock scenarios |
| Actual source replay | 20 updates / 10 prices / 1 forecast; duplicate-free second batch; conservative sample-estate matching |
| Edge Function static types | Passed with a minimal Deno declaration shim; actual Deno/hosted function execution not tested locally |
| Hosted backend activation | Migration/security verified; deployed function rejected missing secrets; pg_net/Vault sync returned HTTP 200 for all four sources; cron configured active |
| Browser visual inspection | Blocked by macOS Accessibility/Screen Recording permissions; component behavior covered by automated UI tests |

Farm Intelligence adds a lazy chunk of about 73 KB (23 KB gzip), responsive styles, modal focus containment, bounded card rendering and reduced-motion support. The pre-existing initial-bundle warning remains: about 527.73 KB minified versus the 500 KB warning threshold. This does not block the build. Initial validation used an Edge type shim because Deno was unavailable locally. Backend activation subsequently used Supabase CLI 2.120.0 server-side bundling and verified hosted execution through pg_net/Vault. A natural future cron execution and browser visual inspection remain unobserved.

## Recommended next steps

1. Backend installation is complete for the current project; follow [step 8 of the activation guide](farm-intelligence-activation.md#8-publish-the-frontend) to publish the frontend. Verify the first naturally scheduled cron execution after its due time.
2. Verify a real saved estate profile, crop filters, account separation and phone/desktop layout after deployment.
3. Obtain approved KSNDMC observations/station metadata and permitted authenticated IMD access.
4. Review current scheme components and insurance annexures with exact crop/unit/season/year references. Add official formula examples before enabling claim estimates.
5. Select a licensed agricultural media feed and resolve publication permissions before activating additional adapters.

The detailed tested URLs, formats, dates, access limitations and fallbacks are in the mandatory [source inventory](data-sources.md).

## Survey-map timeout correction

Opening the picker now reads validated public outlines from an authenticated Supabase reference cache, rather than waiting on KGIS. The former whole-survey endpoint connected but returned zero bytes before a 25-second timeout. Four previously verified official datasets were preloaded with their original retrieval timestamps: Hebbasale 427 whole surveys / 598 numbered matching Hissa, Devihalli 91 / 74. No owner records, estate profiles or documents enter this cache.

The cache migration `202610070003_farm_survey_cache.sql` is installed. RLS blocks anonymous reads and all client writes. The deployed `farm-intelligence-sync` checks successful snapshots after 24 hours, refreshes four fixed bounded queries concurrently, and retains valid previous maps when the publisher fails. Map source and retrieval date remain visible and are saved in the estate's private provenance. The browser no longer needs a KGIS connection in CSP. Frontend publishing and Safari visual verification remain pending.

Live verification completed on 8 October 2026: `farm-intelligence-sync` version 4 is ACTIVE. An authenticated pg_net/Vault invocation returned HTTP 200 with all four fresh cached maps skipped and zero failures. The authenticated database role reads four maps; the same role without a user identity reads zero. Unauthenticated function and anonymous REST requests returned HTTP 401. All 434 tests across 46 files and the TypeScript/Vite production build passed. The existing localhost development server is listening on port 5173.
