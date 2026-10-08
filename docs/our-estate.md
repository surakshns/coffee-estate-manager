# Our Estate — 8 October 2026

## Using the map

Open **Our Estate** in the desktop navigation or the phone's **Menu**. The map fills the viewport with floating controls, a back button and access to the app menu. The page does not scroll; expanded detail panels and search results scroll within their own bounded areas. Both Hebbasale and Devihalli load together from the existing authenticated survey cache. The opening view fits the available estate polygons and approximate markers when private matches arrive, without opening a parcel or showing acreage. Background matching updates do not interrupt a view the user has moved. **My estate** refits the holdings, and viewport resizing refits them for portrait or landscape.

Survey and Hissa numbers appear on the map only for the selected parcel. Open the holder card to see the measured estate subtotal, RTC inventory, aliases and scan coverage, or select a matched parcel to see the subtotal beside its individual RTC. Filter either village, search a survey or Hissa, or tap an outline. The map supports pinch zoom, dragging, zoom buttons, parcel focus and optional browser fullscreen. Parcel details include the official RTC, its exact identifiers and an external Google Maps location link.

On a laptop, pinch on the trackpad with the cursor over the map to zoom in or out around that position. Safari's native gesture events and the Control-wheel events used by other browsers are supported. Control/Command + scroll also zooms; unmodified scrolling retains its normal page behaviour. Zoom stays within the map's 1–32× limits. Native listeners cancel page zoom only over the map and are removed when it closes. Touchscreen pointer gestures remain active without also applying Safari's gesture scale.

Survey outlines and the OpenStreetMap street background use the same Web Mercator projection. Muted outlines show the public reference geometry; forest-green fills identify exact recorded holder-name matches. An owned Hissa is filled within its validated Hissa polygon even when other subdivisions are hidden, without colouring its whole parent survey. Filled polygons retain their holes and disconnected parts. Orange dashed markers distinguish matches whose Hissa borders are unavailable; selecting one uses an unfilled, dashed whole-survey reference and opens its known matching RTC when unambiguous. Markers and selected labels retain a readable screen size on phones and laptops. Missing street tiles leave the survey outlines usable. Only visible street tiles are requested; no tiles are prefetched or saved by the app's service worker. Map attribution remains visible.

Whole surveys can contain several holdings. The details panel lists official Surnoc/Hissa options, including alphanumeric identifiers and whole-record symbols. When a matching RTC has no published Hissa outline, its marker is placed approximately on the whole survey and labelled accordingly. Opening that match selects its exact RTC; the whole-survey boundary is not presented as the matched holding's boundary.

## Private holder matching and acreage

An unconfigured account chooses a holder from a selected live RTC. The server independently verifies that exact record and name before storing the chosen name in an account-private profile. Other accounts have their own selection and never inherit another account's holder or matches.

The existing requested account's saved anchor was verified against the official RTC and configured privately. Its matching share was **2 acres** when retrieved during activation. This is an anchor share, not the final estate acreage.

The background queue enumerates every mapped whole survey's official RTC options, then checks those exact records for the chosen name. It includes records without Hissa geometry. Matching normalizes whitespace, punctuation, case and Unicode formatting only. It does not infer relatives, translate names, expand initials or use fuzzy matches; different recorded spellings can require checking the current RTC manually.

Explicitly approved additional RTC names can now be stored beneath the same main holder as private aliases. Matching checks all approved exact names together and counts each source holder share and land reference once. Adding an alias rechecks earlier records while retaining their previous verified matches and actual retrieval timestamps. Stale worker leases and callbacks with an older alias list cannot overwrite the expanded results. Other accounts retain their own name sets. The expanded holder card shows these names under **Also matches** without replacing the main heading.

The acreage display sums matching holders' published shares, using 40 guntas per acre when the fractional-gunta field is explicitly zero. It does not substitute the parcel's overall RTC extent or calculated map area. Unknown fractional encodings, missing extents and conflicting holder identities remain unknown. Duplicate land codes are deduplicated; whole-record shares with potentially overlapping subdivisions are excluded. The display reports incomplete coverage and exclusions while retaining the measured subtotal.

