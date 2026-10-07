# Coffee Board / Spices Board source research

Verified 7 October 2026. Public metadata, prices and original links are used; full articles, applicant records and authenticated portal content are not mirrored. No verified public API was found for the enabled Board adapters. The advertised Spices Board RSS feed was retrieved as real XML but its ten items date from 2015–2019; it supplies no current farm programmes or price rows and is not activated. Browser scraping is not used.

## Coffee Board

Actual public HTTP 200 responses: [home](https://coffeeboard.gov.in/) (78,014 bytes) and [News](https://coffeeboard.gov.in/News.aspx) (63,979 bytes). The home page is server-rendered HTML. Its ICO indicator date and futures date occur in separate sections. On this retrieval the overall header says 7 October, the ICO section says **2 October 2026**, and futures says **5 June 2026**. International indicators/futures are not local estate selling rates.

| Section | Original value / unit / date |
| --- | --- |
| ICO Other Milds | 327.22 US cents/lb, 2 Oct 2026 |
| ICO Robustas | 167.81 US cents/lb, 2 Oct 2026 |
| ICE Arabica, Dec 2026 | 292.55 US cents/lb, 5 June 2026 |
| ICE Arabica, Mar / May 2027 | 284.30 / 280.90 US cents/lb, 5 June 2026 |
| London Robusta, Nov 2026 / Jan / Mar 2027 | 3528 / 3512 / 3492 USD/tonne, 5 June 2026 |

The live page repeats an element ID for two different futures rows. The parser reads table positions/contracts instead of treating repeated IDs as unique values. Date, unit and table-shape failures abort a batch.

News uses dated `DataList1` rows and interactive ASP.NET postback links. The adapter keeps metadata with a publisher-page reference, not a fabricated downloadable PDF URL. Recruitment/selected-candidate entries are filtered. Notice identity is a hash of source, normalized publisher URL, original title and publication date: row indices can change and paraphrases can coincide. Two NTA practice notices dated 25 September target non-traditional areas and are excluded for a Karnataka traditional estate. The 7 September Arabica hybrid release is confirmed publisher metadata; programme eligibility/deadlines in other notices remain unverified. The explicitly dated 2–6 March 2026 training is expired.

The [scheme index](https://coffeeboard.gov.in/15th-comission.html) was inspected. Its heading says through 2025–26, but a linked [May 2026 roasting/grinding notice](https://coffeeboard.gov.in/Schemes/Notification%20and%20modalities%20of%20R%20and%20U%20units%202026.pdf) includes FY 2026–27 continuation text. PDF page 1 identifies 25 May 2026 issuance, 14 August technical-feasibility cutoff and 15 September final-claim cutoff. This is a **new roasting/grinding-unit component**, not general coffee-estate machinery eligibility; both cutoffs are past. The [older 2024–25 to 2025–26 guideline](https://coffeeboard.gov.in/Schemes/CircularGuidelinesModalitiesofICDP-2024-25to2025-26.pdf) cannot supply current subsidy rates automatically. Current broad grower component rules/page references remain manual-review data; their percentages are not ingested as current.

The [grower registration instructions](https://coffeeboard.gov.in/RegistrationSearch.aspx) are public, but applications involve registration, OTP and CAPTCHA. The intelligence app links to official pages and collects only whether grower registration is available. It neither queries individual grower records nor collects identity numbers, OTPs or portal passwords.

## Spices Board

Actual [domestic indicative-price response](https://www.indianspices.com/marketing/price/domestic/current-market-price): HTTP 200, 126,453 bytes. The numeric rows are in the **server-rendered HTML table**, not an invented JSON endpoint. The header states Rs./Kg. Both pepper rows are dated **5 October 2026**, Cochin, Kerala, IPSTA reporter:

| Grade | Average | Minimum / maximum |
| --- | --- | --- |
| Garbled | 723 INR/kg | Not supplied (publisher dash → null) |
| Ungarbled | 703 INR/kg | Not supplied (publisher dash → null) |

These are indicative market averages, not guaranteed estate proceeds. Kerala is the **market location**, not a reason to exclude the indicator from a Sakleshpur pepper grower's feed. Changed headers/row shapes, missing prices, invalid dates or changed units fail safely. Prices are polled at most twice daily.

The supplied `whats-new.html` route redirected to the home page and was not used as a notifications API. The verified [programme page](https://www.indianspices.com/box5_programmes_schemes.html) explicitly describes FY 2026–27 applications from 1 July, development enrollment ending **21 September**, export-program enrollment ending **30 September**, and scheme continuation at most to **30 September 2026** or earlier replacement approval. These are past as of this audit. A listing's archival end date is not substituted for its application deadline.

The page links [SPICED detailed guidelines](https://www.indianspices.com/sites/default/files/Guidelines%20for%20implementation%20of%20SPICED%20Scheme-signed.pdf), a 74-page PDF titled through 2025–26. Pepper equipment appears in separate group and individual components (including printed/PDF page 19); thresholds, prior-assistance rules and documentary conditions are component-specific. No historical percentage or maximum is activated as a current entitlement. Current continuation, component budget, deadline revision and local applicability require review before scheme ingestion. [FY 2026–27 invitation](https://indianspices.com/trade/trade-notifications/notificationdetails.html?id=580) is a distinct notice; it does not by itself prove an open enrollment window on 7 October.

## Operational boundary

Enabled adapters retain short paraphrases, factual price data, original dates/units and links. They fetch fixed verified HTTPS URLs, validate redirects, limit requests to 15 seconds/2 MB and enforce twelve-hour database polling intervals. There is no login, CAPTCHA bypass, paid API, copied full guideline, or live claim of current subsidy eligibility. Disabled scheme sources expose their review status honestly. Recheck publisher conditions before any broader reproduction or new feed activation.

Crawler-rule checks: Coffee Board returned an empty HTTP 200 robots response; Spices Board returned HTML instead of usable robots directives; IMD returned 404. These responses do not establish a republication licence. The implementation retains factual data, short paraphrases and source links only. The [advertised Spices Board RSS](https://www.indianspices.com/rss.xml) returned HTTP 200 application/xml, about 55.7 KB, ten items; the newest is from July 2019. The usable current prices remain in the tested HTML table.
