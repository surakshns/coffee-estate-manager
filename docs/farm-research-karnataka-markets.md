# Karnataka, Hassan, DASD and arecanut source verification

Tested 7 October 2026 IST. Requests used ordinary public HTTP GETs; no login, CAPTCHA bypass, paid provider or private API key was used. HTTP statuses below are from actual server requests, rather than search-result snippets. Temporary response bodies are available under `/private/tmp/` in this development session.

## Source inventory

| Source | Authority / information | Verified URL / format | Access / status | Suggested polling | Limitations and insurance use |
| --- | --- | --- | --- | --- | --- |
| Karnataka Horticulture | Level 1, state department; notices, equipment empanelment, scheme guideline links | <https://horticulturedir.karnataka.gov.in/en> (HTML; `/english` redirects here) | HTTP 200, no authentication; **NO VERIFIED DOCUMENTED PUBLIC API FOUND** | Daily, conditional requests where supported | Site copyright policy requires prior permission for republishing content; direct hyperlinks are permitted. Keep source links and limited factual metadata, do not republish complete documents without permission. Not insurance observation data. |
| Karnataka Horticulture central schemes | Level 1; NHM, PMKSY-PDMC, equipment, farm pond, pest management guideline links | <https://horticulturedir.karnataka.gov.in/36/central-sector-schemes/en> (HTML + linked PDFs) | HTTP 200 | Daily | Page does not establish the financial year or current individual eligibility; do not display allocation or old assistance rates as a current entitlement. |
| Hassan district announcements | Level 1, NIC-hosted district administration; notices with start/end dates and PDFs | <https://hassan.nic.in/en/notice_category/announcements/> (HTML table) | HTTP 200 | Daily | Current first-page notices are Ganapati/fisheries, not coffee/pepper/arecanut. Legitimately zero crop-relevant updates. Do not ingest generic local content merely to fill feed. |
| Hassan announcements advertised RSS | Same authority | <https://hassan.nic.in/en/notice_category/announcements/feed/> (XML) | HTTP **500**, XML `No feed available!` | Do not poll this failed feed as a working adapter | HTML alternative works. Link headers advertise WordPress REST, but a documented, functioning notice API has not been established. |
| Hassan horticulture | Level 1; old crop-loss list links incl Sakaleshpura | <https://hassan.nic.in/en/horticulture/> (HTML + PDFs) | HTTP 200 | Daily metadata checks | Explicit **2024–25 Kharif** beneficiary lists; classify old. Avoid collecting/reposting individual beneficiary personal information. Current relief eligibility/deadline not verified. |
| Hassan agriculture | Level 1; department contact directory including Sakaleshpura officers | <https://hassan.nic.in/en/agriculture/> (HTML) | Official page successfully inspected through browser retrieval | Weekly directory checks | Contact directory, not a current scheme/insurance notice. |
| DASD | Level 1, Ministry of Agriculture subordinate office; 2026–27 programme plan | <https://dasd.kerala.gov.in/action-plan-2026-27/> (HTML tables) | HTTP 200, no authentication | Daily | **NO VERIFIED DOCUMENTED PUBLIC API FOUND**. Proposed institutional implementation is not automatic direct-grower eligibility. Text/table totals differ, so do not normalize a total budget without manual reconciliation. No insurance use. |
| Original DASD domain | Level 1 domain provided in request | <https://dasd.gov.in/> | Not accessible via browser tool; new official Kerala government domain above works | Use verified new domain | Do not invent an API on the old domain. |
| AGMARKNET 2.0 | Level 1, official government market reports | <https://agmarknet.gov.in/> (React HTML, public bundle) | HTTP 200; public bundle reveals `https://api.agmarknet.gov.in/v1/` | Prices daily; metadata weekly | Public website JSON endpoints are discovered, **not a documented stable external API contract**. Price date and market/grade must remain visible; market quotes are not a guaranteed estate selling price. |
| AGMARKNET public filter JSON | Same authority; real commodity/market/location IDs | <https://api.agmarknet.gov.in/v1/daily-price-arrival/filters> (JSON); <https://api.agmarknet.gov.in/v1/dashboard-commodities-filter> (JSON); <https://api.agmarknet.gov.in/v1/dashboard-filters/?dashboard_name=marketwise_price_arrival> (JSON) | All HTTP **200**, no authentication | Weekly | Metadata verified; successful filters do not establish successful price retrieval. Reuse permissions/terms for new AGMARKNET website not yet independently established. |
| AGMARKNET state-market report | Same authority; discovered in official JS bundle | `https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-market/daily-report-state-marketwise?date=2026-10-06&state=16&includeExcel=false&marketCategoryid=100004` | HTTP **500**, HTML error | Disabled pending a successful valid report response | Tested state string and official numeric ID; both failed. **No live arecanut price record verified** from this route. |
| AGMARKNET dashboard report | Same authority; POST route and fields discovered in official bundle | <https://api.agmarknet.gov.in/v1/dashboard-data/> (JSON) | HTTP **200**, `status:false`, `No data available`, empty `data` | Daily after valid data response | Tested 6 October 2026, commodity118, Karnataka16, Hassan254, markets734/735. HTTP success with zero records is not a successful price test. |
| data.gov.in mandi dataset | Level 1, DMI/Ministry of Agriculture; government open data | <https://www.data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi> (SSR HTML + official API/download link) | Dataset page HTTP 200; API host connection failure | Daily once reachable and free API key configured | Government Open Data License India is identified by the portal. Dataset points to resource `9ef84268-d588-465a-a308-a864a43d0070`. Do not treat dataset page updated time as an actual arecanut price date. |
| data.gov.in price API | Same authority | <https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070> (expected JSON/XML; actual response unavailable) | Connection failure on HTTPS with and without official dataset download-link key | Disabled until reachable; production free key server-side | Endpoint is verified as a link in official dataset metadata, but status/response/price records have **not** passed actual retrieval. No key embedded in app or documentation. |
| Karnataka legacy Krishi Marata Vahini | State market portal | <https://krishimaratavahini.kar.nic.in/> | DNS resolution failed even with network access | Disabled | No current records or API verified. Do not silently replace it with private scraped prices. |

