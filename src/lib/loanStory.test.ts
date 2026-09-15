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
  expect(result.rows[0]).toMatchObject({ month: 'Jul 2025', balance: 18000 })
  expect(result.balance).toBe(15000)
  expect(result.elapsedMonths).toBe(14.5)
  expect(result.pace).toBeCloseTo(3000 / 14.5)
  expect(result.end).toBe('Oct 2032')
  expect(result.rows).toHaveLength(15)
  expect(result.rows.at(-1)).toMatchObject({ balance: 15000, month: result.asOf })
  expect(result.totalRepaid).toBe(3000)
})
it('counts joint loans once and does not offset another worker debt with a credit', () => {
  const result = loanStory({ ...empty,
    jointLoans: [{ id: 'j', worker_one_id: 'a', worker_two_id: 'b', loan_date: '2025-06-01', amount: 1000, notes: '' }],
    jointLoanRepayments: [{ id: 'r', joint_loan_id: 'j', worker_id: 'a', repayment_date: '2025-07-01', amount: 200, notes: '' }],
    workerLoans: [{ id: 'credit', worker_id: 'c', loan_date: '2025-06-01', amount: 100, kind: 'repayment', notes: '' }]
  }, now)
  expect(result.balance).toBe(800)
  expect(result.pace).toBeCloseTo(200 / 14.5)
  expect(result.rows.at(-1)?.projectedBalance).toBeNull()
})

it('does not estimate a payoff without repayments in the chosen history', () => {
  const result = loanStory({ ...empty, workerLoans: [
    { id: 'a', worker_id: 'w', loan_date: '2025-06-01', amount: 1000, kind: 'advance', notes: '' },
    { id: 'r', worker_id: 'w', loan_date: '2025-06-20', amount: 100, kind: 'repayment', notes: '' }
  ] }, now)
  expect(result.balance).toBe(900)
  expect(result.pace).toBe(0)
  expect(result.end).toBe('Not enough repayments')
})

it('never uses a cleared worker’s repayments to estimate another worker’s payoff', () => {
  const result = loanStory({ ...empty, workerLoans: [
    { id: 'a', worker_id: 'paid', loan_date: '2025-07-01', amount: 10000, kind: 'advance', notes: '' },
    { id: 'r', worker_id: 'paid', loan_date: '2026-07-01', amount: 10000, kind: 'repayment', notes: '' },
    { id: 'b', worker_id: 'unpaid', loan_date: '2025-07-01', amount: 1000, kind: 'advance', notes: '' }
  ] }, now)
  expect(result.pace).toBeGreaterThan(0)
  expect(result.accounts).toHaveLength(1)
  expect(result.accounts[0]).toMatchObject({ id: 'worker:unpaid', pace: 0, months: null })
  expect(result.months).toBeNull()
  expect(result.end).toBe('Not enough repayments')
})

it('uses the slowest separate account and keeps joint repayments separate from personal loans', () => {
  const result = loanStory({ ...empty,
    workerLoans: [
      { id: 'a', worker_id: 'a', loan_date: '2025-07-01', amount: 2000, kind: 'advance', notes: '' },
      { id: 'r', worker_id: 'a', loan_date: '2026-07-01', amount: 1000, kind: 'repayment', notes: '' }
    ],
    jointLoans: [{ id: 'j', worker_one_id: 'a', worker_two_id: 'b', loan_date: '2025-07-01', amount: 2000, notes: '' }],
    jointLoanRepayments: [{ id: 'rj', joint_loan_id: 'j', worker_id: 'a', repayment_date: '2026-07-01', amount: 200, notes: '' }]
  }, now)
  expect(result.accounts.find(a => a.id === 'worker:a')?.months).toBe(15)
  expect(result.accounts.find(a => a.id === 'joint:j')?.months).toBe(131)
  expect(result.months).toBe(131)
  expect(result.end).toBe(result.accounts.find(a => a.id === 'joint:j')?.end)
})
