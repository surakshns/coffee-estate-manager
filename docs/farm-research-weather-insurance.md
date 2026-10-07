# Weather, observed rainfall and insurance source verification

Research performed 7 October 2026 in Asia/Kolkata; HTTP retrievals occurred around **2026-10-06T20:30–20:38Z**. These are source-access findings, not a claim that ingestion has been deployed. No account was created, API key purchased, CAPTCHA bypassed or insurance payout calculated.

## Verified access inventory

| Source | Authority / format | Tested URL | Actual retrieval | Intended use and limits |
| --- | --- | --- | --- | --- |
| KSNDMC daily rainfall page | Official Karnataka; HTML | <https://ksndmc.org/en/DailyReport/getDailyReport> | HTTP 200, 58,504 bytes | Page reachable; reports database maintenance. Public data is explicitly informational; the page advises against commercial/decision use and directs users to KSNDMC for validated data. Do not enable a decision/insurance feed without permitted validated access. |
| KSNDMC Hassan rainfall XHR | Official site's undocumented JSON-string response | <https://ksndmc.org/en/DailyReport/getRainFallReport?drpVal=24> | HTTP 200, four bytes: `"[]"` | **No Sakleshpur station observations retrieved.** Endpoint was discovered in the page's own inline AJAX code, not invented. No documented public API or reuse permission established. |
| IMD API documentation | Official; HTML | <https://api.imd.gov.in/public/api_reference.html> | HTTP 200, 58,564 bytes | Documents warning and district rainfall forecast APIs. Machine-readable APIs exist, but public unauthenticated access did not work. |
| IMD warnings API | Official; JSON | <https://api.imd.gov.in/api/v1/districtwarning> | HTTP 401, body `{"error":"API key missing"}` | Requires API key. API home describes controlled key-based access and registration. Free terms/rate limits were not verified. No key was requested. |
| IMD district rainfall forecast API | Official; JSON | <https://api.imd.gov.in/api/v1/state_district_rainfall_forecast> | HTTP 401, same body | Requires API key; do not use as a publicly working adapter. Forecast distribution fields are not measured station rainfall. |
| IMD Bengaluru district warning webpage | Official; HTML containing a JSON array | <https://mausam.imd.gov.in/imd_latest/contents/districtwise-warning_mc.php?id=13&day=Day_2> | HTTP 200, 213,707 bytes; Hassan record verified | Safe candidate for server-side parsing of the public page. Parse embedded JSON as data, never execute JavaScript. Verify date/header/district and strip HTML from descriptions. District warning only, not estate observation. |
| IMD Bengaluru district forecast | Official; PDF | <https://mausam.imd.gov.in/bengaluru/mcdata/district.pdf> | Accessible, four pages, issued **6 October 2026** | Hassan appears in district table, but the PDF's table layout makes unattended text extraction unsafe without row/page verification. Publish original link first. |
| IMD Karnataka agromet | Official; PDF | <https://mausam.imd.gov.in/bengaluru/mcdata/agromete.pdf> | Accessible, 53 pages; bulletin **80/2026**, issued **6 October 2026** | Hassan crop advisory section on PDF page 48; pepper/arecanut content verified. PDF retrieval works; reliable automatic district/crop extraction remains to be validated. No pesticide doses invented or transcribed into product recommendations. |
| SLBC Karnataka crop insurance archive | Government-backed banking committee hosts Karnataka government notifications; ZIP with PDF/XLS/XLSX/DOC | <https://slbckarnataka.com/UserFiles/slbc/PMFBY%20and%20RWBCIS%202026-27.zip> | HTTP 200, 28,494,673 bytes; 16 files extracted and inspected | Current **2026–27** notification archive verified. It is a document source requiring manual verification of policy chain and annexures, not a verified payout API or proof of coverage for any estate. |

No RSS/XML feed was verified for these sources. No verified public KSNDMC station catalogue with coordinates was found during this pass. Do not seed sample station names, coordinates, distances or insurance station mappings as facts.

## KSNDMC request and missing data

