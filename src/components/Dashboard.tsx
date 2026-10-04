import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, productionMetrics } from '../lib/calculations'
import { dashboardActivity } from '../lib/dashboardData'
import type { EstateData } from '../lib/types'
import './dashboard.css'
import { ViewTabs } from './Workspace'
import { Bell, CalendarDays, ReceiptText, ArrowUpRight } from 'lucide-react'
import { currentAdvanceWeek } from '../lib/estateDates'
import { dashboardLoans } from '../lib/dashboardLoans'
import { DashboardWorkerCards, type DashboardWorkerRow } from './DashboardWorkerCards'
import { LoanTrendCharts } from './LoanTrendCharts'
import { reminderScheduleLabel, type AdvanceWeekStatus, type ReminderSchedule } from '../lib/advanceReminders'

type DashboardPage = 'Labour' | 'Expenses' | 'Production' | 'Rainfall'
const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const compactMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value)
const expenseColors = ['#d1a24d', '#6f8f63', '#c37947', '#7895a4', '#a77b9b']

function defaultRange(year: number) {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const currentYear = Number(parts.find(part => part.type === 'year')?.value)
  const currentMonth = parts.find(part => part.type === 'month')?.value ?? '12'
  return { from: `${year}-01`, to: `${year}-${year === currentYear ? currentMonth : '12'}` }
}

