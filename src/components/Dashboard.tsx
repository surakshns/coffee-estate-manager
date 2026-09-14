import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, productionMetrics } from '../lib/calculations'
import { dashboardActivity } from '../lib/dashboardData'
import type { EstateData } from '../lib/types'
import './dashboard.css'

type DashboardPage = 'Labour' | 'Expenses' | 'Production'
const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const compactMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value)
const monthName = (month: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, month, 1))

export function Dashboard({ data, year, onNavigate }: { data: EstateData; year: number; onNavigate?: (page: DashboardPage) => void }) {
  const [workingDaysMonth, setWorkingDaysMonth] = useState(new Date().getMonth())
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
  const categoryRows = activity.categories.length > 5
    ? [...activity.categories.slice(0, 4), { id: '__other_categories', name: 'Other categories', amount: activity.categories.slice(4).reduce((sum, category) => sum + category.amount, 0) }]
    : activity.categories
  const workerDayRows = data.workers.map((worker) => {
    const payments = data.weeklyPayments.filter((payment) => payment.worker_id === worker.id && !payment.excluded && new Date(`${payment.week_start}T12:00:00`).getFullYear() === year && new Date(`${payment.week_start}T12:00:00`).getMonth() === workingDaysMonth)
    return { worker, days: payments.reduce((total, payment) => total + Number(payment.days_worked ?? 0), 0), weeks: payments.length }
  }).filter(({ worker, weeks }) => worker.active || weeks > 0)
  const totalWorkingDays = workerDayRows.reduce((sum, item) => sum + item.days, 0)
  const fiscalStartYear = workingDaysMonth >= 6 ? year : year - 1
  const fiscalStart = `${fiscalStartYear}-07-01`
  const selectedMonthEndDay = new Date(year, workingDaysMonth + 1, 0).getDate()
  const selectedMonthEnd = `${year}-${String(workingDaysMonth + 1).padStart(2, '0')}-${String(selectedMonthEndDay).padStart(2, '0')}`
  const cumulativeWorkingDays = data.weeklyPayments
    .filter((payment) => !payment.excluded && payment.week_start >= fiscalStart && payment.week_start <= selectedMonthEnd)
    .reduce((sum, payment) => sum + Number(payment.days_worked ?? 0), 0)
  const cumulativeTakeHome = data.weeklyPayments
    .filter((payment) => !payment.excluded && payment.week_start >= fiscalStart && payment.week_start <= selectedMonthEnd)
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0)

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

      <article className="dashboard-panel dashboard-working-days-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Your team</p><h2>Monthly working days</h2></div><label className="dashboard-month-select"><span>Month</span><select value={workingDaysMonth} onChange={(event) => setWorkingDaysMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{monthName(month)}</option>)}</select></label></div>
        <p className="dashboard-description">Saved working days for each worker in {monthName(workingDaysMonth)} {year}.</p>
        <div className="dashboard-working-days-totals"><p><span>{monthName(workingDaysMonth)}</span><strong>{quantity(totalWorkingDays)}</strong> total working days</p><p><span>Jul {fiscalStartYear}–{monthName(workingDaysMonth).slice(0, 3)} {year}</span><strong>{quantity(cumulativeWorkingDays)}</strong> cumulative days</p></div>
        <div className="dashboard-working-days-list">{workerDayRows.length ? workerDayRows.map(({ worker, days, weeks }, index) => <article key={worker.id}><span className="dashboard-worker-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{worker.name}</h3><p>{weeks ? `${weeks} saved ${weeks === 1 ? 'week' : 'weeks'}` : 'No saved weeks yet'}</p></div><strong>{quantity(days)} <span>days</span></strong></article>) : <p className="dashboard-working-days-empty">Add a worker to see monthly working days.</p>}</div>
      </article>

      <article className="dashboard-panel dashboard-takehome-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Labour pay</p><h2>Financial-year take-home</h2></div><span className="dashboard-year-badge">Jul {fiscalStartYear}–{monthName(workingDaysMonth).slice(0, 3)} {year}</span></div>
        <p className="dashboard-description">Total take-home paid through the selected month, after all saved loan deductions.</p>
        <p className="dashboard-fiscal-takehome">{money(cumulativeTakeHome)}</p>
        <p className="dashboard-fiscal-takehome-detail">Cumulative pay from 1 July through {monthName(workingDaysMonth)} {year}.</p>
      </article>

      <article className="dashboard-panel dashboard-expense-rhythm-panel">
        <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Spending rhythm</p><h2>Labour versus estate costs</h2></div><span className="dashboard-year-badge">Jan–Dec {year}</span></div>
        <p className="dashboard-description">Each column shows where the month’s spending went.</p>
        {activity.spending > 0 ? <>
          <div className="dashboard-chart-legend" aria-hidden="true"><span><i className="is-labour" /> Labour pay</span><span><i className="is-other" /> Other estate costs</span></div>
          <div className="dashboard-expense-chart" role="group" aria-label={`Monthly spending split between labour and other estate costs for ${year}. Labour is ${money(activity.labour)} of ${money(activity.spending)} total spending.`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={activity.monthly} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 11 }} minTickGap={20} tickMargin={10} />
                <YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#68766d', fontSize: 10 }} tickFormatter={compactMoney} tickCount={5} />
                <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(month) => `${month} ${year}`} contentStyle={{ borderRadius: 12, borderColor: '#dce5da', fontSize: 12, boxShadow: '0 6px 20px #23362d12' }} />
                <Bar dataKey="labour" name="Labour pay" stackId="spending" fill="#8b563b" radius={[0, 0, 3, 3]} isAnimationActive={false} />
                <Bar dataKey="other" name="Other estate costs" stackId="spending" fill="#d1a24d" radius={[3, 3, 0, 0]} isAnimationActive={false} />
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
