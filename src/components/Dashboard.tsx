import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, productionMetrics } from '../lib/calculations'
import { dashboardActivity } from '../lib/dashboardData'
import type { EstateData } from '../lib/types'
import './dashboard.css'

type DashboardPage = 'Labour' | 'Expenses' | 'Production'
const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const compactMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value)
const monthName = (month: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, month, 1))
const expenseColors = ['#d1a24d', '#6f8f63', '#c37947', '#7895a4', '#a77b9b']

export function Dashboard({ data, year, onNavigate }: { data: EstateData; year: number; onNavigate?: (page: DashboardPage) => void }) {
  const [periodFromYear, setPeriodFromYear] = useState(year)
  const [periodFromMonth, setPeriodFromMonth] = useState(0)
  const [periodToYear, setPeriodToYear] = useState(year)
  const [periodToMonth, setPeriodToMonth] = useState(new Date().getMonth())
  const [selectedWorkerId, setSelectedWorkerId] = useState('')
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
  const periodStart = `${periodFromYear}-${String(periodFromMonth + 1).padStart(2, '0')}-01`
  const periodEndDay = new Date(periodToYear, periodToMonth + 1, 0).getDate()
  const periodEnd = `${periodToYear}-${String(periodToMonth + 1).padStart(2, '0')}-${String(periodEndDay).padStart(2, '0')}`
  const validPeriod = periodStart <= periodEnd
  const periodYears = [...new Set([periodFromYear, periodToYear, year, ...Array.from({ length: 11 }, (_, index) => year - 5 + index), ...data.weeklyPayments.map((payment) => Number(payment.week_start.slice(0, 4)))])].filter(Number.isFinite).sort((a, b) => b - a)
  const periodPayments = validPeriod ? data.weeklyPayments.filter((payment) => !payment.excluded && payment.week_start >= periodStart && payment.week_start <= periodEnd) : []
  const workerDayRows = data.workers.map((worker) => {
    const payments = periodPayments.filter((payment) => payment.worker_id === worker.id)
    const gross = payments.reduce((total, payment) => total + Number(payment.amount), 0)
    const deductions = payments.reduce((total, payment) => total + Number(payment.loan_deduction ?? 0), 0)
    return { worker, days: payments.reduce((total, payment) => total + Number(payment.days_worked ?? 0), 0), weeks: payments.length, gross, takeHome: Math.max(0, gross - deductions) }
  }).filter(({ worker, weeks }) => worker.active || weeks > 0)
  const periodWorkingDays = workerDayRows.reduce((sum, item) => sum + item.days, 0)
  const periodGrossPay = periodPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const periodTakeHome = periodPayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0)
  const periodOtherExpenses = validPeriod ? data.expenses.filter((expense) => expense.expense_date >= periodStart && expense.expense_date <= periodEnd).reduce((sum, expense) => sum + Number(expense.amount), 0) : 0
  const periodExpensesAndTakeHome = periodOtherExpenses + periodTakeHome
  const periodLoansPaid = (validPeriod ? data.workerLoans.filter((loan) => loan.kind === 'repayment' && loan.loan_date >= periodStart && loan.loan_date <= periodEnd).reduce((sum, loan) => sum + Number(loan.amount), 0) + data.jointLoanRepayments.filter((repayment) => repayment.repayment_date >= periodStart && repayment.repayment_date <= periodEnd).reduce((sum, repayment) => sum + Number(repayment.amount), 0) : 0)
  const selectedWorker = workerDayRows.find((row) => row.worker.id === selectedWorkerId) ?? workerDayRows[0]
  const latestSpendingMonth = [...activity.monthly].reverse().find((month) => month.spending > 0)
  const spendingVsAverage = latestSpendingMonth && averageSpending ? latestSpendingMonth.spending - averageSpending : 0
  const loanDeductions = data.weeklyPayments.filter((payment) => Number(payment.week_start.slice(0, 4)) === year && !payment.excluded).reduce((sum, payment) => sum + Number(payment.loan_deduction ?? 0), 0)
  const takeHomeYear = Math.max(0, harvest.labour - loanDeductions)
  const payrollSplitRows = activity.monthly.map((month, monthIndex) => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const deductions = data.weeklyPayments.filter((payment) => !payment.excluded && payment.week_start.startsWith(prefix)).reduce((sum, payment) => sum + Number(payment.loan_deduction ?? 0), 0)
    return { month: month.month, takeHome: Math.max(0, month.labour - deductions), deductions }
  })
  const loanOpeningBalance = Math.max(0,
    data.workerLoans.filter((loan) => loan.loan_date < `${year}-01-01`).reduce((sum, loan) => sum + (loan.kind === 'advance' ? Number(loan.amount) : -Number(loan.amount)), 0) +
    data.jointLoans.filter((loan) => loan.loan_date < `${year}-01-01`).reduce((sum, loan) => sum + Number(loan.amount), 0) -
    data.jointLoanRepayments.filter((repayment) => repayment.repayment_date < `${year}-01-01`).reduce((sum, repayment) => sum + Number(repayment.amount), 0)
  )
  let runningLoanBalance = loanOpeningBalance
  const loanTrendRows = activity.monthly.map((month, monthIndex) => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const given = data.workerLoans.filter((loan) => loan.kind === 'advance' && loan.loan_date.startsWith(prefix)).reduce((sum, loan) => sum + Number(loan.amount), 0) + data.jointLoans.filter((loan) => loan.loan_date.startsWith(prefix)).reduce((sum, loan) => sum + Number(loan.amount), 0)
    const repaid = data.workerLoans.filter((loan) => loan.kind === 'repayment' && loan.loan_date.startsWith(prefix)).reduce((sum, loan) => sum + Number(loan.amount), 0) + data.jointLoanRepayments.filter((repayment) => repayment.repayment_date.startsWith(prefix)).reduce((sum, repayment) => sum + Number(repayment.amount), 0)
    runningLoanBalance += given - repaid
    return { month: month.month, given, repaid, balance: Math.max(0, runningLoanBalance) }
  })
  const yearLoansGiven = loanTrendRows.reduce((sum, row) => sum + row.given, 0)
  const yearLoansRepaid = loanTrendRows.reduce((sum, row) => sum + row.repaid, 0)
  const currentLoanBalance = loanTrendRows.at(-1)?.balance ?? 0
  const recentRepaymentRows = loanTrendRows.filter((row) => row.repaid > 0).slice(-3)
  const averageRecentRepayment = recentRepaymentRows.length ? recentRepaymentRows.reduce((sum, row) => sum + row.repaid, 0) / recentRepaymentRows.length : 0
  const payoffMonths = currentLoanBalance > 0 && averageRecentRepayment > 0 ? Math.ceil(currentLoanBalance / averageRecentRepayment) : 0
  const projectedLoanRows = Array.from({ length: Math.min(payoffMonths, 12) }, (_, index) => {
    const date = new Date(year, 12 + index, 1)
    return { month: `${monthName(date.getMonth()).slice(0, 3)} ${String(date.getFullYear()).slice(2)}`, given: 0, repaid: 0, balance: null, projectedBalance: Math.max(0, currentLoanBalance - averageRecentRepayment * (index + 1)) }
  })
  const loanStoryRows = [...loanTrendRows.map((row) => ({ ...row, projectedBalance: null as number | null })), ...projectedLoanRows]
  const lastThreeLoanRows = loanTrendRows.slice(-3)
  const loansAreRising = lastThreeLoanRows.reduce((sum, row) => sum + row.given - row.repaid, 0) > 0
  const payoffText = currentLoanBalance <= 0 ? 'Cleared' : averageRecentRepayment > 0 ? payoffMonths <= 12 ? `${payoffMonths} months` : `about ${Math.ceil(payoffMonths / 12)} years` : 'No repayment pace yet'
  const loanSuggestion = currentLoanBalance <= 0 ? 'Loan balance is cleared.' : averageRecentRepayment <= 0 ? 'Start a regular weekly deduction to create an ending date.' : loansAreRising ? 'Balance is rising. Pause new advances or increase weekly deductions.' : `At the recent pace, loans may end in ${payoffText}.`
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
        <h1>Your estate at a glance.</h1>
        <p className="dashboard-welcome-copy">A clear view of your harvest, your people, and the numbers that matter.</p>
      </div>
      {onNavigate && <div className="dashboard-quick-actions" aria-label="Quick actions">
        <button className="dashboard-action-primary" onClick={() => onNavigate('Labour')}><span aria-hidden="true">＋</span> Record labour</button>
        <button className="dashboard-action-secondary" onClick={() => onNavigate('Expenses')}><span aria-hidden="true">＋</span> Add expense</button>
      </div>}
    </header>

    <section aria-label={`${year} estate summary`} className="dashboard-summary">
      <SummaryTile label="Harvest" value={quantity(harvest.bagsProduced)} unit="bags" detail={`${quantity(harvest.weightKg)} kg · ${year} crop`} icon="harvest" />
      <SummaryTile label="Recorded sales" value={money(activity.sales)} detail={`Sales dated in ${year}`} icon="sales" />
      <SummaryTile label="Total spending" value={money(activity.spending)} detail="Labour + estate expenses" icon="spending" />
      <SummaryTile label="Recorded balance" value={money(activity.balance)} detail="Sales minus spending" icon="balance" emphasis={activity.balance >= 0 ? 'positive' : 'negative'} />
    </section>

    <section className="dashboard-charts" aria-label="Estate insights">
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

      {harvest.labour > 0 && <article className="dashboard-panel dashboard-payroll-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Pay flow</p><h2>Take-home and loan deductions</h2></div><span className="dashboard-year-badge">Jan-Dec {year}</span></div>
        <p className="dashboard-description">See how saved wages split between cash to pay and loan deductions each month.</p>
        <div className="dashboard-chart-legend" aria-hidden="true"><span><i className="is-take-home" /> Take-home</span><span><i className="is-loan" /> Loan deductions</span></div>
        <div className="dashboard-payroll-chart" role="group" aria-label={`Monthly take-home pay and loan deductions for ${year}.`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={payrollSplitRows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
              <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
              <YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 10 }} tickFormatter={compactMoney} tickCount={5} />
              <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(month) => `${month} ${year}`} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 12, boxShadow: '0 6px 20px #23362d12' }} />
              <Bar dataKey="takeHome" name="Take-home" stackId="pay" fill="#174e3c" radius={[0, 0, 3, 3]} isAnimationActive={false} />
              <Bar dataKey="deductions" name="Loan deductions" stackId="pay" fill="#c37947" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>}

      {(yearLoansGiven > 0 || yearLoansRepaid > 0) && <article className="dashboard-panel dashboard-loan-trend-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Worker loans</p><h2>Loan trend and repayments</h2></div><span className="dashboard-year-badge">Jan-Dec {year}</span></div>
        <p className="dashboard-description">Follow advances, repayments, running balance, and the likely ending point if repayments continue at the recent pace.</p>
        <div className="dashboard-chart-legend" aria-hidden="true"><span><i className="is-loan-given" /> Loans given</span><span><i className="is-loan-repaid" /> Repaid</span><span><i className="is-loan-balance" /> Balance</span><span><i className="is-loan-projected" /> Projected end</span></div>
        <div className="dashboard-loan-trend-chart" role="group" aria-label={`Worker loan trend for ${year}.`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={loanStoryRows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
              <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
              <YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 10 }} tickFormatter={compactMoney} tickCount={5} />
              <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(month) => `${month} ${year}`} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 12, boxShadow: '0 6px 20px #23362d12' }} />
              <Bar dataKey="given" name="Loans given" fill="#b86e3d" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="repaid" name="Repaid" fill="#628a65" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line dataKey="balance" name="Running balance" type="linear" stroke="#173f2f" strokeWidth={3} dot={{ r: 3, strokeWidth: 0, fill: '#173f2f' }} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="projectedBalance" name="Projected balance" type="linear" stroke="#173f2f" strokeDasharray="6 5" strokeWidth={3} dot={{ r: 3, strokeWidth: 0, fill: '#173f2f' }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="dashboard-loan-advice"><div><span>Current balance</span><strong>{money(currentLoanBalance)}</strong></div><div><span>Likely end</span><strong>{payoffText}</strong></div><div><span>Suggestion</span><strong>{loanSuggestion}</strong></div></div>
      </article>}

      <article className="dashboard-panel dashboard-working-days-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Your team</p><h2>Working days &amp; pay</h2></div></div>
        <p className="dashboard-description">Choose a start and end month. Every worker total and payment figure below uses saved records inside that inclusive period.</p>
        <div className="dashboard-period-controls"><div><label>From<select aria-label="Period start year" value={periodFromYear} onChange={(event) => setPeriodFromYear(Number(event.target.value))}>{periodYears.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Period start month" value={periodFromMonth} onChange={(event) => setPeriodFromMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{monthName(month)}</option>)}</select></label><label>To<select aria-label="Period end year" value={periodToYear} onChange={(event) => setPeriodToYear(Number(event.target.value))}>{periodYears.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Period end month" value={periodToMonth} onChange={(event) => setPeriodToMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{monthName(month)}</option>)}</select></label></div></div>
        {!validPeriod && <p className="dashboard-period-error" role="alert">Choose a From month before the To month.</p>}
        <div className="dashboard-period-summary" aria-live="polite"><button type="button"><span>Working days</span><strong>{quantity(periodWorkingDays)} <em>days</em></strong><p>All workers</p></button><button type="button"><span>Gross payment</span><strong>{money(periodGrossPay)}</strong><p>Before loan deductions</p></button><button type="button"><span>Take-home to pay</span><strong>{money(periodTakeHome)}</strong><p>After weekly loan deductions</p></button><button type="button"><span>Loans paid</span><strong>{money(periodLoansPaid)}</strong><p>Weekly deductions and clearances</p></button><button type="button"><span>Expense cost</span><strong>{money(periodOtherExpenses)}</strong><p>Only estate expenses</p></button><button type="button"><span>Expense + labour</span><strong>{money(periodExpensesAndTakeHome)}</strong><p>Expenses plus take-home</p></button></div>
        <div className="dashboard-worker-period-heading"><h3>Worker working days</h3><p>{monthName(periodFromMonth).slice(0, 3)} {periodFromYear} to {monthName(periodToMonth).slice(0, 3)} {periodToYear}</p></div>
        {workerDayRows.length ? <div className="dashboard-worker-table-card"><div className="dashboard-table-scroll" tabIndex={0} role="region" aria-label="Worker working days and pay table"><table className="dashboard-worker-table"><caption className="sr-only">Worker working days and pay for selected range</caption><thead><tr><th scope="col">Worker</th><th scope="col">Weeks</th><th scope="col">Days</th><th scope="col">Gross</th><th scope="col">Take-home</th></tr></thead><tbody>{workerDayRows.map(({ worker, days, weeks, gross, takeHome }) => <tr key={worker.id} className={selectedWorker?.worker.id === worker.id ? 'is-selected' : ''} onClick={() => setSelectedWorkerId(worker.id)}><th scope="row"><button type="button" onClick={() => setSelectedWorkerId(worker.id)}><strong>{worker.name}</strong><span>{worker.active ? 'Active worker' : 'Inactive worker'}</span></button></th><td>{weeks}</td><td className="is-days">{quantity(days)}</td><td>{money(gross)}</td><td className="is-take-home">{money(takeHome)}</td></tr>)}</tbody></table></div>{selectedWorker && <div className="dashboard-worker-detail"><div><span>Selected worker</span><strong>{selectedWorker.worker.name}</strong></div><div><span>Average take-home / week</span><strong>{money(selectedWorker.weeks ? selectedWorker.takeHome / selectedWorker.weeks : 0)}</strong></div><div><span>Loan deducted</span><strong>{money(Math.max(0, selectedWorker.gross - selectedWorker.takeHome))}</strong></div></div>}</div> : <p className="dashboard-working-days-empty">No saved worker payments in this period.</p>}
      </article>

      <article className="dashboard-panel dashboard-expense-rhythm-panel">
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
      </article>
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
