export type Id = string

export interface Worker {
  id: Id
  name: string
  active: boolean
  default_weekly_amount: number
  created_at?: string
}

export interface WeeklyPayment {
  id: Id
  worker_id: Id
  week_start: string
  amount: number
  excluded?: boolean
}

export interface WorkerLoan {
  id: Id
  worker_id: Id
  loan_date: string
  amount: number
  kind: 'advance' | 'repayment'
  notes: string
}

export interface ExpenseCategory {
  id: Id
  name: string
  archived: boolean
}

export interface Expense {
  id: Id
  expense_date: string
  category_id: Id
  description: string
  amount: number
  expense_categories?: Pick<ExpenseCategory, 'name'> | null
}

export interface CoffeePrice {
  id: Id
  price_date: string
  coffee_type: string
  grade: string
  source: string
  price_per_kg: number
}

export interface ProductionRecord {
  id: Id
  production_year: number
  bags_produced: number
  bag_weight_kg: number
  notes: string | null
}

export interface Sale {
  id: Id
  sale_date: string
  production_year: number
  bags_sold: number
  selling_price_per_bag: number
  buyer: string
}

export interface EstateData {
  workers: Worker[]
  weeklyPayments: WeeklyPayment[]
  workerLoans: WorkerLoan[]
  categories: ExpenseCategory[]
  expenses: Expense[]
  prices: CoffeePrice[]
  production: ProductionRecord[]
  sales: Sale[]
}

export type Dataset = keyof EstateData
