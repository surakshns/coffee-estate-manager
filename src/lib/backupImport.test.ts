import { describe, expect, it } from 'vitest'
import { prepareImport } from './backupImport'
import type { EstateData } from './types'

const data: EstateData = {
  workers: [{ id: 'w', name: 'Asha', active: true, default_weekly_amount: 1000 }],
  categories: [{ id: 'c', name: 'Repairs', archived: false }],
  weeklyPayments: [{ id: 'p', worker_id: 'w', week_start: '2026-10-07', amount: 1000 }],
  labourRates: [{ id: 'r', rate_year: 2026, daily_rate: 500 }],
  expenses: [], workerLoans: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: []
}
describe('validated import plans', () => {
  it('reports updates for existing workers, categories, wages and yearly rates', () => {
    const workers = prepareImport('workers', [{ name: ' asha ', default_weekly_amount: '1500' }, { name: 'Bala' }], data)
    expect(workers.replacements).toBe(1)
    expect(workers.rows[0]).toMatchObject({ id: 'w', name: 'asha', default_weekly_amount: 1500 })
    expect(workers.rows[1]).not.toHaveProperty('id')
    expect(prepareImport('categories', [{ name: 'Repairs', archived: 'true' }], data).replacements).toBe(1)
    expect(prepareImport('labourRates', [{ rate_year: '2026', daily_rate: '600' }], data).replacements).toBe(1)
    expect(prepareImport('weeklyPayments', [{ worker_name: 'Asha', week_start: '2026-10-07', amount: '1200' }], data).replacements).toBe(1)
  })
  it.each(['NaN', 'Infinity', '1e3', '-1', '12junk', '0', '2.345'])('rejects invalid expense amounts: %s', amount => {
    expect(() => prepareImport('expenses', [{ expense_date: '2026-10-05', category: 'Repairs', amount }], data)).toThrow('Row 2')
  })
  it('validates the entire file, dates and references before creating a plan', () => {
    expect(() => prepareImport('expenses', [{ expense_date: '2026-10-05', category: 'Repairs', amount: '10' }, { expense_date: '2026-02-30', category: 'Repairs', amount: '20' }], data)).toThrow('Row 3')
    expect(() => prepareImport('expenses', [{ expense_date: '2026-10-05', category: 'Missing', amount: '10' }], data)).toThrow('matching expense category')
    expect(() => prepareImport('workerLoans', [{ worker_name: 'Asha', loan_date: '2026-10-05', amount: '20', kind: 'wrong' }], data)).toThrow('Loan kind')
  })
  it('rejects ambiguous workers, duplicate identities and impossible loan deductions', () => {
    expect(() => prepareImport('workerLoans', [{ worker_name: 'Asha', loan_date: '2026-10-05', amount: '20', kind: 'advance' }], { ...data, workers: [...data.workers, { ...data.workers[0], id: 'w2' }] })).toThrow('More than one worker')
    expect(() => prepareImport('workers', [{ name: 'Asha' }, { name: ' ASHA ' }], data)).toThrow('more than once')
    expect(() => prepareImport('weeklyPayments', [{ worker_name: 'Asha', week_start: '2026-10-07', amount: '100', loan_deduction: '101' }], data)).toThrow('exceeds')
    expect(() => prepareImport('weeklyPayments', [{ worker_name: 'Asha', week_start: '2026-10-08', amount: '100' }], data)).toThrow('Wednesday')
  })
  it('retains multiline text, normalizes skipped wages and supports legacy guide CSVs', () => {
    expect(prepareImport('workerLoans', [{ worker_name: 'Asha', loan_date: '2026-10-05', amount: '20.50', kind: 'advance', notes: 'line 1\nline 2' }], data).rows[0]).toMatchObject({ notes: 'line 1\nline 2', amount: 20.5 })
    expect(prepareImport('weeklyPayments', [{ worker_name: 'Asha', week_start: '2026-10-07', amount: '100', excluded: 'true', loan_deduction: '20' }], data).rows[0]).toMatchObject({ amount: 0, loan_deduction: 0, days_worked: 0, excluded: true })
    expect(prepareImport('monthlyGuideEntries', [{ plan_month: '2026-10-01', title: 'Harvest planning', notes: 'Block one' }], data).rows[0]).toMatchObject({ month_number: 10 })
  })
  it('does not accept excessive size, blank input or invalid years', () => {
    expect(() => prepareImport('workers', [], data)).toThrow('No CSV')
    expect(() => prepareImport('workers', Array.from({ length: 10001 }, () => ({ name: 'A' })), data)).toThrow('10,000')
    expect(() => prepareImport('production', [{ production_year: '1900', bags_produced: '1', bag_weight_kg: '50' }], data)).toThrow('production year')
  })
})
