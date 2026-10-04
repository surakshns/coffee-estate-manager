# Home dashboard and Wednesday reminders

## Scope

Redesign Home around the owner's weekly advance workflow and a concise view of
the estate. This document records the original plan. The reminder implementation
now exists in the repository, but hosted delivery requires the setup in
[advance-reminders-setup.md](advance-reminders-setup.md) and is not enabled merely
by deploying the frontend.
The audit covers the repository's data model and current dashboard calculations.
No live account records were accessed, so there are no claims about actual estate
amounts, trends, or repayment performance.

## Proposed Home layout

1. **Wednesday advance:** payment date, Not saved / Saved / Needs review status,
   saved take-home amount, and Start advance / Edit advance action. This follows
   the current India-local payment week independently of the selected record year.
   After Wednesday 8 PM, an unsaved advance becomes an overdue action.
2. **Money summary:** calendar-year sales, recorded costs, and sales minus costs.
   Costs include gross wages and estate expenses. Make the resulting surplus or
   shortfall prominent without claiming it is a bank balance or accounting profit.
3. **One monthly chart:** stacked labour and estate costs, with a sales line.
   Include clear colours, a touch-friendly tooltip, a year label, and an expandable
   values table. Do not plot future months in the current year as observed zeros.
4. **Top costs:** the three largest recorded cost heads, each with amount and
   share, plus a link to expenses. Group remaining categories into Other only when
   necessary; full detail stays available.
5. **Harvest and stock:** crop-year bags produced, bags sold, remaining stock,
   average selling price, and one sold-progress bar. Flag sales above recorded
   production; do not quietly show negative stock as zero without explaining it.
6. **Worker loans:** current outstanding total, number of outstanding accounts,
   repayments for the selected year, and a compact repayment trend when there is
   enough history. Link to the full loan accounts and statements.

Use full-width panels and comfortable gaps on phones, two columns on larger
screens, readable names and important amounts, and 44px minimum action targets.
Keep detailed worker period reporting available in a secondary view; combine its
gross wages, deductions, and take-home into one pay summary. Totals that have no
action should be plain summary content rather than buttons.

## Remove or combine

- Replace the spending line chart and the separate cost-split chart with the one
  monthly sales-and-costs chart.
- Remove duplicate latest/highest/usual-spend cards and repeated largest-cost
  claims. Show a small number of signals beside the relevant chart or card.
- Combine the harvest summary tile and the larger harvest panel.
- Keep individual loan projections and lengthy payoff methodology in the detailed
  loan view rather than the default Home screen.
- Remove Home's cost-per-bag and profit-per-sold-bag claims: current records do not
  allocate calendar expenses to the crop whose sales can span multiple years.

## Useful signals and calculation rules

- Calendar finance uses sale dates, payment dates, and expense dates. Crop stock
  uses production_year and that crop's linked sales; label the different scopes.
- Gross wage cost comes from saved non-excluded payments. Take-home is the sum of
  max(0, gross wage minus deduction) for each payment. Loan deductions are not an
  extra expense and must not be counted twice as loan repayments.
- Current loan totals sum max(0, advances minus repayments) per worker. One
  worker's credit must not cancel another worker's debt. Exclude future-dated
  records when presenting an as-of-today balance.
- Only compare completed months. Use “recorded spending” rather than claiming a
  reliable usual spend from sparse months; omit comparisons without sufficient
  history. Identify a partial current month clearly.
- Use saved attendance only. Missing legacy attendance should remain unknown or
  be explicitly estimated from a known saved daily rate, never worker defaults.
- Suitable signals include a change in completed-month spending, largest cost
  share, unsold crop stock, or an outstanding loan with no recorded repayment in a
  clearly stated period. These are observations, not forecasts or prescriptions.

## Wednesday reminder behaviour

- Default schedule: Wednesday 20:00 in Asia/Kolkata, equivalent to 14:30 UTC.
  Ignore the dashboard's selected historical year when checking this reminder.
- Show advance status on Home throughout the week and highlight it if overdue.
- At the scheduled time, recheck the saved status in the database. Send one
  notification only if this Wednesday's advance remains unsaved and there are
  eligible workers. Do not send based on a stale client snapshot.
- Suggested notification: “Wednesday advance is not saved. Tap to finish this
  week's payment.” Do not include worker names, wage amounts, or loan details on
  the lock screen.
- Tapping the notification opens that exact Wednesday's weekly advance screen,
  selecting the correct year and month even if the app was last used elsewhere.
- Saving the week clears the in-app warning. Deduplicate delivery by account and
  Wednesday, handle retries, and remove expired push subscriptions.
- Provide an explicit Enable reminders action, enabled/disabled status, a test
  notification, and a way to turn reminders off. Permission is requested only
  after the user presses Enable reminders.
- Do not add repeated nightly alerts by default.

### Saved status

The existing UI treats any weekly_payments row for the exact Wednesday as saved,
including a valid zero-pay or skipped row. A normal atomic weekly save writes all
eligible workers. CSV imports can create partial weeks, and the existing tables
cannot reliably distinguish those from a completed save.

The reminder migration now adds an account-and-Wednesday completion marker,
updated in the same transaction as save_weekly_labour and removed by
clear_weekly_labour. Home uses the server's verified status when available, as
does the scheduled sender. Legacy/imported weeks without an established complete
save need review; the migration never backfills them as complete. A zero-total
completed week is still complete; an unsaved draft never is. See the setup guide
for migration and verification details.

### Delivery

The manifest supports installation, and sw.js now handles push notifications and
notification taps. The new functions manage account-protected subscriptions and
scheduled delivery. Supabase Cron invokes the sender; private push signing keys
and server credentials stay in hosted secrets, never the frontend bundle. Hosted
configuration and phone notification permission are required for live delivery.

On iPhone, Web Push requires the web app to be added to the Home Screen and the
user to allow notifications. Notification sound follows device settings; the web
app does not provide a continuous clock alarm or override silent/Focus settings.
The user uses both Android and iPhone. One account schedule applies to both;
connect notification permission and subscriptions separately on each phone.

References:

- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Notification options and device defaults](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification)
- [WebKit Home Screen notifications](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)

## Implementation and verification

1. Build and test shared dashboard calculations, India-local Wednesday status,
   and direct navigation to the selected advance date.
2. Rebuild the concise dashboard and preserve access to detailed worker/loan
   reporting. Check empty, sparse, historical-year, negative-result, and oversold
   states, plus phone layouts and accessible chart values.
3. Add the shared saved-status marker and reminder settings, then the push client,
   service worker, and scheduled sender. Keep existing records and ordinary weekly
   save/clear behaviour intact.
4. Configure the hosted schedule and push secrets; test on the user's phone with
   the app closed. Confirm unsaved sends once, saved/zero-pay/skipped-complete weeks
   do not send, permission denial is handled, retries do not duplicate alerts, and
   tapping opens the intended Wednesday.
