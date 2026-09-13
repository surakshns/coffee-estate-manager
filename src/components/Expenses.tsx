import { useMemo, useState, type FormEvent } from 'react'
import { expensesByCategory, money, yearlyExpenseTotal } from '../lib/calculations'
import { supabase } from '../lib/supabase'
import type { EstateData, Expense } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = { expense_date: today(), category_id: '', description: '', amount: '' }

export function Expenses({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [message, setMessage] = useState('')
  const activeCategories = data.categories.filter((category) => !category.archived)
  const categoryTotals = useMemo(() => expensesByCategory(data.expenses, year), [data.expenses, year])
  const monthlyTotal = data.expenses.filter((item) => item.expense_date.slice(0, 7) === today().slice(0, 7)).reduce((total, item) => total + Number(item.amount), 0)

  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    const payload = { ...form, amount: Number(form.amount) }
    const request = editing ? supabase.from('expenses').update(payload).eq('id', editing.id) : supabase.from('expenses').insert(payload)
    const { error } = await request
    setMessage(error ? error.message : editing ? 'Expense updated.' : 'Expense added.')
    if (!error) { setForm(emptyForm); setEditing(null); await refresh() }
  }
  async function addCategory(event: FormEvent) {
    event.preventDefault(); const { error } = await supabase.from('expense_categories').insert({ name: categoryName.trim() })
    setMessage(error ? error.message : 'Category added.'); if (!error) { setCategoryName(''); await refresh() }
  }
  async function toggleCategory(id: string, archived: boolean) { const { error } = await supabase.from('expense_categories').update({ archived: !archived }).eq('id', id); setMessage(error ? error.message : archived ? 'Category restored.' : 'Category archived.'); if (!error) await refresh() }
  async function deleteExpense() { if (!deleting) return; const { error } = await supabase.from('expenses').delete().eq('id', deleting.id); setMessage(error ? error.message : 'Expense deleted.'); setDeleting(null); if (!error) await refresh() }
  function startEdit(item: Expense) { setEditing(item); setForm({ expense_date: item.expense_date, category_id: item.category_id, description: item.description, amount: String(item.amount) }) }

  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Costs</p><h1 className="mt-1 text-3xl font-extrabold">Expense tracker</h1><p className="mt-1 text-stone-600">Keep every non-labour estate expense in one place.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-3"><SmallTotal label="This month" value={money(monthlyTotal)} /><SmallTotal label={`${year} total`} value={money(yearlyExpenseTotal(data.expenses, year))} /><SmallTotal label="Categories" value={String(activeCategories.length)} /></section>
    <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><form className="card space-y-3" onSubmit={saveExpense}><h2 className="text-xl font-extrabold">{editing ? 'Edit expense' : 'Add expense'}</h2><label className="label">Date<input className="field" type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} required /></label><label className="label">Category<select className="field" value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} required><option value="">Choose a category</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="label">Description<input className="field" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What was this for?" /></label><label className="label">Amount (₹)<input className="field" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><div className="flex flex-wrap gap-3"><button className="button-primary">{editing ? 'Save changes' : 'Add expense'}</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancel</button>}</div></form>
      <div className="card"><h2 className="text-xl font-extrabold">{year} by category</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(categoryTotals).length ? Object.entries(categoryTotals).map(([name, amount]) => <div className="rounded-xl bg-coffee-50 p-3" key={name}><p className="font-bold text-stone-700">{name}</p><p className="mt-1 text-xl font-extrabold">{money(amount)}</p></div>) : <p className="text-stone-500">No expenses recorded for {year}.</p>}</div>
        <form className="mt-6 border-t border-stone-200 pt-5" onSubmit={addCategory}><label className="label">Add a new category<input className="field" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Repairs" required /></label><button className="button-secondary mt-3">Add category</button></form>
        <div className="mt-4 flex flex-wrap gap-2">{data.categories.map((category) => <button key={category.id} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-bold" onClick={() => void toggleCategory(category.id, category.archived)}>{category.name} · {category.archived ? 'Restore' : 'Archive'}</button>)}</div></div></section>
    <section className="card"><h2 className="text-xl font-extrabold">All expenses</h2><div className="table-wrap mt-3"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead><tbody>{data.expenses.map((item) => <tr key={item.id}><td>{item.expense_date}</td><td>{item.expense_categories?.name ?? '—'}</td><td>{item.description || '—'}</td><td className="font-bold">{money(Number(item.amount))}</td><td><div className="flex gap-2"><button className="font-bold text-leaf-700 underline" onClick={() => startEdit(item)}>Edit</button><button className="font-bold text-red-700 underline" onClick={() => setDeleting(item)}>Delete</button></div></td></tr>)}</tbody></table></div></section>
    <ConfirmDialog open={!!deleting} title="Delete expense?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteExpense()}>This expense will be permanently removed from your totals.</ConfirmDialog>
  </div>
}
function SmallTotal({ label, value }: { label: string; value: string }) { return <div className="card"><p className="text-sm font-bold text-stone-600">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></div> }