Status updates every minute while the page is visible and when it becomes visible again. These reads do not interrupt holder verification. Account changes abort outstanding requests and immediately clear the previous account's view.

## Installed backend

Project `mwqqetjgtmqeppckpwbf` already had migration `202610080004_private_estate_holder_maps.sql` and the `estate-holder-maps` schedule. Their existing installation was retained. Migration `202610080005_private_estate_holder_aliases.sql` is also installed. **No SQL Editor action remains for this project.**

The activated functions are:

| Function | Verified deployment |
| --- | --- |
| `farm-estate-holdings` | ACTIVE, version 2 |
| `farm-rtc-lookup` | ACTIVE, version 4 |
| `farm-intelligence-sync` | ACTIVE, version 5 |

The private worker reuses the existing server-only Farm sync secret. Cron runs every minute, with one global lookup lease and at most four actions per minute across all accounts. Retries back off for 15 and 30 minutes, and three failed attempts become unavailable. The worker has a 42-second overall deadline; official retrieval stops after 40 seconds so failed results can still be recorded. Expired leases can retry and stale tokens cannot write results. Empty completed queues perform no publisher fetches.

The installed inventory contains **518 mapped surveys**. Scanning is asynchronous and can take hours depending on official record counts and availability. A live post-deployment snapshot showed 14 completed checks, five verified matches, further checks pending and zero exhausted lookups. This snapshot is verification evidence, not a final holdings inventory. Selected live RTC lookups also refresh their private matching reference.

For a new project, apply all migrations in filename order, deploy these functions, and install `supabase/schedules/estate-holder-maps.sql` after the existing Farm Vault/Cron setup. Keep server keys and the sync secret out of frontend environment variables.

## Privacy and verification

Public geometry contains no holder names or estate ownership data. The private tables retain the chosen main name and explicitly approved exact aliases, queue progress, matching identities and non-personal land references. Incidental holder rows, related-name fields, session cookies and property documents are not persisted by matching. Status and RTC responses use `Cache-Control: no-store`; worker responses contain counts only. Database writes and status RPCs are service-only, with account-scoped read policies and restrictive client-write policies.

Validation completed on 8 October 2026:

- 620 tests across 56 files passed; TypeScript and the Vite production build passed.
- All 25 migrations and 12 SQL regression files passed in an isolated PostgreSQL engine across five clock scenarios.
- Live endpoint checks passed: anonymous status 401, unconfigured status 200/null with `no-store`, spoofed account and browser worker requests 400, oversized input 413, forged profile and private status RPC 403, and foreign account tables empty.
- The updated live RTC and RTC-options endpoints returned 200, exact anchor identity and its official Hissa option. The temporary verification account was removed afterward.
- Desktop Safari showed the full-viewport local map with no initial acreage or survey labels. Opening the holder card revealed the recorded total; opening the requested Hissa selected its precise RTC and coloured its mapped boundary. A 390-pixel phone-width opening preview was inspected with official public geometry and synthetic holder data. Phone gestures, selection, bounded detail flows and navigation have automated coverage; physical-phone testing remains unverified.
- A read-only boundary review found exact validated Hissa outlines for seven of the requested account's eight current matches. The remaining record's official map query returned only `XX` polygons classified as invalid and not matching Bhoomi. No border was inferred or added from those polygons. This is a retrieval snapshot; the private scan and official geometry can change.
- Laptop gesture regression tests cover Control/Command-wheel zoom in and out around the cursor, normal scrolling, Safari's cumulative scale, duplicate-event suppression, zoom limits, fresh selection and listener cleanup. Physical trackpad gestures have not been manually verified.
- The user-approved additional name was verified in a fresh official Hebbasale survey 417, Surnoc `*`, Hissa `*` record, with a matching holder share of 3 acres 35 guntas (3.875 acres). Its private alias and matching reference were saved under the existing main holder for the specified account. A post-save check confirmed the main name was unchanged and the rescan was pending. No real account identifiers or approved alias text are embedded in the repository.

The frontend implementation and production build are complete locally. The GitHub Pages frontend has not been pushed or published by this continuation. The existing backend scan continues independently of the browser and this agent session.
