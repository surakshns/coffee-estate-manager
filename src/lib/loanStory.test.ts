import { expect, it } from 'vitest'
import { loanStory } from './loanStory'
import type { EstateData } from './types'

const empty: EstateData = { workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], jointLoans: [], jointLoanRepayments: [], categories: [], expenses: [], prices: [], monthlyGuideEntries: [], production: [], sales: [] }
const now = new Date(2026, 8, 15)
it('carries earlier loans, includes zero repayment months and projects beyond twelve months', () => {
  const result = loanStory({ ...empty, workerLoans: [
    { id: 'a', worker_id: 'w', loan_date: '2025-01-01', amount: 18000, kind: 'advance', notes: '' },
    { id: 'r', worker_id: 'w', loan_date: '2026-07-01', amount: 3000, kind: 'repayment', notes: '' },
    { id: 'future', worker_id: 'w', loan_date: '2027-01-01', amount: 10000, kind: 'advance', notes: '' }
  ] }, now)
  expect(result.rows[0]).toMatchObject({ month: 'Jun 2025', balance: 18000 })
  expect(result.balance).toBe(15000)
  expect(result.pace).toBe(1000)
  expect(result.end).toBe('Dec 2027')
  expect(result.rows.find(r => r.month === 'Sept 2026')).toMatchObject({ balance: 15000, projectedBalance: 15000 })
  expect(result.rows.at(-1)?.projectedBalance).toBe(0)
})
it('counts joint loans once and does not offset another worker debt with a credit', () => {
  const result = loanStory({ ...empty,
    jointLoans: [{ id: 'j', worker_one_id: 'a', worker_two_id: 'b', loan_date: '2025-06-01', amount: 1000, notes: '' }],
    jointLoanRepayments: [{ id: 'r', joint_loan_id: 'j', worker_id: 'a', repayment_date: '2025-07-01', amount: 200, notes: '' }],
    workerLoans: [{ id: 'credit', worker_id: 'c', loan_date: '2025-06-01', amount: 100, kind: 'repayment', notes: '' }]
  }, now)
  expect(result.balance).toBe(800)
  expect(result.end).toBe('Not enough repayments')
  expect(result.rows.at(-1)?.projectedBalance).toBeNull()
})
