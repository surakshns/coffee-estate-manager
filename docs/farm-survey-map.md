# Select an estate location from an official survey map

## What is implemented

In Farm Intelligence quick setup or the full estate editor, click **Select survey number on map**. Choose **Hebbasale** or **Devihalli**, choose a survey number (or tap its outline), then tap a numbered Hissa outline or choose it from the list. On a phone, pinch to zoom and drag with one finger to pan. Zoom buttons, reset and the survey/Hissa lists remain available. Click **Use this survey location** or **Use this subdivision location** before saving the estate.

The map fills Karnataka, Hassan, Sakleshpur, Kasaba hobli, the selected village and survey identity, and an approximate point inside the mapped polygon. Tapping a parcel displays these details, its Surnoc/Hissa, approximate mapped outline area, source date and identifiers. Area is calculated from the outline with a local metric projection, subtracting holes and including disjoint parts. It is not a certified or owned extent. Unknown cultivation area, crops, pincode, irrigation and elevation are not inferred. Enter the physical block name and actual crops in the form; area and elevation can remain blank. The full editor supports more blocks and optional details.

This is a farm-planning location, not a legal survey measurement or ownership determination. A whole-survey polygon can contain several holdings. Select the correct mapped Hissa when available, compare it with the current RTC/SSLR record, and adjust coordinates in the full editor if needed. Manually editing coordinates clears the map-source annotation.

## Verified sources and identifiers

