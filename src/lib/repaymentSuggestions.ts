import { WEEKLY_REPAYMENT_NOTE } from './labourLoans'
import type { WeeklyPayment, WorkerLoan } from './types'

export interface LoanDeductionSuggestion {
  amount: number
  reason: string
  recommended: boolean
}

interface SuggestionInput {
  workerId: string
  paymentDate: string
  maximum: number
  loans: WorkerLoan[]
  payments: WeeklyPayment[]
}

const DAY = 86_400_000

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null
  return parsed
}

function positiveCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** Suggestions are choices only: the caller must never apply one automatically. */
export function loanDeductionSuggestions({ workerId, paymentDate, maximum, loans, payments }: SuggestionInput): LoanDeductionSuggestion[] {
  if (!Number.isFinite(maximum) || maximum <= 0) return []
  let limit = Math.floor(maximum * 100)
  if (!Number.isSafeInteger(limit)) return []
  // Multiplication can put an exact amount such as 1000.29 just below its cent.
  // Compare the amount itself before correcting either direction, so a genuine
  // fraction of a cent is never rounded above the supplied available balance.
  if (limit / 100 > maximum) limit -= 1
  else if (Number.isSafeInteger(limit + 1) && (limit + 1) / 100 <= maximum) limit += 1
  if (limit <= 0) return []
  const selectedDate = dateValue(paymentDate)
  const history: { cents: number; date: number }[] = []

  if (selectedDate !== null) {
    const repaymentKeys = new Set<string>()
    const linkedWeeklyDates = new Set<string>()
    const loanIds = new Set<string>()
    for (const loan of loans) {
      if (loan.worker_id !== workerId || loan.kind !== 'repayment' || loanIds.has(loan.id)) continue
      const date = dateValue(loan.loan_date)
      const cents = positiveCents(loan.amount)
      if (date === null || date >= selectedDate || cents === null) continue
      loanIds.add(loan.id)
      history.push({ cents, date })
      repaymentKeys.add(`${loan.loan_date}:${cents}`)
      if (loan.notes === WEEKLY_REPAYMENT_NOTE) linkedWeeklyDates.add(loan.loan_date)
    }

    const paymentKeys = new Set<string>()
    for (const payment of payments) {
      if (payment.worker_id !== workerId || payment.excluded) continue
      const date = dateValue(payment.week_start)
      const cents = positiveCents(payment.loan_deduction ?? 0)
      if (date === null || date >= selectedDate || cents === null) continue
      const key = `${payment.week_start}:${cents}`
      if (linkedWeeklyDates.has(payment.week_start) || repaymentKeys.has(key) || paymentKeys.has(key)) continue
      paymentKeys.add(key)
      history.push({ cents, date })
    }
  }

  const results: LoanDeductionSuggestion[] = []
  const chosen = new Set<number>()
  const add = (cents: number, reason: string, fromHistory = false) => {
    if (results.length >= 6 || cents <= 0 || cents > limit || chosen.has(cents)) return
    chosen.add(cents)
    results.push({ amount: cents / 100, reason, recommended: fromHistory && results.length === 0 })
  }

  if (selectedDate !== null && history.length) {
    const selected = new Date(selectedDate)
    const previousYear = selected.getUTCFullYear() - 1
    const month = selected.getUTCMonth()
    const lastDay = new Date(Date.UTC(previousYear, month + 1, 0)).getUTCDate()
    // 29 February anchors to 28 February when the previous year is not a leap year.
    const seasonalDate = Date.UTC(previousYear, month, Math.min(selected.getUTCDate(), lastDay))
    const latestDate = history.reduce((latest, item) => Math.max(latest, item.date), -Infinity)
    const amounts = new Map<number, { count: number; seasonal: number; distance: number; recentWeight: number; latest: number }>()
    for (const item of history) {
      if (item.cents > limit) continue
      const stats = amounts.get(item.cents) ?? { count: 0, seasonal: 0, distance: Infinity, recentWeight: 0, latest: 0 }
      stats.count += 1
      const distance = Math.abs(item.date - seasonalDate) / DAY
      if (distance <= 28) {
        stats.seasonal += 1
        stats.distance = Math.min(stats.distance, distance)
      }
      stats.recentWeight += Math.exp(-(selectedDate - item.date) / (180 * DAY))
      stats.latest = Math.max(stats.latest, item.date)
      amounts.set(item.cents, stats)
    }
    const ranked = [...amounts.entries()].map(([cents, stats]) => ({
      cents, ...stats,
      category: stats.seasonal ? 3 : stats.count >= 2 ? 2 : stats.latest === latestDate ? 1 : 0,
      reason: stats.seasonal ? 'Same time last year' : stats.count >= 2 ? 'Usual repayment' : stats.latest === latestDate ? 'Last repayment' : 'Previous repayment',
    })).sort((a, b) => b.category - a.category
      || b.seasonal - a.seasonal
      || (a.category === 3 ? a.distance - b.distance : 0)
      || b.recentWeight - a.recentWeight
      || b.count - a.count
      || b.latest - a.latest
      || a.cents - b.cents)
    for (const suggestion of ranked) add(suggestion.cents, suggestion.reason, true)
  }

  for (const amount of [100, 200, 250, 300, 500, 1000]) add(amount * 100, 'Quick amount')
  add(limit, 'Full available amount')
  for (const fraction of [1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6]) add(Math.round(limit * fraction), 'Quick amount')
  // Very small balances still get every available distinct choice, up to six.
  for (let cents = limit; results.length < 6 && cents > 0; cents -= 1) add(cents, 'Quick amount')
  return results
}
