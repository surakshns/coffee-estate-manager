import { describe, expect, it } from 'vitest'
import { WEEKLY_REPAYMENT_NOTE } from './labourLoans'
import { loanDeductionSuggestions } from './repaymentSuggestions'
import type { WeeklyPayment, WorkerLoan } from './types'

const repayment = (id: string, amount: number, date: string, extra: Partial<WorkerLoan> = {}): WorkerLoan => ({
  id, worker_id: 'worker', loan_date: date, amount, kind: 'repayment', notes: '', ...extra,
})
const payment = (id: string, amount: number, date: string, extra: Partial<WeeklyPayment> = {}): WeeklyPayment => ({
  id, worker_id: 'worker', week_start: date, amount: 2000, loan_deduction: amount, ...extra,
})
const suggest = (loans: WorkerLoan[] = [], payments: WeeklyPayment[] = [], extra: Partial<Parameters<typeof loanDeductionSuggestions>[0]> = {}) =>
  loanDeductionSuggestions({ workerId: 'worker', paymentDate: '2026-10-04', maximum: 2000, loans, payments, ...extra })

describe('loan deduction suggestions', () => {
  it('prioritizes the same time last year over a frequent recent amount, without applying it', () => {
    const result = suggest([
      repayment('season', 750, '2025-10-11'),
      repayment('recent1', 500, '2026-09-06'),
      repayment('recent2', 500, '2026-09-13'),
      repayment('recent3', 500, '2026-09-20'),
      repayment('latest', 400, '2026-09-27'),
    ])
    expect(result.slice(0, 3)).toEqual([
      { amount: 750, reason: 'Same time last year', recommended: true },
      { amount: 500, reason: 'Usual repayment', recommended: false },
      { amount: 400, reason: 'Last repayment', recommended: false },
    ])
    expect(result).toHaveLength(6)
  })

  it('favors recent recurring repayments when there is no seasonal history', () => {
    const result = suggest([
      repayment('old1', 600, '2024-01-01'),
      repayment('old2', 600, '2024-02-01'),
      repayment('old3', 600, '2024-03-01'),
      repayment('new1', 450, '2026-09-06'),
      repayment('new2', 450, '2026-09-13'),
      repayment('last', 700, '2026-09-27'),
    ])
    expect(result[0]).toEqual({ amount: 450, reason: 'Usual repayment', recommended: true })
    expect(result.find(item => item.amount === 700)?.reason).toBe('Last repayment')
  })

  it('deduplicates weekly repayment records and falls back to unlinked payment deductions', () => {
    const result = suggest([
      repayment('weekly', 700, '2026-09-06', { notes: WEEKLY_REPAYMENT_NOTE }),
      repayment('manual', 600, '2026-09-20'),
      repayment('manual', 600, '2026-09-20'),
    ], [
      payment('same', 700, '2026-09-06'),
      payment('same-manual', 600, '2026-09-20'),
      payment('fallback', 800, '2026-09-27'),
      payment('fallback-again', 800, '2026-09-27'),
    ])
    expect(result[0]).toEqual({ amount: 800, reason: 'Last repayment', recommended: true })
    expect(result.find(item => item.amount === 700)?.reason).toBe('Previous repayment')
    expect(result.find(item => item.amount === 600)?.reason).toBe('Previous repayment')
    expect(result.some(item => item.reason === 'Usual repayment')).toBe(false)
  })

  it('excludes other workers, advances, excluded payments, invalid amounts and current or future dates', () => {
    const result = suggest([
      repayment('valid', 450, '2026-09-27'),
      repayment('other', 650, '2025-10-04', { worker_id: 'other' }),
      repayment('advance', 900, '2025-10-04', { kind: 'advance' }),
      repayment('current', 850, '2026-10-04'),
      repayment('future', 950, '2027-10-04'),
      repayment('bad-date', 1050, '2025-02-30'),
      repayment('bad-amount', NaN, '2025-10-04'),
      repayment('negative', -200, '2025-10-04'),
      repayment('zero', 0, '2025-10-04'),
    ], [
      payment('other-payment', 1100, '2025-10-04', { worker_id: 'other' }),
      payment('excluded', 1200, '2025-10-04', { excluded: true }),
      payment('current-payment', 1300, '2026-10-04'),
      payment('future-payment', 1400, '2026-10-11'),
    ])
    expect(result[0]).toEqual({ amount: 450, reason: 'Last repayment', recommended: true })
    expect(result.slice(1).every(item => item.reason === 'Quick amount')).toBe(true)
  })

  it('anchors leap day to the previous year and includes only the 28-day seasonal window', () => {
    const result = suggest([
      repayment('leap-anchor', 725, '2027-02-28'),
      repayment('inside-window', 625, '2027-01-31'),
      repayment('outside-window', 825, '2027-01-30'),
    ], [], { paymentDate: '2028-02-29' })
    expect(result[0]).toEqual({ amount: 725, reason: 'Same time last year', recommended: true })
    expect(result.find(item => item.amount === 625)?.reason).toBe('Same time last year')
    expect(result.find(item => item.amount === 825)?.reason).toBe('Previous repayment')
  })

  it('offers six unique quick amounts without recommending one when there is no history', () => {
    const result = suggest()
    expect(result.map(item => item.amount)).toEqual([100, 200, 250, 300, 500, 1000])
    expect(result.every(item => !item.recommended && item.reason === 'Quick amount')).toBe(true)
  })

  it('limits every option to available wages and balance, rounds repayments and fills small amounts', () => {
    const result = suggest([
      repayment('too-high', 750, '2025-10-04'),
      repayment('fraction', 12.345, '2026-09-27'),
    ], [], { maximum: 45.678 })
    expect(result[0]).toEqual({ amount: 12.35, reason: 'Last repayment', recommended: true })
    expect(result).toHaveLength(6)
    expect(new Set(result.map(item => item.amount)).size).toBe(6)
    expect(result.every(item => item.amount > 0 && item.amount <= 45.678)).toBe(true)
    expect(result.find(item => item.reason === 'Full available amount')?.amount).toBe(45.67)
    expect(suggest([], [], { maximum: 0.03 }).map(item => item.amount).sort()).toEqual([0.01, 0.02, 0.03])
  })

  it('returns no amounts when no positive currency amount is available', () => {
    for (const maximum of [0, -1, NaN, Infinity, 0.009]) expect(suggest([], [], { maximum })).toEqual([])
  })

  it('preserves exact two-decimal limits without rounding a real sub-cent balance up', () => {
    const loans = [repayment('exact', 1000.29, '2026-09-27')]
    const exact = suggest(loans, [], { maximum: 1000.29 })
    expect(exact[0]).toEqual({ amount: 1000.29, reason: 'Last repayment', recommended: true })
    expect(exact.every(item => item.amount <= 1000.29)).toBe(true)

    const below = suggest(loans, [], { maximum: 1000.2899 })
    expect(below.some(item => item.amount === 1000.29)).toBe(false)
    expect(below.every(item => item.amount <= 1000.2899)).toBe(true)

    expect(suggest([], [], { maximum: 575.29 }).find(item => item.reason === 'Full available amount')?.amount).toBe(575.29)
    expect(suggest([], [], { maximum: 575.2899 }).find(item => item.reason === 'Full available amount')?.amount).toBe(575.28)
    expect(suggest([], [], { maximum: 0.0099999999999999 })).toEqual([])
  })

  it('uses only quick amounts for an invalid selected date', () => {
    expect(suggest([repayment('historical', 725, '2025-10-04')], [], { paymentDate: '2026-02-30' })[0])
      .toEqual({ amount: 100, reason: 'Quick amount', recommended: false })
  })
})
