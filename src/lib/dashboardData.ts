import type { EstateData } from './types'

const monthFormatter = new Intl.DateTimeFormat('en-IN', { month: 'short' })
/** Calendar-year activity, accumulated in paise in one pass per record type. */
export function dashboardActivity(data: EstateData, year: number) {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: monthFormatter.format(new Date(year, index, 1)), sales: 0, labour: 0, other: 0 }))
  const monthFor = (date: string) => date.startsWith(`${year}-`) ? months[Number(date.slice(5, 7)) - 1] : undefined
  const categoryNames = new Map(data.categories.map(category => [category.id, category.name]))
  const expenseGroups = new Map<string, { id: string; name: string; amount: number }>()
  for (const sale of data.sales) {
    const month = monthFor(sale.sale_date)
    if (month) month.sales += Math.round(Number(sale.bags_sold) * Number(sale.selling_price_per_bag) * 100)
  }
  for (const payment of data.weeklyPayments) {
    const month = monthFor(payment.week_start)
    if (month && !payment.excluded) month.labour += Math.round(Number(payment.amount) * 100)
  }
  for (const expense of data.expenses) {
    const month = monthFor(expense.expense_date)
    if (!month) continue
    const amount = Math.round(Number(expense.amount) * 100)
    month.other += amount
    const group = expenseGroups.get(expense.category_id)
    if (group) group.amount += amount
    else expenseGroups.set(expense.category_id, { id: expense.category_id, name: categoryNames.get(expense.category_id) ?? expense.expense_categories?.name ?? 'Uncategorised', amount })
  }
  const monthly = months.map(month => ({ month: month.month, sales: month.sales / 100, labour: month.labour / 100, other: month.other / 100, spending: (month.labour + month.other) / 100, balance: (month.sales - month.labour - month.other) / 100 }))
  const sales = months.reduce((sum, month) => sum + month.sales, 0) / 100
  const labour = months.reduce((sum, month) => sum + month.labour, 0) / 100
  const spending = months.reduce((sum, month) => sum + month.labour + month.other, 0) / 100
  const categories = [...[...expenseGroups.values()].map(group => ({ ...group, amount: group.amount / 100 })), { id: '__weekly_labour', name: 'Labour pay', amount: labour }]
    .filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount)
  return { monthly, sales, spending, labour, balance: Math.round((sales - spending) * 100) / 100, categories }
}
