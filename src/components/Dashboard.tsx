import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReactNode } from 'react'
import { expensesByCategory, money, monthlyLabourTotal, productionMetrics, yearlyExpenseTotal, yearlyLabourTotal } from '../lib/calculations'
import type { EstateData } from '../lib/types'

const colours = ['#3d6637', '#b87937', '#7c553b', '#6689a6', '#a65c73', '#8a9b55']
const number = (value: number | string) => Number(value || 0)

export function Dashboard({ data, year }: { data: EstateData; year: number }) {
  const metrics = productionMetrics(data.production, data.sales, data.expenses, data.weeklyPayments, year)
  const categories = [...Object.entries(expensesByCategory(data.expenses, year)).map(([name, amount]) => ({ name, amount })), { name: 'Labour', amount: yearlyLabourTotal(data.weeklyPayments, year) }].filter((item) => item.amount > 0)
  const fiveYearsAgo = new Date().getFullYear() - 5
  const prices = [...data.prices].filter((price) => Number(price.price_date.slice(0, 4)) >= fiveYearsAgo).sort((a, b) => a.price_date.localeCompare(b.price_date)).map((price) => ({ date: price.price_date, price: number(price.price_per_kg), label: `${price.coffee_type} · ${price.grade}` }))
  const annual = Array.from({ length: 5 }, (_, index) => year - 4 + index).map((itemYear) => ({
    year: itemYear,
    revenue: productionMetrics(data.production, data.sales, data.expenses, data.weeklyPayments, itemYear).revenue,
    expenses: yearlyExpenseTotal(data.expenses, itemYear) + yearlyLabourTotal(data.weeklyPayments, itemYear)
  }))
  const monthlyExpenses = Array.from({ length: 12 }, (_, monthIndex) => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const labour = monthlyLabourTotal(data.weeklyPayments, year, monthIndex)
    const other = data.expenses.filter((expense) => expense.expense_date.startsWith(prefix)).reduce((total, expense) => total + number(expense.amount), 0)
    return { month: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(year, monthIndex, 1)), labour, other, total: labour + other }
  })
  const stats = [
    ['Labour expenses', money(metrics.labour), 'Paid weekly records'],
    ['Other expenses', money(metrics.otherExpenses), 'Irrigation, manure, etc.'],
    ['Coffee production', `${metrics.bagsProduced.toLocaleString()} bags`, `${metrics.weightKg.toLocaleString()} kg`],
    ['Coffee revenue', money(metrics.revenue), `${metrics.bagsSold.toLocaleString()} bags sold`],
    ['Profit', money(metrics.profit), metrics.profit >= 0 ? 'After all recorded costs' : 'Costs exceed recorded sales']
  ]
  return <div className="page space-y-5">
    <header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Estate overview</p><h1 className="mt-1 text-3xl font-extrabold text-stone-900">{year} dashboard</h1><p className="mt-1 text-stone-600">A clear view of this year’s coffee estate.</p></header>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">{stats.map(([label, total, detail]) => <div className="card dashboard-stat" key={label}><p className="text-sm font-bold text-stone-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-stone-900">{total}</p><p className="mt-1 text-xs text-stone-500">{detail}</p></div>)}</section>
    <section className="grid gap-5 xl:grid-cols-2">
      <ChartCard title="Yearly expenses by category" empty={!categories.length}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={categories} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>{categories.map((item, index) => <Cell key={item.name} fill={colours[index % colours.length]} />)}</Pie><Tooltip formatter={(value) => money(Number(value))} /></PieChart></ResponsiveContainer></ChartCard>
      <ChartCard title={`Monthly expenses in ${year}`} empty={!monthlyExpenses.some((item) => item.total)}><ResponsiveContainer width="100%" height={280}><BarChart data={monthlyExpenses}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis tickFormatter={(amount) => `₹${Number(amount) / 1000}k`} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="labour" name="Labour" stackId="expenses" fill="#3d6637" radius={[0, 0, 4, 4]} /><Bar dataKey="other" name="Other expenses" stackId="expenses" fill="#b87937" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Coffee price history (last 5 years)" empty={!prices.length}><ResponsiveContainer width="100%" height={280}><LineChart data={prices}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(amount) => `₹${amount}`} /><Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => `Date: ${label}`} /><Line type="monotone" dataKey="price" name="Price / kg" stroke="#3d6637" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Revenue versus expenses" empty={!annual.some((item) => item.revenue || item.expenses)}><ResponsiveContainer width="100%" height={280}><BarChart data={annual}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={(amount) => `₹${Number(amount) / 1000}k`} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="revenue" name="Revenue" fill="#3d6637" radius={[5, 5, 0, 0]} /><Bar dataKey="expenses" name="Expenses" fill="#b87937" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <div className="card"><h2 className="text-lg font-extrabold">This year’s useful figures</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="Average selling price" value={money(metrics.averageSellingPrice)} /><Metric label="Cost per bag produced" value={money(metrics.costPerBag)} /><Metric label="Profit per bag sold" value={money(metrics.profitPerBag)} /><Metric label="Bags sold" value={metrics.bagsSold.toLocaleString()} /></dl></div>
    </section>
  </div>
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) { return <div className="card"><h2 className="text-lg font-extrabold text-stone-900">{title}</h2>{empty ? <div className="grid h-70 place-items-center text-center text-stone-500">Add records to see this chart.</div> : <div className="mt-4">{children}</div>}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-stone-50 p-3"><dt className="text-stone-500">{label}</dt><dd className="mt-1 font-extrabold text-stone-900">{value}</dd></div> }