The official daily page has the district option `<option value="24">HASSAN</option>`. Its inline script invokes `GET /en/DailyReport/getRainFallReport` with `data: { drpVal: drpVal }`. The UI then `JSON.parse`s the returned string.

The public page names these expected rainfall columns:

```text
DISTRICT
TALUKNAME
HOBLINAME
RAINDATE
RAIN
```

Column names must be rechecked against an actual nonempty response before implementation; the observed response supplied no station row to validate their values, station identity or quality. The UI says accumulated rainfall covers **previous day 08:30 to today 08:30**, in mm. A date alone therefore must not be interpreted as a UTC midnight observation.

Nearest-station selection cannot currently be implemented with verified KSNDMC data because station identifier, latitude/longitude, type, active status, observation timestamps and quality status have not been retrieved. User estate coordinates are also not yet supplied. The requested “Harle / 1.93 km / 45.5 mm” is an illustrative requirement, not a verified observation.

Observed rainfall UI should report: **“Official Karnataka rainfall data is unavailable; no verified station observation has been retrieved.”** Existing Open-Meteo data must remain separately labelled model/archive or forecast data and must not satisfy the official observed-rainfall/insurance requirement.

The KSNDMC page's disclaimer specifically advises against commercial or decision use and requests contact for validated data. The safest V1 implementation is a source-status record and official link while validated access and reuse terms are resolved. Do not poll the empty XHR hourly merely to make a feed appear connected.

## IMD actual public warning record

The public Bengaluru warning page's `dataProvider` contains a JSON array beginning with the exact key `"areas": [`. The array contains entries for many Indian districts despite the Bengaluru page, so state/target district filtering is essential. A bracket-aware scanner respecting JSON quoted strings/escapes can extract the array; then use `JSON.parse`, strict shape validation, and text-only output. Never use `eval`, `Function`, script execution or HTML injection.

Actual Hassan entry from the Day 2 page:

```json
{
  "title": "HASSAN",
  "id": "83",
  "color": "#FFFF00",
  "balloonText": "HASSAN :<\/br><img src=warning_images\/03.png style='width: 28px ; height:28px;float: left;'><p>Thunderstorm & Lightning, Squall etc<\/p><\/img><p>Updated on:2026-10-06<\/p>"
}
```

The corresponding radio header is `value="Day_2"` followed by **October 7, 2026**, and the script says `var check="Day_2"`. Normalize:

```json
{
  "provider": "IMD",
  "state": "Karnataka",
  "district": "Hassan",
  "provider_district_id": "83",
  "source_published_at": "2026-10-06",
  "forecast_date": "2026-10-07",
  "warning_colour": "yellow",
  "warning_text": "Thunderstorm & Lightning, Squall etc",
  "measurement_type": "official_district_warning",
  "verification_status": "OFFICIAL_CONFIRMED"
}
```

The source supplies a date, not an issuance timestamp/timezone in this record; do not invent an issuance time. Store the actual retrieval UTC timestamp separately. Do not interpret Day 2 relative to the application's wall clock when the source is stale; derive validity from the page's matching dated header. Unknown colour, ambiguous date, wrong selected day, missing Hassan, or changed structure must fail safely and retain previous valid records with stale status.

The API's numeric colour/warning codes are documented separately and are **not** the same as the webpage image filenames. The webpage's warning image `03.png` must not be treated as API warning code 3. The source text is the authority for this HTML adapter.

**Useful public fallback:** original official PDF and page links remain useful when machine-readable retrieval fails. These are official forecasts/advisories, not alternate observed or insurance data. Poll public warning HTML at most every 3–6 hours initially with timeout, response-size limit, fetch metadata and content-hash caching; no source-specific rate limit or explicit reuse licence was found.

## Agromet verified content and extraction limitations

The 6 October 2026 Karnataka agromet bulletin has a Hassan district section on **PDF page 48** (one-based). It advises arecanut growers about root-zone mulch without direct stem contact, need-based drip irrigation, and protecting productive palms during drought. Its black-pepper section recommends vine support and adequate irrigation against moisture stress. These are paraphrases of verified source content, not disease diagnoses or pesticide instructions.

