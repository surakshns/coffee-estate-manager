import { useRef, useState, type FormEvent } from 'react'
import { money } from '../lib/calculations'
import { scrollToEditor } from '../lib/scroll'
import { supabase } from '../lib/supabase'
import type { EstateData, Expense } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = { expense_date: today(), category_id: '', description: '', amount: '' }

export function Expenses({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const categoryEditorRef = useRef<HTMLInputElement>(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const from = range.from || `${year}-01-01`
  const to = range.to || `${year}-12-31`
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const validRange = from <= to
  const categoryLabel = (item: Expense) => data.categories.find(c => c.id === item.category_id)?.name ?? item.expense_categories?.name ?? 'Uncategorised'
  const filtered = data.expenses.filter(item => validRange && item.expense_date >= from && item.expense_date <= to && (!categoryFilter || item.category_id === categoryFilter) && `${item.description} ${categoryLabel(item)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.expense_date.localeCompare(a.expense_date))
  const categoryTotals = filtered.reduce<Record<string, number>>((totals, item) => { const name = categoryLabel(item); totals[name] = (totals[name] ?? 0) + Number(item.amount); return totals }, {})
  const monthlyTotals = filtered.reduce<Record<string, number>>((totals, item) => { const month = item.expense_date.slice(0, 7); totals[month] = (totals[month] ?? 0) + Number(item.amount); return totals }, {})
  const largestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]
  const peakMonth = Object.entries(monthlyTotals).sort((a, b) => b[1] - a[1])[0]

  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [message, setMessage] = useState('')
  const expenseEditorRef = useRef<HTMLFormElement>(null)
  const activeCategories = data.categories.filter((category) => !category.archived)
  const nonLabourCost = filtered.reduce((sum, item) => sum + Number(item.amount), 0)
  const labourCost = data.weeklyPayments.filter(p => validRange && !p.excluded && p.week_start >= from && p.week_start <= to).reduce((sum, p) => sum + Math.max(0, Number(p.amount) - Number(p.loan_deduction ?? 0)), 0)

  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    const payload = { ...form, amount: Number(form.amount) }
    const request = editing ? supabase.from('expenses').update(payload).eq('id', editing.id) : supabase.from('expenses').insert(payload)
    const { error } = await request
    setMessage(error ? error.message : editing ? 'Expense updated.' : 'Expense added.')
    if (!error) { setForm(emptyForm); setEditing(null); await refresh() }
  }
  async function addCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim()) return
    const payload = { name: categoryName.trim() }
    const { error } = await (editingCategoryId ? supabase.from('expense_categories').update(payload).eq('id', editingCategoryId) : supabase.from('expense_categories').insert(payload))
    setMessage(error ? error.message : editingCategoryId ? 'Category updated.' : 'Category added.')
    if (!error) { setCategoryName(''); setEditingCategoryId(null); await refresh() }
  }
  async function toggleCategory(id: string, archived: boolean) { const { error } = await supabase.from('expense_categories').update({ archived: !archived }).eq('id', id); setMessage(error ? error.message : archived ? 'Category restored.' : 'Category archived.'); if (!error) await refresh() }
  async function deleteExpense() { if (!deleting) return; const { error } = await supabase.from('expenses').delete().eq('id', deleting.id); setMessage(error ? error.message : 'Expense deleted.'); setDeleting(null); if (!error) await refresh() }
  function startEdit(item: Expense) {
    setEditing(item)
    setForm({ expense_date: item.expense_date, category_id: item.category_id, description: item.description, amount: String(item.amount) })
    scrollToEditor(expenseEditorRef.current)
  }

  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Costs</p><h1 className="mt-1 text-3xl font-extrabold">Expense tracker</h1><p className="mt-1 text-stone-600">Track non-labour costs here; labour cost is included automatically in the estate total.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="card space-y-4"><div><h2 className="text-xl font-extrabold">Explore your spending</h2><p className="text-sm text-stone-600">Choose dates, category or description. Expense totals, breakdowns and records below follow these filters.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="label">From<input className="field" type="date" value={from} onChange={e => setRange({ from: e.target.value, to })} /></label><label className="label">To<input className="field" type="date" value={to} onChange={e => setRange({ from, to: e.target.value })} /></label><label className="label">Category<select className="field" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">All categories</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label><label className="label">Search<input className="field" placeholder="Find an expense…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="flex flex-wrap gap-2"><button className="button-secondary" onClick={() => { setRange({ from: today().slice(0, 7) + '-01', to: today() }) }}>This month</button><button className="button-secondary" onClick={() => { setRange({ from: '', to: '' }); setCategoryFilter(''); setSearch('') }}>Reset to {year}</button></div>{!validRange && <p role="alert" className="text-red-700">End date must be on or after the start date.</p>}</section>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><SmallTotal label="Filtered expenses only" value={money(nonLabourCost)} tone="expense" /><SmallTotal label="Take-home · all workers" value={money(labourCost)} tone="labour" /><SmallTotal label="Filtered expenses + take-home" value={money(nonLabourCost + labourCost)} tone="revenue" /><SmallTotal label="Average expense entry" value={money(filtered.length ? nonLabourCost / filtered.length : 0)} tone="category" /></section>
    <p className="text-sm text-stone-600">{filtered.length} matching records · Labour uses saved weeks in these dates; category and search filters apply only to expenses.</p>
    {filtered.length > 0 && <section className="card grid gap-5 md:grid-cols-2"><div><h2 className="text-xl font-extrabold">Where the money goes</h2><p className="mt-2 text-stone-600"><strong>{largestCategory?.[0]}</strong> is your largest category ({nonLabourCost ? Math.round((largestCategory?.[1] ?? 0) / nonLabourCost * 100) : 0}% of filtered expenses).</p><p className="mt-2 text-stone-600">Highest spending month: <strong>{peakMonth?.[0]}</strong> · {money(peakMonth?.[1] ?? 0)}</p></div><div><h3 className="font-bold">Monthly expenses</h3>{Object.entries(monthlyTotals).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => <div key={month} className="mt-3"><div className="flex justify-between gap-3 text-sm"><span>{month}</span><strong>{money(amount)}</strong></div><div className="mt-1 h-2 rounded-full bg-stone-100"><div className="h-2 rounded-full bg-leaf-700" style={{ width: `${amount / (peakMonth?.[1] || 1) * 100}%` }} /></div></div>)}</div></section>}
    <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><form ref={expenseEditorRef} className="card scroll-mt-24 space-y-3" onSubmit={saveExpense}><h2 className="text-xl font-extrabold">{editing ? 'Edit expense' : 'Add expense'}</h2><label className="label">Date<input className="field" type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} required /></label><label className="label">Category<select className="field" value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} required><option value="">Choose a category</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="label">Description<input className="field" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What was this for?" /></label><label className="label">Amount (₹)<input className="field" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><div className="flex flex-wrap gap-3"><button className="button-primary">{editing ? 'Save changes' : 'Add expense'}</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancel</button>}</div></form>
      <div className="card"><h2 className="text-xl font-extrabold">Selected expenses by category</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(categoryTotals).length ? Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([name, amount]) => <div className="rounded-xl bg-coffee-50 p-3" key={name}><p className="font-bold text-stone-700">{name}</p><p className="mt-1 text-xl font-extrabold">{money(amount)}</p></div>) : <p className="text-stone-500">No expenses match these filters.</p>}</div>
        <form className="mt-6 border-t border-stone-200 pt-5" onSubmit={addCategory}><label className="label">{editingCategoryId ? 'Edit category name' : 'Add a new category'}<input ref={categoryEditorRef} className="field" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Repairs" required /></label><button className="button-secondary mt-3">{editingCategoryId ? 'Save category' : 'Add category'}</button>{editingCategoryId && <button type="button" className="button-secondary mt-3 ml-2" onClick={() => { setEditingCategoryId(null); setCategoryName('') }}>Cancel</button>}</form>
        <div className="mt-4 grid gap-2">{data.categories.map((category) => <div key={category.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 p-3"><strong>{category.name}</strong><div className="flex gap-2"><button className="button-secondary" onClick={() => { setEditingCategoryId(category.id); setCategoryName(category.name); categoryEditorRef.current?.focus(); categoryEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>Edit</button><button className="button-secondary" onClick={() => void toggleCategory(category.id, category.archived)}>{category.archived ? 'Restore' : 'Archive'}</button></div></div>)}</div></div></section>
    <section className="card"><h2 className="text-xl font-extrabold">Matching non-labour expenses</h2><div className="table-wrap mt-3"><table className="data-table record-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead><tbody>{!filtered.length && <tr><td colSpan={5}>No expenses match. Try a wider date range or clear the filters.</td></tr>}{filtered.map((item) => <tr key={item.id}><td data-label="Date">{item.expense_date}</td><td data-label="Category">{categoryLabel(item)}</td><td data-label="Description">{item.description || '—'}</td><td data-label="Amount" className="font-bold">{money(Number(item.amount))}</td><td data-label="Actions"><div className="flex gap-2"><button className="font-bold text-leaf-700 underline" onClick={() => startEdit(item)}>Edit</button><button className="font-bold text-red-700 underline" onClick={() => setDeleting(item)}>Delete</button></div></td></tr>)}</tbody></table></div></section>
    <ConfirmDialog open={!!deleting} title="Delete expense?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteExpense()}>This expense will be permanently removed from your totals.</ConfirmDialog>
  </div>
}
function SmallTotal({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className={`summary-tile tone-${tone}`}><p className="tile-label">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></div> }
