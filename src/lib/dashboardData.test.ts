import { describe, expect, it } from 'vitest'
import { dashboardActivity } from './dashboardData'
import type { EstateData } from './types'

const emptyData: EstateData = {
  workers: [], weeklyPayments: [], workerLoans: [], categories: [], expenses: [],
  prices: [], monthlyGuideEntries: [], production: [], sales: []
}

describe('dashboard calendar activity', () => {
  it('uses the sale date, including a previous harvest sold this year', () => {
    const result = dashboardActivity({ ...emptyData, sales: [
      { id: 's1', sale_date: '2026-02-10', production_year: 2025, bags_sold: 5, selling_price_per_bag: 4000, buyer: 'Buyer' },
      { id: 's2', sale_date: '2027-02-10', production_year: 2026, bags_sold: 3, selling_price_per_bag: 4000, buyer: 'Buyer' }
    ] }, 2026)
    expect(result.sales).toBe(20000)
    expect(result.monthly[1].sales).toBe(20000)
    expect(result.monthly[0].sales).toBe(0)
  })

  it('excludes skipped pay and resolves category names for imported records', () => {
    const result = dashboardActivity({ ...emptyData,
      categories: [{ id: 'c1', name: 'Manure', archived: false }],
      expenses: [
        { id: 'e1', expense_date: '2026-02-20', category_id: 'c1', description: '', amount: 500 },
        { id: 'e2', expense_date: '2025-02-20', category_id: 'c1', description: '', amount: 1000 }
      ],
      weeklyPayments: [
        { id: 'p1', worker_id: 'w1', week_start: '2026-02-04', amount: 1500 },
        { id: 'p2', worker_id: 'w2', week_start: '2026-02-04', amount: 5000, excluded: true },
        { id: 'p3', worker_id: 'w1', week_start: '2025-02-05', amount: 5000 }
      ]
    }, 2026)
    expect(result.spending).toBe(2000)
    expect(result.balance).toBe(-2000)
    expect(result.monthly[1]).toMatchObject({ spending: 2000, labour: 1500, other: 500 })
    expect(result.categories.map((item) => [item.name, item.amount])).toEqual([['Labour pay', 1500], ['Manure', 500]])
  })
})
