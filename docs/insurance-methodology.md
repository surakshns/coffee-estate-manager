# Farm Intelligence insurance methodology

Audit date: 7 October 2026. **Claim calculation is unavailable in V1.** The engine returns `available: false` and `estimated_claim: null`; it never displays zero as a substitute for missing evidence.

## Evidence gates

Coffee, pepper and arecanut are assessed independently. User-reported insurance status, premiums, sums insured or station names do not prove official coverage. Match all of the following to the selected village/insurance unit, crop, year and season:

1. Policy year and season.
2. Official notified crop coverage.
3. Notified insurance unit, including village/taluk/district/state mapping.
4. Applicable notified insurer.
5. Current official term sheet with document, page and version.
6. Verified sum insured and its area/unit basis.
7. Farmer premium/rate and applicable units.
8. Trigger definition and observation window.
9. Explicit reference weather station, with official identifier and mapping.
10. Backup station rule, if the notification permits it.
11. Official payout formula, caps and interaction between trigger windows.
12. Validated official observations from the notified station for the entire trigger period.

An implemented formula also needs independently checked worked examples from the **same official term sheet** before calculation can be enabled. There is no verified formula family or worked example for the current target estate; payout arithmetic is deliberately not invented. Tests exercise the denial gates, all three crops, mismatched season/year and substitute-station rejection.

## Current evidence

The [Karnataka SLBC 2026–27 notification archive](https://slbckarnataka.com/UserFiles/slbc/PMFBY%20and%20RWBCIS%202026-27.zip) was retrieved successfully, containing 16 files. The PMFBY monsoon notification is dated 12 June 2026; the horticulture RWBCIS document is dated 15 June 2026. Scanned/legacy Kannada annexures have not established the current Sakleshpur village-to-crop-to-station-to-terms chain. Coverage is **not verified**, rather than assumed present or absent. See [weather/insurance research](farm-research-weather-insurance.md) for exact retrieval evidence.

The KSNDMC Hassan request returned an empty result while the site reported maintenance. No verified active-station coordinates or complete official observations were obtained. IMD district warnings and Open-Meteo model/reanalysis data are not insurance observations.

## Storage and review

`insurance_terms` is versioned by scheme, term version, year, season, crop and insurance unit. `insurance_weather_mapping` links a specific term version to official reference/backup stations and a notification page. Clients can read these references but cannot edit them. Only a reviewed server ingestion or controlled service operation can add evidence. A database `OFFICIAL_CONFIRMED` flag alone does not activate calculations.

`insurance_profiles` contains optional owner-only policy metadata for each crop. The app collects no Aadhaar, bank details, OTPs or passwords. Policy/proposal identifiers are omitted from V1 rather than stored as ordinary text; existing encrypted document storage remains independent.

Never select a nearest station as an insurance substitute. Never turn missing rainfall into zero. Never use a forecast, reanalysis, a historic RISC station list or a different season's trigger formula as a fallback. If a permitted backup is eventually needed, its notification rule and observation provenance must be verified explicitly.

## Enabling a future formula

A reviewer must record the exact authoritative document/page, applicability, premium/sum units, trigger periods, station/backup rules, missing-data/revision rules and worked examples. Implement one supported formula family with tests for official examples, trigger boundaries, caps, overlapping windows, missing observations, wrong station, expired terms and wrong crop/season/year. Independent review is required before exposing an estimate. Until then the UI lists the missing evidence and provides no claim amount.