The bulletin's forecast states Hassan could have light/moderate rain with thundershowers at a few places on **7 October 2026**. Its heavy-rain warning for 6 October lists other districts; do not turn a generic South Interior Karnataka heavy-rain warning into an estate-specific Hassan heavy-rain warning.

PDF extraction can otherwise accidentally attach a previous district's crop recommendations to Hassan. Version the downloaded source/hash, capture page references, detect exact district boundaries and validity dates, and require review when ambiguous. No verified current Hassan coffee pest/disease recommendation was extracted in this research pass. Weather alone cannot establish a crop disease.

## Insurance: current document found; coverage and calculation unverified

The [SLBC Karnataka homepage](https://slbckarnataka.com/) explicitly links **PMFBY and RWBCIS Notification Released for FY 2026–27** to the retrieved archive. SLBC is convened by Canara Bank; government notifications inside the archive are the primary evidence, while the host alone is not an underwriting decision.

Archive contents include `Notification Preamble.pdf` (13 scanned pages), `2026-06-15 (22).pdf` (12 pages), `2026-27 Cluster wise IC details.xls`, PMFBY annexures, sowing/harvest window PDFs, and XLSX copies. A visual inspection of the preamble's first scanned page confirms the Karnataka government notification date **12 June 2026** and PMFBY 2026 monsoon context. The 15 June PDF text identifies an RWBCIS government order reference `HORTI/336/HGM/2026`, dated **15 June 2026**. Kannada legacy-font extraction is not reliable enough to normalize crop/location/season cover, premium or conditions without visual/manual verification. The programme may refer to earlier-cycle terms; do not assume they remain applicable without the complete current chain.

| Crop | Selected policy year/season/location | Verified current coverage | Payout availability |
| --- | --- | --- | --- |
| Coffee | Not yet supplied; target Sakleshpur/Hassan, possible 2026–27 only as research scope | **Not verified** | Unavailable |
| Black pepper | Same missing season and insurance unit | **Not verified** | Unavailable |
| Arecanut | Same missing season and insurance unit | **Not verified** | Unavailable |

Neither historical RISC examples nor generic statements that arecanut/pepper have appeared under RWBCIS establish coverage for this user's selected year, season, village or unit. No reliable current station mapping or official payout-example fixture has been verified. There is consequently **no permissible insurance fallback and no payout formula to implement or test against official examples yet**.

Missing inputs/evidence for each crop:

1. User's policy year, season and whether actually enrolled.
2. Exact village/gram panchayat or notified insurance unit; policy/proposal reference is optional and sensitive.
3. Current crop/location coverage notification and any amendments.
4. Current insurer assignment and applicability to that unit.
5. Versioned official term sheet, document/page and verified policy period.
6. Actual insured area, sum insured, farmer premium/rate and applicable limits.
7. Weather trigger intervals, thresholds, payout formula and cap.
8. Exact current reference and backup weather station identifiers and mapping.
9. Authorized official observations for that station and period, including missing-data/backup handling rules.
10. Official worked payout example for numerical regression fixtures.

The product should say which items are missing: **“Insurance calculation unavailable because the official coverage, term sheet and reference weather station have not been verified for this crop, season and insurance unit.”** Store unverified policy metadata privately under owner RLS; verified reference terms must be service/reviewer controlled and versioned. A user's “currently insured” checkbox must never make coverage or terms verified.

## Reproducible retrieval evidence

Research raw responses were saved locally under `/private/tmp/estate-*` for inspection, including `estate-imd-warning-day2.html`, `estate-imd-warning-page.html`, `estate-imd-api-reference.html`, `estate-ksndmc-daily.html`, `estate-ksndmc-hassan.json` and the 2026–27 archive. They are temporary research artifacts, not app fixture data and not a guarantee of future endpoint availability. Request only allowlisted official hosts from Edge Functions, bound response size/time, follow redirects only to approved hosts, record HTTP status/parsed count and never replace valid stored data after an empty parse.
