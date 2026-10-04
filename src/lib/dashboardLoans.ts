import type { EstateData, WorkerLoan } from './types'

export interface DashboardLoanMonth {
  month: string
  label: string
  given: number
  repaid: number
  balance: number
}

export interface DashboardLoanAccount {
  workerId: string
  name: string
  active: boolean
  advanced: number
  repaid: number
  balance: number
  periodGiven: number
  periodRepaid: number
  lastDate: string
  records: WorkerLoan[]
}

export interface DashboardLoans {
  valid: boolean
  monthly: DashboardLoanMonth[]
  given: number
  repaid: number
  openingBalance: number
  closingBalance: number
  accounts: DashboardLoanAccount[]
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthIndex(value: string): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  return year > 0 ? year * 12 + Number(value.slice(5, 7)) - 1 : null
}

function dateMonth(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const index = monthIndex(value.slice(0, 7))
  if (index === null) return null
  const year = Math.floor(index / 12)
  const month = index % 12
  const days = month === 1
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [3, 5, 8, 10].includes(month) ? 30 : 31
  const day = Number(value.slice(8, 10))
  return day >= 1 && day <= days ? index : null
}

const positiveBalance = (balances: Map<string, number>) => [...balances.values()].reduce((sum, cents) => sum + Math.max(0, cents), 0)

/** Loans use the loan ledger only; linked weekly deductions are already recorded there. */
export function dashboardLoans(data: EstateData, from: string, to: string): DashboardLoans {
  const start = monthIndex(from)
  const end = monthIndex(to)
  if (start === null || end === null || start > end) {
    return { valid: false, monthly: [], given: 0, repaid: 0, openingBalance: 0, closingBalance: 0, accounts: [] }
  }

  const workers = new Map(data.workers.map(worker => [worker.id, worker]))
  const included = new Set(data.workers.filter(worker => worker.active).map(worker => worker.id))
  const relevantInRange = new Set(included)
  for (const payment of data.weeklyPayments) {
    const month = dateMonth(payment.week_start)
    if (!payment.excluded && month !== null && month >= start && month <= end) {
      included.add(payment.worker_id)
      relevantInRange.add(payment.worker_id)
    }
  }

  const records = new Map<string, WorkerLoan[]>()
  const balances = new Map<string, number>()
  const totals = new Map<string, { advanced: number; repaid: number; periodGiven: number; periodRepaid: number }>()
  const events = new Map<number, { workerId: string; cents: number; advance: boolean }[]>()
  for (const loan of data.workerLoans) {
    const month = dateMonth(loan.loan_date)
    const amount = Number(loan.amount)
    if (month === null || month > end || !Number.isFinite(amount) || amount < 0) continue
    const cents = Math.round(amount * 100)
    const advance = loan.kind === 'advance'
    included.add(loan.worker_id)
    const ownRecords = records.get(loan.worker_id) ?? []
    ownRecords.push(loan)
    records.set(loan.worker_id, ownRecords)
    const ownTotals = totals.get(loan.worker_id) ?? { advanced: 0, repaid: 0, periodGiven: 0, periodRepaid: 0 }
    if (advance) ownTotals.advanced += cents
    else ownTotals.repaid += cents
    if (month < start) {
      balances.set(loan.worker_id, (balances.get(loan.worker_id) ?? 0) + (advance ? cents : -cents))
    } else {
      relevantInRange.add(loan.worker_id)
      if (advance) ownTotals.periodGiven += cents
      else ownTotals.periodRepaid += cents
      const monthlyEvents = events.get(month) ?? []
      monthlyEvents.push({ workerId: loan.worker_id, cents, advance })
      events.set(month, monthlyEvents)
    }
    totals.set(loan.worker_id, ownTotals)
  }

  // Clamp each account separately so one worker's credit cannot clear another worker's debt.
  const openingBalance = positiveBalance(balances) / 100
  const monthly: DashboardLoanMonth[] = []
  let given = 0
  let repaid = 0
  for (let month = start; month <= end; month++) {
    let monthGiven = 0
    let monthRepaid = 0
    for (const event of events.get(month) ?? []) {
      if (event.advance) monthGiven += event.cents
      else monthRepaid += event.cents
      balances.set(event.workerId, (balances.get(event.workerId) ?? 0) + (event.advance ? event.cents : -event.cents))
    }
    given += monthGiven
    repaid += monthRepaid
    const year = Math.floor(month / 12)
    const calendarMonth = month % 12
    monthly.push({
      month: `${String(year).padStart(4, '0')}-${String(calendarMonth + 1).padStart(2, '0')}`,
      label: `${monthNames[calendarMonth]} ${year}`,
      given: monthGiven / 100,
      repaid: monthRepaid / 100,
      balance: positiveBalance(balances) / 100
    })
  }

  const accounts = [...included].filter(workerId => relevantInRange.has(workerId) || (balances.get(workerId) ?? 0) > 0).map(workerId => {
    const worker = workers.get(workerId)
    const ownTotals = totals.get(workerId)
    const ownRecords = [...(records.get(workerId) ?? [])].sort((a, b) => b.loan_date.localeCompare(a.loan_date) || a.id.localeCompare(b.id))
    return {
      workerId, name: worker?.name ?? 'Deleted worker', active: worker?.active ?? false,
      advanced: (ownTotals?.advanced ?? 0) / 100,
      repaid: (ownTotals?.repaid ?? 0) / 100,
      balance: Math.max(0, balances.get(workerId) ?? 0) / 100,
      periodGiven: (ownTotals?.periodGiven ?? 0) / 100,
      periodRepaid: (ownTotals?.periodRepaid ?? 0) / 100,
      lastDate: ownRecords[0]?.loan_date ?? '',
      records: ownRecords
    }
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name) || a.workerId.localeCompare(b.workerId))

  return { valid: true, monthly, given: given / 100, repaid: repaid / 100, openingBalance, closingBalance: positiveBalance(balances) / 100, accounts }
}
