import type { Expense, ProductionRecord, Sale, WeeklyPayment, Worker } from './types'

const value = (number: number | string | null | undefined) => Number(number ?? 0)
export const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)

export function weekStart(date = new Date()) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const sundayIndex = copy.getUTCDay()
  copy.setUTCDate(copy.getUTCDate() - (sundayIndex === 0 ? 6 : sundayIndex - 1))
  return copy.toISOString().slice(0, 10)
}

export function wednesdaysInMonth(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  const wednesdays: string[] = []
  while (date.getUTCMonth() === monthIndex) {
    if (date.getUTCDay() === 3) wednesdays.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return wednesdays
}

export function workersForPaymentDate(workers: Worker[], payments: WeeklyPayment[], paymentDate: string) {
  const historicallyPaid = new Set(payments.filter((payment) => payment.week_start === paymentDate).map((payment) => payment.worker_id))
  return workers.filter((worker) => historicallyPaid.has(worker.id) || worker.active)
}

export function weeklyTotal(workers: Worker[], payments: WeeklyPayment[], forWeek: string) {
  return workersForPaymentDate(workers, payments, forWeek).reduce((total, worker) => {
    const payment = payments.find((item) => item.worker_id === worker.id && item.week_start === forWeek)
    return total + value(payment?.excluded ? 0 : payment?.amount ?? worker.default_weekly_amount)
  }, 0)
}

export function recordedPaymentTotal(payments: WeeklyPayment[], paymentDate: string) {
  return payments.filter((payment) => payment.week_start === paymentDate && !payment.excluded).reduce((total, payment) => total + value(payment.amount), 0)
}

export function monthlyLabourTotal(payments: WeeklyPayment[], year: number, monthIndex: number) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
  return payments.filter((payment) => payment.week_start.startsWith(prefix) && !payment.excluded).reduce((total, payment) => total + value(payment.amount), 0)
}

export function yearlyLabourTotal(payments: WeeklyPayment[], year: number) {
  return payments.filter((payment) => Number(payment.week_start.slice(0, 4)) === year && !payment.excluded).reduce((total, payment) => total + value(payment.amount), 0)
}

export function yearlyExpenseTotal(expenses: Expense[], year: number) {
  return expenses.filter((expense) => Number(expense.expense_date.slice(0, 4)) === year).reduce((total, expense) => total + value(expense.amount), 0)
}

export function expensesByCategory(expenses: Expense[], year: number) {
  return expenses.filter((expense) => Number(expense.expense_date.slice(0, 4)) === year).reduce<Record<string, number>>((totals, expense) => {
    const name = expense.expense_categories?.name ?? 'Uncategorised'
    totals[name] = (totals[name] ?? 0) + value(expense.amount)
    return totals
  }, {})
}

export function salesRevenue(sales: Sale[], year: number) {
  return sales.filter((sale) => sale.production_year === year).reduce((total, sale) => total + value(sale.bags_sold) * value(sale.selling_price_per_bag), 0)
}

export function productionMetrics(production: ProductionRecord[], sales: Sale[], expenses: Expense[], payments: WeeklyPayment[], year: number) {
  const yearProduction = production.filter((item) => item.production_year === year)
  const bagsProduced = yearProduction.reduce((total, item) => total + value(item.bags_produced), 0)
  const weightKg = yearProduction.reduce((total, item) => total + value(item.bags_produced) * value(item.bag_weight_kg), 0)
  const yearSales = sales.filter((sale) => sale.production_year === year)
  const bagsSold = yearSales.reduce((total, sale) => total + value(sale.bags_sold), 0)
  const revenue = salesRevenue(sales, year)
  const labour = yearlyLabourTotal(payments, year)
  const otherExpenses = yearlyExpenseTotal(expenses, year)
  const totalExpenses = labour + otherExpenses
  const profit = revenue - totalExpenses
  return {
    bagsProduced, weightKg, bagsSold, revenue, labour, otherExpenses, totalExpenses, profit,
    averageSellingPrice: bagsSold ? revenue / bagsSold : 0,
    costPerBag: bagsProduced ? totalExpenses / bagsProduced : 0,
    profitPerBag: bagsSold ? profit / bagsSold : 0
  }
}
