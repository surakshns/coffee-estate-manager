# Crop insurance: initial data audit

Audit date: 2026-10-02

Requested location: Devihalli, Sakleshpur, Hassan, Karnataka.

## Implementation status

Repository inspection and initial authoritative-source research are complete.
The first policy year/season has not yet been supplied. No payout formula,
station assignment, insurance dataset, migration or calculator has been added.
Existing rainfall functionality is unchanged.

For Devihalli, no complete crop/variety/year/season evidence chain has been
established. The correct calculation status is `insufficient_data`, with no
payout amount. This does **not** establish that a crop is uninsurable or was not
notified; it means the required notification has not been verified.

## Existing project

| Area | Finding | Reuse decision |
| --- | --- | --- |
| `src/lib/rainfall.ts` | `fetchRainfallData` uses Open-Meteo archive and forecast endpoints with rounded latitude/longitude. | Keep for estate analytics only. Never import this fetcher into the insurance path. |
| Rainfall records | `DailyRainRecord` contains only a date and precipitation amount. Missing/non-finite API values currently become zero. | Insurance needs a separate observation type with nullable values, quality flags, station identity and provenance. Never convert missing observations to zero. |
| Rainfall aggregation | `getCoffeeSeason` uses fixed calendar-month labels; annual/monthly summaries are for estate analytics. | Do not reuse these as notified observation windows or claim indices. |
| `src/components/Rainfall.tsx` | Location is a preset or coordinates saved in browser local storage under `coffee_estate_rainfall_location`. | Coordinates do not identify an official insurance unit. No inferred station or village assignment. |
| Karnataka provider | No KSNDMC/telemetry adapter, official station registry or observation archive was found in the current source, scripts, public assets or Supabase directory. The rainfall file history contains one introduction commit. | Previously retrieved KSNDMC code/data may exist outside this checkout; it was not available for reuse in this audit. |
| Supabase | Migrations contain user profiles, bookkeeping and private property documents. `profiles` has no estate location/land-area fields. There are no insurance tables or Edge Functions in the checkout. | Reuse auth, owner-based RLS, document storage and timestamp conventions. Add insurance-specific storage/server functions separately. |
| UI | `App.tsx` owns navigation. `Workspace.tsx` supplies headings, notices, empty states and accessible sheets. Documents already has an in-app PDF reader. | Add Insurance to the existing navigation and use the same mobile-first layout and document-viewing patterns. |

This was an audit of checked-in code and migrations, not an inspection of the
live Supabase database or deployed external services.

## Authoritative information located

### Coffee: historical evidence, not a current Devihalli assignment