## Actual records inspected

### Karnataka Horticulture equipment notice

The live department homepage links to:

- “Corrigendum to the empanelment list of manufacturers and authorized suppliers of horticultural equipment under the SMAM Scheme for the years 2026–27 and 2027–28”: <https://horticulturedir.karnataka.gov.in/uploads/Mech_Corrigendum_1788341466.pdf>. Actual PDF HTTP 200, 1,088,025 bytes, Last-Modified 2 September 2026. PDF is scanned without extractable text. This is a suppliers/empanelment notice, **not evidence of a particular farmer's subsidy approval/rate/deadline**.
- Related list: <https://horticulturedir.karnataka.gov.in/uploads/Mech_Annexure%201%20%28a%29_1788341409.pdf>. Title verified on the source homepage; PDF body not independently inspected in this pass.

### Karnataka 2026–27 horticulture training: enrollment expired

<https://horticulturedir.karnataka.gov.in/uploads/media_to_upload1773317827.pdf> returned HTTP 200, 2,059,503 bytes, 14 pages. The source title is “Notification-Selection of Trainees for Horticulture Training for the year 2026-27”. Kannada text on **PDF page 2** states:

- Application deadline **15 April 2026, 5:30 PM**.
- Course **2 May 2026 to 28 February 2027**.
- Eligibility includes SSLC with Kannada, reading/writing/speaking Kannada, specified age categories and cultivating land held by applicant's parent/guardian (with different ex-servicemen conditions).

Enrollment is **EXPIRED** on 7 October 2026. A current financial-year label must not make it appear as an open application. Eligibility requires careful Kannada/manual verification; this is not a general short farm training registration.

### DASD 2026–27 action plan

Actual HTML includes black pepper nucleus planting material, bush pepper, frontline demonstrations, nursery accreditation, farmers' training and institutional technology transfer. Arecanut plan includes ongoing research on arecanut/human health and leaf-spot disease demonstrations. The page says implementation is in association with agricultural universities, ICAR institutes and reputed NGOs. It is not an application call for every individual Sakleshpur grower; individual eligibility/application dates remain **UNVERIFIED**. Some other demonstrations on the site explicitly target Tripura and must not be recast as Karnataka assistance.

### AGMARKNET real metadata (not price records)

Verified JSON values:

```json
{
  "commodity": { "cmdt_id": 118, "cmdt_name": "Arecanut(Betelnut/Supari)" },
  "state": { "state_id": 16, "state_name": "Karnataka" },
  "district": { "id": 254, "state_id": 16, "district_name": "Hassan" },
  "markets": [
    { "id": 734, "mkt_name": "Arasikere APMC", "state_id": 16, "district_id": 254 },
    { "id": 735, "mkt_name": "Hassan APMC", "state_id": 16, "district_id": 254 }
  ]
}
```

The daily filter response also includes an official date-range upper bound `2026-10-06`. No Sakleshpur market was found in the returned market metadata. Hassan/Arasikere market membership does not prove arecanut trade on a particular day. A website-discovered dashboard POST returned HTTP200 but an explicit empty/no-data result for these two markets and this date. No price/min/max/modal/unit record from an official source passed this research pass; mark arecanut prices unavailable rather than inventing or adopting a commercial aggregator's quote.

## Implementation decisions

1. A cautious, server-side DASD plan notice adapter can store title, source link, financial year and exact provenance; leave individual eligibility and deadlines unknown.
2. Karnataka Horticulture should initially present verified source links/limited notice metadata pending republication permission. Keep schemes undated/unverified until an applicable current guideline is checked.
3. Hassan HTML parser must allow a successful response with zero estate-relevant notices and preserve prior valid records. The advertised RSS is broken and should not be used.
4. Arecanut adapter must expose a failed/unavailable source status. Optional free data.gov API credentials belong exclusively in Edge Function secrets once actual JSON retrieval succeeds.
5. No source here establishes insurance crop coverage, notified insurance unit, term sheet or reference weather station. Insurance calculations remain disabled; no market/district notice may substitute for those inputs.

## Remaining source validation

- Obtain a successful official arecanut price response, verify units, variety/grade, min/max/modal and date, and confirm the relevant market.
- Verify current official Kannada horticulture crop-specific assistance circulars and their financial years/deadlines; public page allocations alone are insufficient.
- Resolve permission for republishing Karnataka Horticulture material, or continue with source links.
- Scanned SMAM corrigendum was rendered and visually inspected: equipment suppliers/model prices are revised, rather than a farmer subsidy-percentage award. Require Kannada/manual review before extracting detailed amendments.
- Verify official insurance notifications and station mapping separately; this research never claims a current covered crop.