type DashboardReminder = { settings: ReminderSchedule; loading: boolean; ready: boolean; activeHere: boolean; error: boolean; weekStart?: string; weekStatus?: AdvanceWeekStatus }
export function Dashboard({ data, year, onNavigate, onStartAdvance, onAddExpense, onEditReminder, reminder }: { data: EstateData; year: number; onNavigate?: (page: DashboardPage) => void; onStartAdvance?: (week: string) => void; onAddExpense?: () => void; onEditReminder?: () => void; reminder?: DashboardReminder }) {
  const [dashboardView, setDashboardView] = useState<'overview' | 'team'>('overview')
  const [range, setRange] = useState(() => ({ ...defaultRange(year), year }))
  const { from, to } = range.year === year ? range : defaultRange(year)
  const advanceWeek = currentAdvanceWeek()
  const advanceSaved = data.weeklyPayments.some(payment => payment.week_start === advanceWeek)
  const advanceStatus = reminder?.weekStart === advanceWeek && reminder.weekStatus ? ({ complete: 'Saved', needs_review: 'Needs review', not_saved: 'Not saved', no_workers: 'No workers' }[reminder.weekStatus]) : advanceSaved ? reminder?.error || reminder?.loading ? 'Recorded' : 'Saved' : 'Not saved'
  const reminderState = !reminder ? 'Not enabled' : reminder.loading ? 'Checking…' : reminder.error ? 'Unavailable' : !reminder.ready ? 'Setup required' : !reminder.settings.enabled ? 'Off' : reminder.activeHere ? 'On' : 'Connect this phone'
  const advanceDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${advanceWeek}T12:00:00Z`))
  const updateRange = (next: { from: string; to: string }) => setRange({ ...next, year })
  const harvest = productionMetrics(data.production, data.sales, data.expenses, data.weeklyPayments, year)
  const activity = dashboardActivity(data, year)
  const hasSpending = Boolean(activity.spending)
  const remaining = Math.max(0, harvest.bagsProduced - harvest.bagsSold)
  const oversold = harvest.bagsSold > harvest.bagsProduced
  const percentSold = harvest.bagsProduced ? Math.min(100, Math.round(harvest.bagsSold / harvest.bagsProduced * 100)) : 0
  const mostSpent = activity.monthly.reduce((highest, month) => month.spending > highest.spending ? month : highest)
  const monthsWithSpending = activity.monthly.filter((month) => month.spending > 0).length
  const averageSpending = monthsWithSpending ? activity.spending / monthsWithSpending : 0
  const labourShare = activity.spending ? Math.round(activity.labour / activity.spending * 100) : 0
  const expenseSeries = useMemo(() => {
    const rows = activity.categories.filter((category) => category.id !== '__weekly_labour').slice(0, 4)
    const hasOther = activity.categories.filter((category) => category.id !== '__weekly_labour').slice(4).some((category) => category.amount > 0)
    return [...rows.map((category, index) => ({ id: `expense_${index}`, categoryId: category.id, name: category.name, color: expenseColors[index] })), ...(hasOther ? [{ id: 'expense_other', categoryId: '__other', name: 'Other expenses', color: expenseColors[4] }] : [])]
  }, [activity.categories])
  const expenseRhythmRows = useMemo(() => activity.monthly.map((month, monthIndex) => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const row: Record<string, number | string> = { ...month }
    expenseSeries.forEach((series) => { row[series.id] = 0 })
    data.expenses.filter((expense) => expense.expense_date.startsWith(prefix)).forEach((expense) => {
      const series = expenseSeries.find((item) => item.categoryId === expense.category_id) ?? expenseSeries.find((item) => item.categoryId === '__other')
      if (series) row[series.id] = Number(row[series.id] ?? 0) + Number(expense.amount)
    })
    return row
  }), [activity.monthly, data.expenses, expenseSeries, year])
  const categoryRows = activity.categories.length > 5
    ? [...activity.categories.slice(0, 4), { id: '__other_categories', name: 'Other categories', amount: activity.categories.slice(4).reduce((sum, category) => sum + category.amount, 0) }]
    : activity.categories
  const loans = useMemo(() => dashboardLoans(data, from, to), [data, from, to])
  const periodPayments = loans.valid ? data.weeklyPayments.filter(payment => !payment.excluded && payment.week_start.slice(0, 7) >= from && payment.week_start.slice(0, 7) <= to) : []
  const workerRows: DashboardWorkerRow[] = loans.accounts.map(account => {
    const payments = periodPayments.filter(payment => payment.worker_id === account.workerId)
    const gross = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const deducted = payments.reduce((sum, payment) => sum + Number(payment.loan_deduction ?? 0), 0)
    const takeHome = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0)
    const days = payments.some(payment => payment.days_worked == null) ? null : payments.reduce((sum, payment) => sum + Number(payment.days_worked), 0)
    return { ...account, days, weeks: payments.length, gross, deducted, takeHome }
  })
  const periodWorkingDays = periodPayments.reduce((sum, payment) => sum + Number(payment.days_worked ?? 0), 0)
  const missingAttendance = periodPayments.filter(payment => payment.days_worked == null).length
  const periodGrossPay = workerRows.reduce((sum, worker) => sum + worker.gross, 0)
  const periodDeductions = workerRows.reduce((sum, worker) => sum + worker.deducted, 0)
  const periodTakeHome = workerRows.reduce((sum, worker) => sum + worker.takeHome, 0)
  const savedWeeks = new Set(periodPayments.map(payment => payment.week_start)).size
  const recordedMonths = [...data.weeklyPayments.filter(payment => !payment.excluded).map(payment => payment.week_start.slice(0, 7)), ...data.workerLoans.map(loan => loan.loan_date.slice(0, 7))].filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort()
  const lastTwelveMonths = () => {
    const end = defaultRange(year).to
    const start = new Date(`${end}-01T00:00:00Z`)
    start.setUTCMonth(start.getUTCMonth() - 11)
    updateRange({ from: start.toISOString().slice(0, 7), to: end })
  }
  const latestSpendingMonth = [...activity.monthly].reverse().find((month) => month.spending > 0)
  const spendingVsAverage = latestSpendingMonth && averageSpending ? latestSpendingMonth.spending - averageSpending : 0
  const loanDeductions = data.weeklyPayments.filter((payment) => Number(payment.week_start.slice(0, 4)) === year && !payment.excluded).reduce((sum, payment) => sum + Number(payment.loan_deduction ?? 0), 0)
  const takeHomeYear = Math.max(0, harvest.labour - loanDeductions)
  const payrollSplitRows = loans.monthly.map(month => {
    const payments = periodPayments.filter(payment => payment.week_start.startsWith(month.month))
    return { month: month.label, takeHome: payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0), deductions: payments.reduce((sum, payment) => sum + Number(payment.loan_deduction ?? 0), 0) }
  })
  const insightCards = [
    latestSpendingMonth ? { label: 'Latest spend pulse', value: money(latestSpendingMonth.spending), detail: averageSpending ? `${latestSpendingMonth.month} is ${money(Math.abs(spendingVsAverage))} ${spendingVsAverage >= 0 ? 'above' : 'below'} the usual month.` : `${latestSpendingMonth.month} has recorded spending.` } : null,
    activity.categories[0] ? { label: 'Largest cost head', value: activity.categories[0].name, detail: `${money(activity.categories[0].amount)} recorded in ${year}.` } : null,
    harvest.bagsProduced ? { label: 'Cost per bag', value: money(harvest.costPerBag), detail: `${money(harvest.totalExpenses)} spent across ${quantity(harvest.bagsProduced)} bags.` } : null,
    harvest.bagsSold ? { label: 'Profit per sold bag', value: money(harvest.profitPerBag), detail: `${money(harvest.profit)} balance from ${quantity(harvest.bagsSold)} sold bags.` } : null,
    harvest.labour ? { label: 'Take-home vs loans', value: money(takeHomeYear), detail: `${money(loanDeductions)} went to loan deductions from wages.` } : null
  ].filter(Boolean) as { label: string; value: string; detail: string }[]

  return <div className="page estate-dashboard">
    <header className="dashboard-hero dashboard-welcome">
      <div>
        <p className="dashboard-eyebrow"><span aria-hidden="true" className="dashboard-season-dot" /> {year} overview</p>
        <h1>Estate overview</h1>
      </div>
    </header>

    {(onStartAdvance || onAddExpense) && <section className="dashboard-entry-actions" aria-label="Add your regular records">
      {onStartAdvance && <button type="button" className="dashboard-entry-card is-advance" aria-label={advanceSaved ? 'Edit this week’s advance' : 'Start this week’s advance'} onClick={() => onStartAdvance(advanceWeek)}>
        <span className="dashboard-entry-icon" aria-hidden="true"><CalendarDays size={23} /></span>
        <span className="dashboard-entry-copy"><span className="dashboard-entry-label">This week’s advance</span><strong>{advanceSaved ? 'Edit advance' : 'Start advance'}</strong><span className="dashboard-entry-detail"><span>{advanceDate}</span><span className={`dashboard-entry-status${advanceStatus === 'Saved' ? ' is-saved' : ''}`}>{advanceStatus}</span></span></span>
        <ArrowUpRight size={21} aria-hidden="true" />
      </button>}
      {onAddExpense && <button type="button" className="dashboard-entry-card" aria-label="Add expense" onClick={onAddExpense}>
        <span className="dashboard-entry-icon" aria-hidden="true"><ReceiptText size={23} /></span>
        <span className="dashboard-entry-copy"><span className="dashboard-entry-label">Estate expenses</span><strong>Add expense</strong><span className="dashboard-entry-detail">Amount, category &amp; date</span></span>
        <ArrowUpRight size={21} aria-hidden="true" />
      </button>}
    </section>}
    {onEditReminder && <div className="dashboard-reminder-row"><Bell size={18} aria-hidden="true" /><div><strong>{reminderScheduleLabel(reminder?.settings ?? { enabled: false, weekday: 3, time: '20:00' })}</strong><span>{reminderState}</span></div><button type="button" onClick={onEditReminder}>Edit reminder<ArrowUpRight size={16} aria-hidden="true" /></button></div>}

    <ViewTabs<'overview' | 'team'> label="Dashboard views" value={dashboardView} onChange={setDashboardView} items={[{ value: 'overview', label: 'Overview' }, { value: 'team', label: 'Workers & loans' }]} />
    {dashboardView === 'overview' && <section aria-label={`${year} estate summary`} className="dashboard-summary">
      <SummaryTile label="Harvest" value={quantity(harvest.bagsProduced)} unit="bags" detail={`${quantity(harvest.weightKg)} kg · ${year} crop`} icon="harvest" />
      <SummaryTile label="Recorded sales" value={money(activity.sales)} detail={`Sales dated in ${year}`} icon="sales" />
      <SummaryTile label="Total spending" value={money(activity.spending)} detail="Labour + estate expenses" icon="spending" />
      <SummaryTile label="Recorded balance" value={money(activity.balance)} detail="Sales minus spending" icon="balance" emphasis={activity.balance >= 0 ? 'positive' : 'negative'} />
    </section>}

    <section className="dashboard-charts" aria-label="Estate insights">
      {dashboardView === 'overview' && <>
      <article className="dashboard-panel dashboard-activity-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">The bigger picture</p><h2>Monthly spending</h2></div><span className="dashboard-year-badge">Jan–Dec {year}</span></div>
        <p className="dashboard-description">See your labour and estate spending month by month.</p>
        {hasSpending ? <>
          <div className="dashboard-line-chart" role="group" aria-label={`Monthly spending for ${year}. Total spending is ${money(activity.spending)}. Monthly values are available in the table below.`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={activity.monthly} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
                <YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 10 }} tickFormatter={compactMoney} tickCount={5} />
                <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(month) => `${month} ${year}`} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 12, boxShadow: '0 6px 20px #23362d12' }} />
                <Line dataKey="spending" name="Spending" type="linear" stroke="#174e3c" strokeWidth={3} dot={{ r: 3, strokeWidth: 0, fill: '#174e3c' }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="dashboard-insight"><span aria-hidden="true">↗</span><span><strong>{mostSpent.month}</strong> has the highest recorded spending: <strong>{money(mostSpent.spending)}</strong>.</span></p>
          <details className="dashboard-data-details"><summary>View monthly spending</summary><div className="dashboard-table-scroll" tabIndex={0} role="region" aria-label="Monthly spending table"><table><caption className="sr-only">Calendar year {year} spending in Indian rupees</caption><thead><tr><th scope="col">Month</th><th scope="col">Spending</th></tr></thead><tbody>{activity.monthly.map((month) => <tr key={month.month}><th scope="row">{month.month}</th><td>{money(month.spending)}</td></tr>)}</tbody></table></div></details>
        </> : <EmptyChart symbol="₹" title="Your spending trend will appear here" description="Save a labour payment or estate expense to see monthly spending." action={onNavigate ? () => onNavigate('Expenses') : undefined} actionLabel="Add your first expense" />}
        <p className="dashboard-footnote">Based on labour payments and estate expense record dates. Loan advances and repayments are not included.</p>
      </article>

      <article className="dashboard-panel dashboard-spending-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Every rupee, accounted for</p><h2>Where money goes</h2></div><span aria-hidden="true" className="dashboard-panel-icon">₹</span></div>
        <p className="dashboard-description">Your spending breakdown in {year}.</p>
        {activity.categories.length ? <>
          <p className="dashboard-spending-total">{money(activity.spending)} <span>total spending</span></p>
          <ul className="dashboard-category-list">{categoryRows.map((category, index) => <li key={category.id}>
            <div className="dashboard-category-label"><span>{category.name}</span><strong>{money(category.amount)}</strong></div>
            <div className="dashboard-category-track" aria-hidden="true"><span style={{ width: `${activity.spending ? category.amount / activity.spending * 100 : 0}%`, backgroundColor: ['#174e3c', '#63806b', '#8da18a', '#aa835c', '#cfbd9e'][index] }} /></div>
            <p className="dashboard-category-share">{Math.round(category.amount / activity.spending * 100)}% of spending</p>
          </li>)}</ul>
          <p className="dashboard-insight"><span aria-hidden="true">◎</span><span><strong>{activity.categories[0].name}</strong> is your largest recorded cost.</span></p>
          {activity.categories.length > 5 && <details className="dashboard-data-details"><summary>View all {activity.categories.length} categories</summary><dl className="dashboard-all-categories">{activity.categories.map((category) => <div key={category.id}><dt>{category.name}</dt><dd>{money(category.amount)}</dd></div>)}</dl></details>}
        </> : <EmptyChart symbol="₹" title="A place for every expense" description="Your labour payments and estate expenses will appear here, grouped into easy-to-read categories." action={onNavigate ? () => onNavigate('Labour') : undefined} actionLabel="Record labour pay" />}
      </article>

      </>}
      {dashboardView === 'team' && <>
        <article className="dashboard-panel dashboard-range-panel">
          <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Pay &amp; loans together</p><h2>Choose your range</h2></div></div>
          <div className="dashboard-range-inputs">
            <label>From<input type="month" aria-label="Period start month" value={from} onChange={event => updateRange({ from: event.target.value, to })} /></label>
            <label>To<input type="month" aria-label="Period end month" value={to} onChange={event => updateRange({ from, to: event.target.value })} /></label>
          </div>
          <div className="dashboard-range-presets" aria-label="Date range shortcuts">
            <button type="button" onClick={() => updateRange(defaultRange(year))}>{year}</button>
            <button type="button" onClick={lastTwelveMonths}>Last 12 months</button>
            {recordedMonths.length > 0 && <button type="button" onClick={() => updateRange({ from: recordedMonths[0], to: recordedMonths[recordedMonths.length - 1] })}>All recorded</button>}
          </div>
          {!loans.valid && <p className="dashboard-range-error" role="alert">Choose both months, with the From month before or equal to the To month.</p>}
          {loans.valid && <div className="dashboard-range-summary" aria-live="polite">
            <div><span>Take-home pay</span><strong>{money(periodTakeHome)}</strong><p>{money(periodGrossPay)} gross · {money(periodDeductions)} deducted</p></div>
            <div><span>Recorded workdays</span><strong>{quantity(periodWorkingDays)} <em>days</em></strong><p>{savedWeeks} saved {savedWeeks === 1 ? 'week' : 'weeks'}{missingAttendance > 0 ? ` · ${missingAttendance} ${missingAttendance === 1 ? 'entry has' : 'entries have'} no attendance` : ''}</p></div>
            <div><span>Loan balance at range end</span><strong>{money(loans.closingBalance)}</strong><p>{loans.monthly.at(-1)?.label} · includes earlier loans</p></div>
          </div>}
        </article>
        {loans.valid && <>
          <LoanTrendCharts loans={loans} />
          <DashboardWorkerCards rows={workerRows} from={from} to={to} />
          {periodGrossPay > 0 && <details className="dashboard-panel dashboard-payroll-panel dashboard-payroll-details">
            <summary>Monthly pay breakdown</summary>
            <p className="dashboard-description">Saved wages split between take-home pay and loan deductions.</p>
            <div className="dashboard-chart-legend" aria-hidden="true"><span><i className="is-take-home" /> Take-home</span><span><i className="is-loan" /> Loan deductions</span></div>
            <div className="dashboard-loan-chart-viewport" tabIndex={payrollSplitRows.length > 18 ? 0 : undefined} role="group" aria-label="Monthly take-home pay and loan deductions">
              <div className="dashboard-payroll-chart" style={{ minWidth: payrollSplitRows.length > 18 ? payrollSplitRows.length * 28 + 52 : 0 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={payrollSplitRows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
                    <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
                    <YAxis domain={[0, 'auto']} width={54} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} tickFormatter={compactMoney} tickCount={5} />
                    <Tooltip formatter={value => money(Number(value))} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 13 }} />
                    <Bar dataKey="takeHome" name="Take-home" stackId="pay" fill="#174e3c" isAnimationActive={false} />
                    <Bar dataKey="deductions" name="Loan deductions" stackId="pay" fill="#c37947" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-label="Monthly pay amounts"><table><caption className="sr-only">Monthly take-home pay and wage deductions in the selected range</caption><thead><tr><th scope="col">Month</th><th scope="col">Take-home</th><th scope="col">Loan deductions</th></tr></thead><tbody>{payrollSplitRows.map(row => <tr key={row.month}><th scope="row">{row.month}</th><td>{money(row.takeHome)}</td><td>{money(row.deductions)}</td></tr>)}</tbody></table></div>
          </details>}
        </>}
      </>}

      {dashboardView === 'overview' && <><article className="dashboard-panel dashboard-expense-rhythm-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Spending rhythm</p><h2>Labour versus estate costs</h2></div><span className="dashboard-year-badge">Jan–Dec {year}</span></div>
        <p className="dashboard-description">Each column shows where the month’s spending went.</p>
        {activity.spending > 0 ? <>
          <div className="dashboard-chart-legend" aria-hidden="true"><span><i className="is-labour" /> Labour pay</span>{expenseSeries.map((series) => <span key={series.id}><i style={{ background: series.color }} /> {series.name}</span>)}</div>
          <div className="dashboard-expense-chart" role="group" aria-label={`Monthly spending split between labour and other estate costs for ${year}. Labour is ${money(activity.labour)} of ${money(activity.spending)} total spending.`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={expenseRhythmRows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
                <YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 10 }} tickFormatter={compactMoney} tickCount={5} />
                <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(month) => `${month} ${year}`} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 12, boxShadow: '0 6px 20px #23362d12' }} />
                <Bar dataKey="labour" name="Labour pay" stackId="spending" fill="#8b563b" radius={[0, 0, 3, 3]} isAnimationActive={false} />
                {expenseSeries.map((series, index) => <Bar key={series.id} dataKey={series.id} name={series.name} stackId="spending" fill={series.color} radius={index === expenseSeries.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="dashboard-expense-insights">
            <Insight label="Usual monthly spend" value={money(averageSpending)} detail={monthsWithSpending === 1 ? 'from 1 recorded month' : `across ${monthsWithSpending} recorded months`} />
            <Insight label="Labour share" value={`${labourShare}%`} detail={`${money(activity.labour)} in weekly pay`} />
            <Insight label="Highest spend month" value={mostSpent.month} detail={money(mostSpent.spending)} />
          </div>
        </> : <EmptyChart symbol="₹" title="Expense patterns will appear here" description="Save labour payments or expenses to understand how each month’s spending is split." action={onNavigate ? () => onNavigate('Expenses') : undefined} actionLabel="Add an expense" />}
      </article>

      <article className="dashboard-panel dashboard-insights-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Useful signals</p><h2>Insights from your records</h2></div><span className="dashboard-year-badge">Decision help</span></div>
        {insightCards.length ? <div className="dashboard-insight-grid">{insightCards.map((insight) => <Insight key={insight.label} {...insight} />)}</div> : <EmptyChart symbol="◎" title="Insights will appear here" description="Add sales, labour, expenses, or harvest records to see helpful estate signals." action={onNavigate ? () => onNavigate('Expenses') : undefined} actionLabel="Add records" />}
      </article>

      <article className="dashboard-panel dashboard-harvest-panel">
        <div className="dashboard-harvest-intro"><p className="dashboard-eyebrow">From the field</p><h2>Your {year} harvest</h2><p className="dashboard-description">Track how much of this crop has been sold.</p>{onNavigate && <button className="dashboard-text-action" onClick={() => onNavigate('Production')}>Manage harvest & sales <span aria-hidden="true">↗</span></button>}</div>
        <div className="dashboard-harvest-body">
          {harvest.bagsProduced > 0 ? <>
            <div className="dashboard-harvest-label"><p><strong>{quantity(harvest.bagsSold)}</strong> of {quantity(harvest.bagsProduced)} bags sold</p><span>{oversold ? 'Check records' : `${percentSold}%`}</span></div>
            <div className="dashboard-harvest-progress" role="progressbar" aria-label={`${year} harvest sold`} aria-valuemin={0} aria-valuemax={harvest.bagsProduced} aria-valuenow={Math.min(harvest.bagsSold, harvest.bagsProduced)} aria-valuetext={`${quantity(harvest.bagsSold)} of ${quantity(harvest.bagsProduced)} bags sold${oversold ? '; sales exceed recorded harvest' : ''}`}><span style={{ width: `${percentSold}%` }} /></div>
            <div className="dashboard-harvest-figures"><div><span>{oversold ? 'Above recorded harvest' : 'Bags remaining'}</span><strong>{quantity(oversold ? harvest.bagsSold - harvest.bagsProduced : remaining)}</strong></div><div><span>Average sale price / bag</span><strong>{harvest.bagsSold ? money(harvest.averageSellingPrice) : '—'}</strong></div><div><span>Sales from this harvest</span><strong>{money(harvest.revenue)}</strong></div></div>
            {oversold && <p className="dashboard-record-warning">Sales exceed the recorded harvest. Check the production and sales entries for {year}.</p>}
          </> : <div className="dashboard-harvest-empty"><span aria-hidden="true" className="dashboard-empty-symbol">♧</span><div><h3>{harvest.bagsSold > 0 ? 'Add the harvest behind your sales' : 'Ready for this year’s harvest'}</h3><p>{harvest.bagsSold > 0 ? `${quantity(harvest.bagsSold)} bags sold from this crop. Add production to calculate what remains.` : 'Add bags produced to follow your progress from harvest to sale.'}</p></div></div>}
          <p className="dashboard-footnote">Only the {year} production crop, including its sales in other years. This can differ from calendar-year sales above.</p>
        </div>
      </article></>}

    </section>
  </div>
}

function SummaryTile({ label, value, unit, detail, icon, emphasis }: { label: string; value: string; unit?: string; detail: string; icon: 'harvest' | 'sales' | 'spending' | 'balance'; emphasis?: 'positive' | 'negative' }) {
  return <div className={`dashboard-summary-tile ${emphasis ? `is-${emphasis}` : ''}`}><div className="dashboard-summary-heading"><p>{label}</p><span aria-hidden="true" className="dashboard-summary-icon"><StatIcon name={icon} /></span></div><p className="dashboard-summary-value">{value}{unit && <span> {unit}</span>}</p><p className="dashboard-summary-detail">{detail}</p></div>
}

function Insight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><p>{label}</p><strong>{value}</strong><span>{detail}</span></div>
}

function StatIcon({ name }: { name: 'harvest' | 'sales' | 'spending' | 'balance' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'harvest' ? <><path d="M5 20c2-4 4-7 8-10" /><path d="M7 15C2 7 12 3 20 4c0 9-5 16-13 11Z" /><path d="m12 12 1 4" /></> : name === 'sales' ? <><path d="M4 10h12v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" /><path d="M16 11h2a3 3 0 1 1 0 6h-2M7 3v3m6-3v3" /></> : name === 'spending' ? <><path d="M5 4h14v17l-3-2-4 2-4-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h3" /></> : <><path d="M4 19h16M6 15l4-5 4 2 5-7" /><path d="M15 5h4v4" /></>}</svg>
}

function EmptyChart({ symbol, title, description, action, actionLabel }: { symbol: string; title: string; description: string; action?: () => void; actionLabel: string }) {
  return <div className="dashboard-empty"><span aria-hidden="true" className="dashboard-empty-symbol">{symbol}</span><h3>{title}</h3><p>{description}</p>{action && <button className="dashboard-text-action" onClick={action}>{actionLabel} <span aria-hidden="true">→</span></button>}</div>
}
