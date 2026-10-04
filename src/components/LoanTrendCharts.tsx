import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '../lib/calculations'
import type { dashboardLoans } from '../lib/dashboardLoans'

type Loans = ReturnType<typeof dashboardLoans>
const compactMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value)

export function LoanTrendCharts({ loans }: { loans: Loans }) {
  const crossYear = loans.monthly[0]?.month.slice(0, 4) !== loans.monthly.at(-1)?.month.slice(0, 4)
  const monthTick = (value: string) => {
    const row = loans.monthly.find(item => item.month === value)
    return crossYear ? row?.label ?? value : row?.label.split(' ')[0] ?? value
  }

  return <article className="dashboard-panel dashboard-loan-trend-panel">
    <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">Selected range</p><h2>Loan trend and repayments</h2></div></div>
    <p className="dashboard-description">Each chart uses its own ₹ scale, so smaller repayments stay visible.</p>
    <div className="dashboard-loan-chart-grid">
      {([{ key: 'given', title: 'Advances', total: loans.given, color: '#a56545' }, { key: 'repaid', title: 'Repayments', total: loans.repaid, color: '#25634a' }] as const).map(series => <section className="dashboard-loan-chart-panel" key={series.key}>
        <div className="dashboard-loan-chart-heading"><h3>{series.title}</h3><strong>{money(series.total)}</strong></div>
        {series.total > 0 ? <div className="dashboard-loan-chart-viewport" tabIndex={loans.monthly.length > 18 ? 0 : undefined} role="group" aria-label={`${series.title} by month`}>
          <div className="dashboard-loan-chart-canvas" style={{ minWidth: loans.monthly.length > 18 ? loans.monthly.length * 28 + 52 : 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={loans.monthly} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#e5ebe4" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#647369', fontSize: 11 }} tickFormatter={monthTick} minTickGap={18} tickMargin={10} />
                <YAxis domain={[0, 'auto']} width={54} axisLine={false} tickLine={false} tick={{ fill: '#647369', fontSize: 11 }} tickFormatter={compactMoney} tickCount={5} />
                <Tooltip formatter={value => money(Number(value))} labelFormatter={value => loans.monthly.find(row => row.month === value)?.label ?? String(value)} contentStyle={{ borderRadius: 10, borderColor: '#dce4da', fontSize: 13 }} />
                <Bar dataKey={series.key} name={series.title} fill={series.color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div> : <p className="dashboard-loan-chart-empty">No {series.title.toLowerCase()} recorded in this range.</p>}
      </section>)}
    </div>
    <details className="dashboard-data-details"><summary>View monthly loan amounts</summary>
      <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-label="Monthly loan amounts">
        <table><caption className="sr-only">Monthly advances, repayments and closing balances</caption><thead><tr><th scope="col">Month</th><th scope="col">Advances</th><th scope="col">Repayments</th><th scope="col">Closing balance</th></tr></thead><tbody>{loans.monthly.map(row => <tr key={row.month}><th scope="row">{row.label}</th><td>{money(row.given)}</td><td>{money(row.repaid)}</td><td>{money(row.balance)}</td></tr>)}</tbody></table>
      </div>
    </details>
  </article>
}
