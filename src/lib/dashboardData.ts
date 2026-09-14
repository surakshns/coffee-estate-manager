import { monthlyLabourTotal } from './calculations'
import type { EstateData } from './types'

/** Calendar-year activity: a sale is grouped by its sale date, regardless of harvest year. */
export function dashboardActivity(data: EstateData, year: number) {
  const monthly = Array.from({ length: 12 }, (_, monthIndex) => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const sales = data.sales.filter((sale) => sale.sale_date.startsWith(prefix))
      .reduce((sum, sale) => sum + Number(sale.bags_sold) * Number(sale.selling_price_per_bag), 0)
    const labour = monthlyLabourTotal(data.weeklyPayments, year, monthIndex)
    const other = data.expenses.filter((expense) => expense.expense_date.startsWith(prefix))
      .reduce((sum, expense) => sum + Number(expense.amount), 0)
    return {
      month: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(year, monthIndex, 1)),
      sales, labour, other, spending: labour + other, balance: sales - labour - other
    }
  })
  const sales = monthly.reduce((sum, month) => sum + month.sales, 0)
  const spending = monthly.reduce((sum, month) => sum + month.spending, 0)
  const labour = monthly.reduce((sum, month) => sum + month.labour, 0)
  const expenseGroups = new Map<string, { id: string; name: string; amount: number }>()
  for (const expense of data.expenses.filter((item) => Number(item.expense_date.slice(0, 4)) === year)) {
    const group = expenseGroups.get(expense.category_id)
    const name = expense.expense_categories?.name ?? data.categories.find((item) => item.id === expense.category_id)?.name ?? 'Uncategorised'
    expenseGroups.set(expense.category_id, { id: expense.category_id, name, amount: (group?.amount ?? 0) + Number(expense.amount) })
  }
  const categories = [...expenseGroups.values(), { id: '__weekly_labour', name: 'Labour pay', amount: labour }]
    .filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
  return { monthly, sales, spending, labour, balance: sales - spending, categories }
}
