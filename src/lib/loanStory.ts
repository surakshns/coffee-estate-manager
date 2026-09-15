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
  const start = 2025 * 12 + 6
  const rows: { month: string; given: number | null; repaid: number | null; balance: number | null; projectedBalance: number | null }[] = []
  for (let month = start; month <= current; month++) {
    const monthly = events.filter(e => monthIndex(e.date) === month)
    rows.push({ month: label(month), given: monthly.filter(e => e.advance).reduce((s, e) => s + e.amount, 0), repaid: monthly.filter(e => !e.advance).reduce((s, e) => s + e.amount, 0), balance: balanceAt(month), projectedBalance: null })
  }
  // Count complete calendar months plus the elapsed fraction of this month.
  const elapsedMonths = Math.max(0, current - start + now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
  const totalRepaid = events.filter(e => !e.advance && e.date >= '2025-07-01').reduce((sum, e) => sum + e.amount, 0)
  const pace = elapsedMonths > 0 ? totalRepaid / elapsedMonths : 0
  const balance = balanceAt(current)
  const workerName = (id: string) => data.workers.find(worker => worker.id === id)?.name ?? 'Deleted worker'
  const accounts = [...new Set(events.map(event => event.account))].map(id => {
    const ownEvents = events.filter(event => event.account === id)
    const outstanding = Math.max(0, ownEvents.reduce((sum, event) => sum + (event.advance ? event.amount : -event.amount), 0))
    const repaid = ownEvents.filter(event => !event.advance && event.date >= '2025-07-01').reduce((sum, event) => sum + event.amount, 0)
    const ownPace = elapsedMonths > 0 ? repaid / elapsedMonths : 0
    const remainingMonths = outstanding === 0 ? 0 : ownPace > 0 ? Math.ceil(outstanding / ownPace) : null
    const joint = data.jointLoans.find(loan => `joint:${loan.id}` === id)
    const name = joint ? `${workerName(joint.worker_one_id)} + ${workerName(joint.worker_two_id)}` : workerName(id.slice('worker:'.length))
    return { id, name, kind: joint ? `Joint loan · ${joint.loan_date}` : 'Individual loans', balance: outstanding, repaid, pace: ownPace, months: remainingMonths,
      end: outstanding === 0 ? 'Cleared' : remainingMonths === null ? 'No repayment pace' : label(current + remainingMonths) }
  }).filter(account => account.balance > 0)
  // A cleared account's repayments are never reassigned to another borrower.
  const unestimated = accounts.filter(account => account.months === null).length
  const months = unestimated ? null : Math.max(0, ...accounts.map(account => account.months ?? 0))
  const asOf = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  if (rows.length) rows[rows.length - 1].month = asOf
  return { rows, balance, pace, totalRepaid, elapsedMonths, months, asOf, accounts, unestimated,
    end: balance === 0 ? 'Cleared' : months === null ? 'Not enough repayments' : label(current + months) }
}
