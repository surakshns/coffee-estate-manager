import { describe, expect, it } from 'vitest'
import { dashboardLoans } from './dashboardLoans'
import type { EstateData, Worker, WorkerLoan } from './types'

const empty: EstateData = {
  workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], categories: [], expenses: [],
  prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: []
}
const worker = (id: string, name: string, active = true): Worker => ({ id, name, active, default_weekly_amount: 0 })
const loan = (id: string, workerId: string, date: string, amount: number, kind: WorkerLoan['kind'] = 'advance'): WorkerLoan => ({
  id, worker_id: workerId, loan_date: date, amount, kind, notes: ''
})

describe('dashboard loan range', () => {
  it('includes both complete boundary months, cross-year labels, and empty months', () => {
    const result = dashboardLoans({ ...empty, workerLoans: [
      loan('opening', 'w1', '2025-11-30', 1000),
      loan('first', 'w1', '2025-12-01', 200),
      loan('last', 'w1', '2026-02-28', 300, 'repayment'),
      loan('future', 'w1', '2026-03-01', 500)
    ] }, '2025-12', '2026-02')
    expect(result.valid).toBe(true)
    expect(result.monthly).toEqual([
      { month: '2025-12', label: 'Dec 2025', given: 200, repaid: 0, balance: 1200 },
      { month: '2026-01', label: 'Jan 2026', given: 0, repaid: 0, balance: 1200 },
      { month: '2026-02', label: 'Feb 2026', given: 0, repaid: 300, balance: 900 }
    ])
    expect(result).toMatchObject({ given: 200, repaid: 300, openingBalance: 1000, closingBalance: 900 })
    expect(result.accounts[0]).toMatchObject({ advanced: 1200, repaid: 300, periodGiven: 200, periodRepaid: 300, balance: 900, lastDate: '2026-02-28' })
    expect(result.accounts[0].records.map(record => record.id)).toEqual(['last', 'first', 'opening'])
  })

  it('does not let an overpaid account cancel another worker’s outstanding balance', () => {
    const result = dashboardLoans({ ...empty, workerLoans: [
      loan('debt', 'w1', '2025-12-10', 5000),
      loan('credit', 'w2', '2025-12-10', 8000, 'repayment'),
      loan('pay', 'w1', '2026-01-10', 500, 'repayment'),
      loan('new', 'w2', '2026-02-10', 100)
    ] }, '2026-01', '2026-02')
    expect(result.openingBalance).toBe(5000)
    expect(result.monthly.map(month => month.balance)).toEqual([4500, 4500])
    expect(result.closingBalance).toBe(4500)
    expect(result.accounts.map(account => account.balance)).toEqual([4500, 0])
  })

  it('uses the loan ledger once when a weekly payment carries the same deduction', () => {
    const result = dashboardLoans({ ...empty,
      workers: [worker('w1', 'Ravi')],
      workerLoans: [loan('advance', 'w1', '2026-01-01', 1000), loan('linked', 'w1', '2026-01-07', 250, 'repayment')],
      weeklyPayments: [{ id: 'pay', worker_id: 'w1', week_start: '2026-01-07', amount: 1500, loan_deduction: 250 }]
    }, '2026-01', '2026-01')
    expect(result.repaid).toBe(250)
    expect(result.closingBalance).toBe(750)
    expect(result.accounts[0]).toMatchObject({ repaid: 250, periodRepaid: 250 })
  })

  it('keeps active and paid workers alongside inactive and deleted loan accounts', () => {
    const result = dashboardLoans({ ...empty,
      workers: [worker('active', 'Active'), worker('paid', 'Paid', false), worker('loan', 'Loan', false), worker('excluded', 'Excluded', false), worker('old', 'Old', false), worker('future', 'Future', false)],
      weeklyPayments: [
        { id: 'paid', worker_id: 'paid', week_start: '2026-01-07', amount: 500 },
        { id: 'excluded', worker_id: 'excluded', week_start: '2026-01-07', amount: 500, excluded: true },
        { id: 'old', worker_id: 'old', week_start: '2025-12-31', amount: 500 }
      ],
      workerLoans: [loan('old-loan', 'loan', '2025-11-01', 50), loan('deleted-loan', 'deleted', '2026-01-31', 75), loan('future-loan', 'future', '2026-02-01', 100)]
    }, '2026-01', '2026-01')
    expect(result.accounts.map(account => account.workerId)).toEqual(['deleted', 'loan', 'active', 'paid'])
    expect(result.accounts[0]).toMatchObject({ name: 'Deleted worker', active: false, balance: 75 })
    expect(result.accounts.find(account => account.workerId === 'active')).toMatchObject({ advanced: 0, repaid: 0, balance: 0, records: [], lastDate: '' })
  })

  it('hides previously settled inactive accounts while retaining selected-range activity and saved zero pay', () => {
    const result = dashboardLoans({ ...empty,
      workers: [worker('old', 'Previously settled', false), worker('recent', 'Settled this month', false), worker('active', 'Active'), worker('zero-pay', 'Saved zero pay', false)],
      workerLoans: [
        loan('old-advance', 'old', '2025-11-01', 100), loan('old-repayment', 'old', '2025-12-01', 100, 'repayment'),
        loan('deleted-advance', 'deleted-old', '2025-11-01', 100), loan('deleted-repayment', 'deleted-old', '2025-12-01', 100, 'repayment'),
        loan('recent-advance', 'recent', '2025-12-01', 200), loan('recent-repayment', 'recent', '2026-01-07', 200, 'repayment'),
        loan('deleted-recent-advance', 'deleted-recent', '2025-12-01', 300), loan('deleted-recent-repayment', 'deleted-recent', '2026-01-07', 300, 'repayment'),
        loan('active-advance', 'active', '2025-11-01', 100), loan('active-repayment', 'active', '2025-12-01', 100, 'repayment')
      ],
      weeklyPayments: [{ id: 'zero', worker_id: 'zero-pay', week_start: '2026-01-07', amount: 0 }]
    }, '2026-01', '2026-01')
    expect(result.accounts.map(account => account.workerId).sort()).toEqual(['active', 'deleted-recent', 'recent', 'zero-pay'])
    expect(result.accounts.every(account => account.balance === 0)).toBe(true)
    expect(result.accounts.find(account => account.workerId === 'recent')).toMatchObject({ periodRepaid: 200, repaid: 200, balance: 0 })
    expect(result).toMatchObject({ openingBalance: 500, closingBalance: 0, repaid: 500 })
  })

  it('sums in integer cents and preserves loan history without mutating it', () => {
    const workerLoans = [loan('a', 'w1', '2026-01-01', 1000.29), loan('b', 'w1', '2026-01-02', 0.1), loan('c', 'w1', '2026-01-03', 0.2), loan('d', 'w1', '2026-01-04', 0.29, 'repayment')]
    const snapshot = workerLoans.map(record => ({ ...record }))
    const result = dashboardLoans({ ...empty, workerLoans }, '2026-01', '2026-01')
    expect(result.given).toBe(1000.59)
    expect(result.repaid).toBe(0.29)
    expect(result.closingBalance).toBe(1000.3)
    expect(result.accounts[0].advanced).toBe(1000.59)
    expect(workerLoans).toEqual(snapshot)
  })

  it('accepts leap days and skips invalid dates and amounts', () => {
    const result = dashboardLoans({ ...empty, workerLoans: [
      loan('leap', 'w1', '2024-02-29', 10),
      loan('bad-day', 'w1', '2024-02-30', 100),
      loan('bad-month', 'w1', '2024-13-01', 100),
      loan('nan', 'w1', '2024-02-01', Number.NaN),
      loan('negative', 'w1', '2024-02-01', -100)
    ] }, '2024-02', '2024-02')
    expect(result).toMatchObject({ given: 10, closingBalance: 10 })
    expect(result.accounts[0].records.map(record => record.id)).toEqual(['leap'])
  })

  it.each([
    ['2026-02', '2026-01'], ['2026-13', '2026-12'], ['2026-00', '2026-01'],
    ['2026-1', '2026-02'], ['2026-01-01', '2026-02'], ['', '2026-01'], ['0000-01', '2026-01']
  ])('returns a safe empty result for invalid range %s to %s', (from, to) => {
    const result = dashboardLoans({ ...empty, workers: [worker('w1', 'Ravi')], workerLoans: [loan('a', 'w1', '2026-01-01', 100)] }, from, to)
    expect(result).toEqual({ valid: false, monthly: [], given: 0, repaid: 0, openingBalance: 0, closingBalance: 0, accounts: [] })
  })

  it('returns zero chart rows for each month in a valid empty range', () => {
    const result = dashboardLoans(empty, '2026-09', '2026-10')
    expect(result.valid).toBe(true)
    expect(result.monthly).toEqual([
      { month: '2026-09', label: 'Sep 2026', given: 0, repaid: 0, balance: 0 },
      { month: '2026-10', label: 'Oct 2026', given: 0, repaid: 0, balance: 0 }
    ])
  })
})
