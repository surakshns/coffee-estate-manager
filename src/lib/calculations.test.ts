import { describe, expect, it } from 'vitest'
import { monthlyLabourTotal, productionMetrics, wednesdaysInMonth, weeklyTotal, yearlyExpenseTotal } from './calculations'
import type { Expense, WeeklyPayment, Worker } from './types'

const workers: Worker[] = [
  { id: 'w1', name: 'Asha', active: true, default_weekly_amount: 1000 },
  { id: 'w2', name: 'Bala', active: true, default_weekly_amount: 1200 },
  { id: 'w3', name: 'Chetan', active: false, default_weekly_amount: 900 }
]
const payments: WeeklyPayment[] = [{ id: 'p1', worker_id: 'w1', week_start: '2026-02-02', amount: 1100 }]

describe('estate calculation layer', () => {
  it('uses a historical payment when it exists and defaults for active workers', () => {
    expect(weeklyTotal(workers, payments, '2026-02-02')).toBe(2300)
  })
  it('calculates yearly non-labour expenses', () => {
    const expenses: Expense[] = [
      { id: 'e1', expense_date: '2026-03-02', category_id: 'c1', description: '', amount: 500 },
      { id: 'e2', expense_date: '2025-03-02', category_id: 'c1', description: '', amount: 600 }
    ]
    expect(yearlyExpenseTotal(expenses, 2026)).toBe(500)
  })
  it('groups Wednesday payment dates and monthly labour totals correctly', () => {
    expect(wednesdaysInMonth(2026, 0)).toEqual(['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28'])
    expect(monthlyLabourTotal([{ id: 'p1', worker_id: 'w1', week_start: '2026-01-07', amount: 1200 }, { id: 'p2', worker_id: 'w2', week_start: '2026-02-04', amount: 1300 }], 2026, 0)).toBe(1200)
  })
  it('calculates revenue and profit from sales, labour, and other costs', () => {
    const result = productionMetrics(
      [{ id: 'pr1', production_year: 2026, bags_produced: 10, bag_weight_kg: 50, notes: null }],
      [{ id: 's1', production_year: 2026, sale_date: '2026-05-10', bags_sold: 8, selling_price_per_bag: 5000, buyer: 'Buyer' }],
      [{ id: 'e1', expense_date: '2026-04-10', category_id: 'c1', description: '', amount: 4000 }],
      [{ id: 'p1', worker_id: 'w1', week_start: '2026-01-05', amount: 2000 }], 2026
    )
    expect(result.revenue).toBe(40000)
    expect(result.totalExpenses).toBe(6000)
    expect(result.profit).toBe(34000)
    expect(result.costPerBag).toBe(600)
  })
})
