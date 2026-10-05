import type { Dataset, EstateData } from './types'

export type ImportPlan = { table: string; rows: Record<string, unknown>[]; onConflict?: string; rpc?: 'import_weekly_payments'; replacements: number }
type Row = Record<string, string>
const normalized = (text: string) => text.trim().toLowerCase()

export function prepareImport(dataset: Dataset, rows: Row[], data: EstateData): ImportPlan {
  if (!rows.length) throw new Error('No CSV records were found.')
  if (rows.length > 10000) throw new Error('Import up to 10,000 records at a time.')
  let replacements = 0
  const unique = new Set<string>()
  const inserts = rows.map((row, index) => {
    const fail = (message: string): never => { throw new Error(`Row ${index + 2}: ${message}`) }
    const text = (key: string, fallback?: string) => {
      const value = row[key]?.trim() || fallback
      if (!value) return fail(`Missing ${key.replaceAll('_', ' ')}.`)
      return value
    }
    const number = (key: string, min = 0, max = 9999999999.99, fallback?: number, integer = false) => {
      const raw = row[key]?.trim()
      if (!raw && fallback !== undefined) return fallback
      if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return fail(`Enter a valid ${key.replaceAll('_', ' ')}.`)
      const value = Number(raw)
      if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return fail(`Invalid ${key.replaceAll('_', ' ')}.`)
      return value
    }
    const boolean = (key: string, fallback: boolean) => {
      const raw = row[key]?.trim().toLowerCase()
      if (!raw) return fallback
      if (!['true', 'false'].includes(raw)) return fail(`${key} must be true or false.`)
      return raw === 'true'
    }
    const date = (key: string) => {
      const value = text(key)
      const stamp = Date.parse(`${value}T12:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return fail(`Invalid ${key.replaceAll('_', ' ')}.`)
      return value
    }
    const worker = () => {
      const name = text('worker_name')
      const matches = data.workers.filter(item => normalized(item.name) === normalized(name))
      if (matches.length !== 1) return fail(matches.length ? `More than one worker is named ${name}. Use distinct worker names before importing.` : `Create or import worker ${name} first.`)
      return matches[0].id
    }
    const once = (key: string) => { if (unique.has(key)) fail('This record appears more than once in the CSV.'); unique.add(key) }
    if (dataset === 'workers' || dataset === 'categories') {
      const name = text('name')
      once(normalized(name))
      const existing = (dataset === 'workers' ? data.workers : data.categories).filter(item => normalized(item.name) === normalized(name))
      if (existing.length > 1) return fail(`More than one existing record is named ${name}. Rename them before importing.`)
      if (existing.length) replacements++
      return { ...(existing[0] ? { id: existing[0].id } : {}), name, ...(dataset === 'workers'
        ? { active: boolean('active', true), default_weekly_amount: number('default_weekly_amount', 0, 9999999999.99, 0), default_days_worked: number('default_days_worked', 0, 6, 5, true) }
        : { archived: boolean('archived', false) }) }
    }
    if (dataset === 'weeklyPayments') {
      const worker_id = worker(), week_start = date('week_start')
      if (new Date(`${week_start}T12:00:00Z`).getUTCDay() !== 3) return fail('Weekly payments need a Wednesday date.')
      once(`${worker_id}:${week_start}`)
      if (data.weeklyPayments.some(item => item.worker_id === worker_id && item.week_start === week_start)) replacements++
      const excluded = boolean('excluded', false)
      const amount = number('amount'), loan_deduction = number('loan_deduction', 0, 9999999999.99, 0)
      if (!excluded && loan_deduction > amount) return fail('Loan deduction exceeds the weekly wage.')
      const days = row.days_worked?.trim() ? number('days_worked', 0, 7) : null
      if (days !== null && Math.abs(Math.round(days * 10) - days * 10) > 0.000001) return fail('Days worked can have at most one decimal place.')
      return { worker_id, week_start, amount: excluded ? 0 : amount, days_worked: excluded ? 0 : days, daily_rate: row.daily_rate?.trim() ? number('daily_rate') : null, loan_deduction: excluded ? 0 : loan_deduction, excluded }
    }
    if (dataset === 'labourRates') {
      const rate_year = number('rate_year', 2000, 2200, undefined, true)
      once(String(rate_year))
      if (data.labourRates.some(item => item.rate_year === rate_year)) replacements++
      return { rate_year, daily_rate: number('daily_rate') }
    }
    if (dataset === 'workerLoans') {
      const kind = text('kind')
      if (!['advance', 'repayment'].includes(kind)) return fail('Loan kind must be advance or repayment.')
      return { worker_id: worker(), loan_date: date('loan_date'), kind, amount: number('amount', 0.01), notes: row.notes ?? '' }
    }
    if (dataset === 'expenses') {
      const name = text('category')
      const matches = data.categories.filter(item => normalized(item.name) === normalized(name))
      if (matches.length !== 1) return fail(`Create a single matching expense category for ${name} first.`)
      return { expense_date: date('expense_date'), category_id: matches[0].id, description: row.description ?? '', amount: number('amount', 0.01) }
    }
    if (dataset === 'prices') return { price_date: date('price_date'), coffee_type: text('coffee_type'), grade: text('grade', 'Standard'), source: text('source', 'CSV import'), price_per_kg: number('price_per_kg') }
    if (dataset === 'monthlyGuideEntries') {
      const month_number = row.month_number?.trim() ? number('month_number', 1, 12, undefined, true) : Number(date('plan_month').slice(5, 7))
      const title = text('title'), notes = row.notes ?? ''
      if (title.length > 140 || notes.length > 2000) return fail('Guide titles allow 140 characters and notes allow 2,000.')
      return { month_number, title, notes }
    }
    if (dataset === 'production') return { production_year: number('production_year', 2000, 2200, undefined, true), bags_produced: number('bags_produced'), bag_weight_kg: number('bag_weight_kg', 0.01), notes: row.notes || null }
    if (dataset === 'sales') return { production_year: number('production_year', 2000, 2200, undefined, true), sale_date: date('sale_date'), bags_sold: number('bags_sold', 0.01), selling_price_per_bag: number('selling_price_per_bag', 0.01), buyer: row.buyer ?? '' }
    return fail('This record type cannot be imported from CSV.')
  })
  const table: Partial<Record<Dataset, string>> = { workers: 'workers', categories: 'expense_categories', weeklyPayments: 'weekly_payments', workerLoans: 'worker_loans', labourRates: 'labour_daily_rates', expenses: 'expenses', prices: 'coffee_prices', monthlyGuideEntries: 'monthly_tasks', production: 'production_records', sales: 'sales' }
  const onConflict = dataset === 'weeklyPayments' ? 'worker_id,week_start' : dataset === 'labourRates' ? 'user_id,rate_year' : dataset === 'workers' || dataset === 'categories' ? 'id' : undefined
  return { table: table[dataset]!, rows: inserts, onConflict, rpc: dataset === 'weeklyPayments' ? 'import_weekly_payments' : undefined, replacements }
}
