import type { EstateData } from './types'

export function loanStory(data: EstateData, now = new Date()) {
  const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
  const current = now.getFullYear() * 12 + now.getMonth()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const events = [
    ...data.workerLoans.map(l => ({ date: l.loan_date, account: `worker:${l.worker_id}`, amount: Number(l.amount), advance: l.kind === 'advance' })),
    ...data.jointLoans.map(l => ({ date: l.loan_date, account: `joint:${l.id}`, amount: Number(l.amount), advance: true })),
    ...data.jointLoanRepayments.map(l => ({ date: l.repayment_date, account: `joint:${l.joint_loan_id}`, amount: Number(l.amount), advance: false }))
  ].filter(e => e.date <= today)
  const balanceAt = (month: number) => {
    const accounts = new Map<string, number>()
    events.filter(e => monthIndex(e.date) <= month).forEach(e => accounts.set(e.account, (accounts.get(e.account) ?? 0) + (e.advance ? e.amount : -e.amount)))
    return [...accounts.values()].reduce((sum, amount) => sum + Math.max(0, amount), 0)
  }
  const label = (month: number) => new Date(Math.floor(month / 12), month % 12, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const start = 2025 * 12 + 5
  const rows: { month: string; given: number | null; repaid: number | null; balance: number | null; projectedBalance: number | null }[] = []
  for (let month = start; month <= current; month++) {
    const monthly = events.filter(e => monthIndex(e.date) === month)
    rows.push({ month: label(month), given: monthly.filter(e => e.advance).reduce((s, e) => s + e.amount, 0), repaid: monthly.filter(e => !e.advance).reduce((s, e) => s + e.amount, 0), balance: balanceAt(month), projectedBalance: null })
  }
  // Include zero-payment months and exclude the incomplete current month.
  const pace = events.filter(e => !e.advance && monthIndex(e.date) >= current - 3 && monthIndex(e.date) < current).reduce((s, e) => s + e.amount, 0) / 3
  const balance = balanceAt(current)
  const months = pace > 0 ? Math.ceil(balance / pace) : 0
  if (months && rows.length) {
    rows[rows.length - 1].projectedBalance = balance
    // Sample very long forecasts while always retaining the payoff endpoint.
    const step = Math.max(1, Math.ceil(months / 360))
    for (let offset = 1; offset < months; offset += step) rows.push({ month: label(current + offset), given: null, repaid: null, balance: null, projectedBalance: Math.max(0, balance - pace * offset) })
    rows.push({ month: label(current + months), given: null, repaid: null, balance: null, projectedBalance: 0 })
  }
  return { rows, balance, pace, end: balance === 0 ? 'Cleared' : months ? label(current + months) : 'Not enough repayments' }
}