The [Coffee Board RISC archive](https://coffeeboard.gov.in/rainfall-insurance-scheme-coffee-growers-risc.html)
contains historical Karnataka term sheets, reference-gauge lists and payout
reports.

The [official Karnataka RISC 2016 booklet](https://coffeeboard.gov.in/sites/coffeeboard.kar.nic.in/files/RISC%202016%20Booklet_Karnataka.pdf)
identifies AIC as the implementing insurer. Printed page 5, Annexure 1, row 29
(PDF page 6) lists the Sakleshpura coffee sub-zone with reference station
**KSNDMC TRG - Sakleshpur**, at the Inspection Bungalow Office, and backup
**KSNDMC TRG - Belagodu**, at the Government High School. This table was visually
checked against the PDF.

Printed page 3 restricts claims to notified gauge data and describes use of the
specified backup for dates missing from the reference gauge. The booklet also
has variety-specific terms and optional cover combinations. These findings are
**2016-only**. They neither map Devihalli to that sub-zone nor establish rules,
station IDs or coverage for 2022-2026. Those records must not be seeded as
current verified rules.

### Black pepper and arecanut: local applicability still missing

[HDFC ERGO's Karnataka Kharif 2025 page](https://www.hdfcergo.com/pmfby/rwbcis-kharif-2025/Karnataka)
lists arecanut and black pepper among covered crops in its stated districts.
The listed districts are Davanagere, Haveri and Ramanagara, not Hassan. This is
not evidence that HDFC is the insurer for Devihalli.

A [Lok Sabha response on arecanut, 16 December 2025](https://sansad.in/getFile/loksabhaquestions/annex/186/AU2548_9qzDt4.pdf?source=pqals)
confirms RWBCIS arecanut coverage in Karnataka districts for monsoon and
post-monsoon seasons. It does not provide Devihalli's crop notification,
station mapping or term sheet.

For both crops, the applicable Hassan/Devihalli notification, implementing
insurer, term sheet and weather-station assignment remain unverified. Do not
apply another district's rules or assume rainfall is the only parameter.

### Official weather access

[KSNDMC describes its telemetry network and crop-insurance use](https://ksndmc.org/en/About/Introduction).
However, the [public daily-realized-weather report](https://ksndmc.org/en/DailyReport/getDailyReport)
labels published data as informational, advises against commercial/decision
use, and directs users to contact KSNDMC for validated data. Its rainfall
heading uses an 08:30-to-08:30 reporting day, which must not be silently treated
as a midnight calendar day.

No validated historical feed/export with the required station identity,
coverage dates, quality flags and permission for this use was obtained. A
public telemetry endpoint alone would not establish that its values are the
insurer's accepted claims dataset.

[Karnataka Samrakshane](https://samrakshane.karnataka.gov.in/) provides an
insurance year/season selection entry point. No Devihalli-specific notification
or station mapping was retrieved from it during this audit. That is an access
and evidence gap, not proof of non-notification.

## Evidence required before a payable estimate

1. Exact policy year and season, including cross-calendar-year cover dates.
2. Official crop/variety notification for Devihalli's insurance unit, identifying
   the scheme, insurer and any applicable amendments.
3. Official village-to-insurance-unit mapping. A nearby town, GPS point or
   matching station name is not sufficient.
4. Notified reference station identity and, where permitted, backup station
   identity, substitution conditions and effective dates. Provider IDs must be
   reconciled with the names in the notification.
5. Complete term sheet: purchased cover options, observation periods,
   parameters/units, aggregation and event-selection rules, comparison
   boundaries, trigger/exit/slabs, payout rates, event/total caps, applicable
   deductibles and rounding rules.
6. Validated observations for every required interval, with reporting-day
   definition, timezone, missing/revised-value flags and an authoritative source
   file or endpoint. Include notified non-rainfall parameters where required.
7. Insured crop area and unit, plus a policy schedule if the intent is to
   estimate an existing policy rather than a hypothetical notified cover.
8. An official worked claim or published station-level payout for the same
   rules, wherever available, to validate the implementation independently.

A policy schedule/term sheet is useful without personal identifiers. Account
numbers, Aadhaar, signatures and other unnecessary personal details can be
redacted. Do not send provider secrets in chat; configure them server-side.

## Proposed implementation boundary

The following is a design recommendation, not an implemented schema.

| Storage | Purpose |
| --- | --- |
| `estates` | Owner-protected saved land/location/area; keep user-entered location distinct from verified insurance-unit identity. |
| `insurance_sources` | Issuer, URL/private document reference, document date, page, checksum, retrieval and review metadata. Preserve superseded versions. |
| `insurance_products` | Exact scheme/insurer/crop/variety/season/year notification, eligibility, cover options and total limits. |
| `insurance_units` and membership records | Official administrative identifiers and village membership, tied to source evidence and effective dates. |
| `insurance_stations` | Provider station IDs, names/aliases, coordinates where documented, and station history. |
| `insurance_station_mapping` | Product/unit/period-specific primary and backup assignment with evidence and review status. No nearest-station fallback. |
| `insurance_rules` | Versioned event definitions, typed aggregation/payout configuration and source-page references. No executable formula strings. |
| `insurance_observation_batches` and observations | Immutable original response/file, hash, provider, station, parameter, units, timestamps, values, quality and revisions. |
| `insurance_estimates` | Owner-protected input/evidence snapshot, engine/rule versions, event results, selected windows, caps, warnings and calculation timestamp. |

Reference data should be readable by authenticated users but writable only by
a trusted ingestion/review path. A normal client must never mark rules,
mappings or observations verified. Personal estate data, policy documents and
estimate history retain owner-based access.

A Supabase Edge Function should authenticate requests, resolve the exact
product/unit/mapping and obtain validated observations using server-side
credentials. Reject ambiguous or overlapping assignments. Do not let clients
choose an arbitrary fetch URL or override station/source evidence.

The TypeScript engine should consume a validated evidence bundle without
network or UI dependencies. Implement each formula family only after its
definition is established. Dependent observation windows, interval boundaries,
leap days, cross-year periods, missing data, backup substitutions and multiple
cover options require explicit semantics. Unsupported rules fail closed.

Keep calculation outcome separate from evidence confidence. Missing any
required evidence returns `insufficient_data` and a null amount. Partial
evidence may be described, but cannot authorize a payout. A zero amount is only
valid after a complete calculation. Estimates must never be presented as
official claim decisions.

## UI and verification gates

- One mobile-first form grouped into crop/season, land/location and insured
  area. Offer only verified product-specific seasons/cover choices as eligible;
  an arbitrary year must not imply coverage.
- Show unresolved requirements beside the relevant field. Never prefill an
  official unit or station from the rainfall page's saved coordinates.
- When observations are unavailable, show: "Official reference-station
  rainfall unavailable. Insurance payout cannot be reliably estimated."
- Once calculation is enabled, show estimated total, insured limit, percentage,
  event amounts and station provenance together; place raw observations,
  selected event windows and formulas in "How was this calculated?".
- Reuse the document viewer for source inspection. Nearby estate rainfall, if
  shown, stays separate and explicitly excluded from the estimate.
- Test missing/ambiguous mappings, wrong years/varieties, unsupported formulas,
  null/duplicate/revised observations, incomplete periods, exact threshold
  boundaries, permitted backup use, area conversion, caps and rounding.
- Test RLS and client inability to alter verification; compare implemented
  results against official examples; check mobile accessibility and layout.

The next evidence decision is the first **policy year/season** for Devihalli.
Until it and the corresponding official sources are resolved, no crop/year
should be presented as supported for payout calculation.