The [official Karnataka Revenue portal](https://landrecords.karnataka.gov.in/) links to [Bhoomi Maps](https://rdservices.karnataka.gov.in/BhoomiMaps/) and [Revenue Maps](https://landrecords.karnataka.gov.in/service3/). The [official Dishaank listing](https://play.google.com/store/apps/details?id=com.ksrsac.sslr) describes these maps as reference information.

| Village | LGD identifier | Bhoomi/KGIS code | Location |
| --- | --- | --- | --- |
| Hebbasale | 614874 | 2301110012 | Kasaba, Sakleshpura, Hassan |
| Devihalli | 614895 | 2301110038 | Kasaba, Sakleshpura, Hassan |

The Bhoomi public search also spells Devihalli “deveehalli”. These are government-verified identifiers, not geocoder name matches.

- Whole-survey geometry: [official KGIS cadastral layer](https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5).
- Subdivision geometry: [official KGIS Hissa layer](https://kgis.ksrsac.in/kgismaps2/rest/services/HissaData/Hissadata_Edgematched/MapServer/1).

Geometry requests explicitly ask for EPSG:4326 and a minimal set of survey/village/status fields. The map refresh fetches only four fixed datasets: whole-survey and Hissa geometry for these two villages. Opening the picker reads the saved map through the existing authenticated Supabase client; Hissa selection is filtered to the chosen survey. The browser no longer contacts KGIS, so publisher delays and browser CORS do not block opening the map. No KGIS connection is permitted by the production CSP. A separate, signed-in RTC endpoint looks up a selected Hissa; no RTC document or vault file is downloaded.

## Owner and RTC details

Selecting a numbered Hissa automatically requests its official Bhoomi record. A whole survey does not identify one holding, so users must select the specific Hissa first. The server follows the public Bhoomi Maps workflow: `GetSurnoc`, `GetHissaNo`, then `GetRTCDataforSearch`, with an isolated transient ASP.NET session. Official search codes are district **23**, taluk **1**, hobli **11**, village **12** (Hebbasale) or **38** (Devihalli). These codes were checked against the public form's own ordering; they must not be swapped.

The details panel shows recorded holders, published holder extents, the Hissa's recorded extent, land code, ULPIN when supplied, related/father name and additional category, restriction and court-stay codes. Codes are preserved as published without guessing their legal meaning. Extent components are shown as acres, guntas and fractional guntas; they are not converted into a guessed decimal acreage. Khata and crop entries require the full official RTC. Missing records have an explicit retry, official RTC link and copyable search identifiers.

Every parcel and holder row must match the requested village, survey, Surnoc, Hissa and land code before any holder is returned. `farm-rtc-lookup` validates the session with `Auth.getUser`, permits only these two villages and fixed HTTPS endpoints, rejects redirects, bounds each response to 256 KiB and the complete lookup to 20 seconds, and caps holder rows at 100. The service-only `claim_farm_rtc_lookup` RPC permits ten lookups per account per minute; its private table contains only counters. Responses use `Cache-Control: no-store`. Cookies, raw records and holder names are never logged, placed in a shared cache, written to local storage or saved in the estate profile.

When **Use this location** is selected after a successful RTC lookup, the non-personal land code, ULPIN, recorded extent and source date are retained in the owner's existing private profile for reuse. Holder names load live. Recorded extent does not overwrite the confirmed estate, cultivated or block area, because the user may own only one share. If the user applies the location while the RTC is loading or unavailable, the map reference still saves and the RTC reference remains absent.

## Data handling and security

Unnumbered zero polygons are unselectable. Repeated survey/Surnoc/Hissa identities retain all geometry parts. A Hissa is offered only when the publisher reports **Valid-Matching to Bhoomi Records**, with a positive numbered subdivision. Unknown, Invalid, Not Matching and Kharab records are excluded.

The parser rejects other villages, incomplete/truncated responses, malformed/open rings, implausible coordinate ranges and oversized datasets. Server requests are bounded to 5 MB and 30 seconds, reject redirects and validate the entire response before writing. `farm_survey_maps` stores minimal public geometry only: no owner names, property documents or estate profiles. RLS denies anonymous reads; signed-in users have SELECT only, and server credentials remain server-side. Valid public geometry is reused in memory for five minutes; aborted/outdated responses are ignored. A failed refresh retains the last valid map and its original retrieval timestamp. The picker displays that timestamp and flags refresh delays.

A point is calculated inside a polygon while avoiding holes; bounding-box or village centers are not substituted. The drawn map uses a local SVG and precomputed paths, with pinch zoom, bounded panning, readable phone labels and keyboard-accessible lists. Movement and cancelled/pinch gestures do not select a parcel. Survey, Hissa, village, retry and close transitions synchronously invalidate old selections and requests. No extra map-rendering dependency or tile account was introduced.

Selected identity, approximate coordinates, bounds, mapped outline area, source URL and retrieval time are saved privately through the existing atomic, account-bound profile RPC. The `location_source` column was installed by `202610070002_farm_survey_location.sql` in project `mwqqetjgtmqeppckpwbf`; existing RLS remains enabled and anonymous access is denied. **No SQL Editor action remains for this installation.** Do not replay installed migrations. The cache migration `202610070003_farm_survey_cache.sql` and the three `20261008000{1,2,3}` parcel/RTC migrations are installed. All four verified maps are loaded. For a new project, apply these after the base Farm migration in filename order, deploy `farm-intelligence-sync` and `farm-rtc-lookup`, then run an authenticated sync to populate maps. The RTC endpoint needs no added API key or private external-service credential.

Changing the quick-setup administrative location clears the earlier map selection and coordinates. Manually changing coordinates in the full editor removes the derived-source annotation. Source provenance does not certify current ownership or imply the entire mapped survey belongs to the user.

## Background refresh

The existing secret-authenticated `farm-intelligence-sync` cron checks map freshness every three hours. Successful snapshots are refreshed after 24 hours; failed publisher attempts retain the previous map and can retry at the next cron dispatch. Four bounded requests run concurrently with notice sync. No user-triggered publisher fetch or additional API account is required.

On 7 October 2026 the former direct whole-survey request connected in 22 ms but returned zero bytes before a 25-second timeout. The cache was prewarmed from the previously retrieved, validated official geometry, preserving the actual download timestamps instead of claiming a new publisher retrieval.

## Elevation gap

KGIS parcel geometry is two-dimensional and does not supply elevation. No public KGIS point-elevation API was verified. [Open-Meteo elevation](https://open-meteo.com/en/docs/elevation-api) uses Copernicus GLO-90 at 90 m resolution, while its [hosted free tier is restricted to non-commercial use](https://open-meteo.com/en/terms). A permitted/licensed provider or self-hosted DEM needs configuration before automatic elevation can be enabled. Elevation currently remains unknown unless entered by the user; a polygon Z value, slope layer or village-average elevation is not substituted.

## Validation

On 7 October 2026, actual official geometry was parsed locally: 427 whole surveys and 598 matching numbered Hissa identities in Hebbasale; 91 whole surveys and 74 matching Hissa identities in Devihalli. Every calculated point was verified inside its selected multipart polygon, outside its holes. Counts describe that retrieval and may change upstream. Component tests cover explicit selection, subdivision choice and stale village-response rejection. Database regressions cover source persistence, invalid-source rejection, atomic rollback and owner isolation.

On 8 October 2026 the deployed sync (version 4) returned HTTP 200 with all four fresh maps retained and zero map-refresh failures. Live role checks confirmed four readable maps for a signed-in identity and zero without an identity; anonymous REST access was denied. The finished bounded RTC helper fetched one actual Hissa and verified all returned parcel/holder identities without printing or saving holder values. All 509 tests across 51 files, TypeScript/Vite production build, and 23 migrations plus nine SQL regressions across five clock scenarios passed. The frontend remains local until published with the existing deployment workflow. Computer-control startup is unavailable, so Safari/physical-phone visual inspection is still pending.
