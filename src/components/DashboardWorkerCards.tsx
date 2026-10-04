import { useState } from 'react'
import { money } from '../lib/calculations'
import type { WorkerLoan } from '../lib/types'
import { displayDate } from './Workspace'

export type DashboardWorkerRow = {
  workerId: string
  name: string
  active: boolean
  days: number | null
  weeks: number
  gross: number
  deducted: number
  takeHome: number
  balance: number
  advanced: number
  repaid: number
  periodGiven: number
  periodRepaid: number
  records: WorkerLoan[]
}

const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const sorts = [{ key: 'name', label: 'Name' }, { key: 'takeHome', label: 'Take-home pay' }, { key: 'balance', label: 'Loan balance' }, { key: 'days', label: 'Working days' }, { key: 'periodRepaid', label: 'Loan repayments' }] as const
type Sort = typeof sorts[number]['key']

export function DashboardWorkerCards({ rows, from, to }: { rows: DashboardWorkerRow[]; from: string; to: string }) {
  const [sort, setSort] = useState<Sort>('name')
  const [ascending, setAscending] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [rangeKey, setRangeKey] = useState(`${from}:${to}`)
  const key = `${from}:${to}`
  const showAll = rangeKey === key && expanded
  const sorted = [...rows].sort((a, b) => {
    const difference = sort === 'name' ? a.name.localeCompare(b.name, 'en-IN', { numeric: true, sensitivity: 'base' }) : Number(a[sort] ?? 0) - Number(b[sort] ?? 0)
    return (ascending ? difference : -difference) || a.name.localeCompare(b.name) || a.workerId.localeCompare(b.workerId)
  })

  return <article className="dashboard-panel dashboard-combined-workers">
    <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow">One card per worker</p><h2>Worker pay &amp; loans</h2></div><span className="dashboard-year-badge">{rows.length} {rows.length === 1 ? 'worker' : 'workers'}</span></div>
    <p className="dashboard-description">Pay uses the selected range. Loan balances include earlier advances through the range end.</p>
    {rows.length > 0 && <div className="dashboard-worker-sort"><label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as Sort); setAscending(event.target.value === 'name') }}>{sorts.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><button type="button" onClick={() => setAscending(value => !value)}>{sort === 'name' ? ascending ? 'A → Z' : 'Z → A' : ascending ? 'Lowest first ↑' : 'Highest first ↓'}</button></div>}
    <div className="dashboard-worker-cards">{sorted.slice(0, showAll ? undefined : 6).map(row => {
      const transactions = row.records.filter(record => record.loan_date.slice(0, 7) >= from && record.loan_date.slice(0, 7) <= to)
      return <article key={row.workerId} className="dashboard-worker-card" aria-label={`${row.name} pay and loans`}>
        <header><div><h3>{row.name}</h3><p>{row.days === null ? 'Attendance not recorded' : `${quantity(row.days)} days`} · {row.weeks} {row.weeks === 1 ? 'saved week' : 'saved weeks'}</p></div>{!row.active && <span className="dashboard-worker-status">Inactive</span>}</header>
        <dl className="dashboard-worker-card-main"><div><dt>Take-home pay</dt><dd>{money(row.takeHome)}</dd></div><div><dt>Loan balance</dt><dd>{money(row.balance)}</dd></div></dl>
        <details className="dashboard-worker-card-details"><summary>Pay &amp; loan details for {row.name}</summary>
          <dl><div><dt>Gross pay</dt><dd>{money(row.gross)}</dd></div><div><dt>Deducted from pay</dt><dd>{money(row.deducted)}</dd></div><div><dt>Average take-home / week</dt><dd>{row.weeks ? money(row.takeHome / row.weeks) : '—'}</dd></div><div><dt>Advances in range</dt><dd>{money(row.periodGiven)}</dd></div><div><dt>Repaid in range</dt><dd>{money(row.periodRepaid)}</dd></div><div><dt>Total advanced to range end</dt><dd>{money(row.advanced)}</dd></div><div><dt>Total repaid to range end</dt><dd>{money(row.repaid)}</dd></div></dl>
          {transactions.length > 0 && <details className="dashboard-worker-loan-history"><summary>View {transactions.length} loan {transactions.length === 1 ? 'entry' : 'entries'} in range</summary><ol>{transactions.map(record => <li key={record.id}><div><span>{record.kind === 'advance' ? 'Advance' : 'Repayment'}</span><time dateTime={record.loan_date}>{displayDate(record.loan_date)}</time></div><strong>{money(Number(record.amount))}</strong></li>)}</ol></details>}
        </details>
      </article>
    })}</div>
    {rows.length > 6 && <button type="button" className="dashboard-text-action" onClick={() => { setRangeKey(key); setExpanded(value => rangeKey === key ? !value : true) }}>{showAll ? 'Show fewer workers' : `Show all ${rows.length} workers`}</button>}
    {!rows.length && <p className="dashboard-working-days-empty">No worker pay or loan records in this range.</p>}
  </article>
}
