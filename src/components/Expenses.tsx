import { useRef, useState, type FormEvent } from 'react'
import { CalendarDays, ChevronDown, Plus, Archive, RotateCcw, Pencil } from 'lucide-react'
import { money } from '../lib/calculations'
import { supabase } from '../lib/supabase'
import type { EstateData, Expense } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, Notice, PageHeading, RecordActions, SearchField, Sheet, ViewTabs, displayDate } from './Workspace'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = () => ({ expense_date: today(), category_id: '', description: '', amount: '' })
type View = 'records' | 'breakdown' | 'categories'

export function Expenses({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [view, setView] = useState<View>('records')
  const [categoryName, setCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const categoryEditorRef = useRef<HTMLInputElement>(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [categoryBusy, setCategoryBusy] = useState(false)
  const from = range.from || `${year}-01-01`
  const to = range.to || `${year}-12-31`
  const validRange = from <= to
  const categoryLabel = (item: Expense) => data.categories.find(c => c.id === item.category_id)?.name ?? item.expense_categories?.name ?? 'Uncategorised'
  const filtered = data.expenses.filter(item => validRange && item.expense_date >= from && item.expense_date <= to && (!categoryFilter || item.category_id === categoryFilter) && `${item.description} ${categoryLabel(item)}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.expense_date.localeCompare(a.expense_date))
  const categoryTotals = filtered.reduce<Record<string, number>>((totals, item) => { const name = categoryLabel(item); totals[name] = (totals[name] ?? 0) + Number(item.amount); return totals }, {})
  const monthlyTotals = filtered.reduce<Record<string, number>>((totals, item) => { const month = item.expense_date.slice(0, 7); totals[month] = (totals[month] ?? 0) + Number(item.amount); return totals }, {})
  const largestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]
  const peakMonth = Object.entries(monthlyTotals).sort((a, b) => b[1] - a[1])[0]
  const nonLabourCost = filtered.reduce((sum, item) => sum + Number(item.amount), 0)
  const labourCost = data.weeklyPayments.filter(p => validRange && !p.excluded && p.week_start >= from && p.week_start <= to).reduce((sum, p) => sum + Math.max(0, Number(p.amount) - Number(p.loan_deduction ?? 0)), 0)
  const resetFilters = () => { setRange({ from: '', to: '' }); setCategoryFilter(''); setSearch('') }

  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter an amount greater than zero.'); return }
    setSaving(true); setError('')
    try {
      const payload = { ...form, amount }
      const { error } = await (editing ? supabase.from('expenses').update(payload).eq('id', editing.id) : supabase.from('expenses').insert(payload))
      if (error) throw error
      setMessage(editing ? 'Expense updated.' : 'Expense added.')
      setForm(emptyForm()); setEditing(null); setEditorOpen(false)
      await refresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the expense. Please try again.') }
    finally { setSaving(false) }
  }
  async function addCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim() || categoryBusy) return
    setCategoryBusy(true)
    const payload = { name: categoryName.trim() }
    const { error } = await (editingCategoryId ? supabase.from('expense_categories').update(payload).eq('id', editingCategoryId) : supabase.from('expense_categories').insert(payload))
    setMessage(error ? error.message : editingCategoryId ? 'Category updated.' : 'Category added.')
    if (!error) { setCategoryName(''); setEditingCategoryId(null); await refresh() }
    setCategoryBusy(false)
  }
  async function toggleCategory(id: string, archived: boolean) { const { error } = await supabase.from('expense_categories').update({ archived: !archived }).eq('id', id); setMessage(error ? error.message : archived ? 'Category restored.' : 'Category archived.'); if (!error) await refresh() }
  async function deleteExpense() { if (!deleting) return; const { error } = await supabase.from('expenses').delete().eq('id', deleting.id); setMessage(error ? error.message : 'Expense deleted.'); setDeleting(null); if (!error) await refresh() }
  function startEdit(item: Expense) { setEditing(item); setForm({ expense_date: item.expense_date, category_id: item.category_id, description: item.description, amount: String(item.amount) }); setError(''); setEditorOpen(true) }

  return <div className="page workspace-page">
    <PageHeading title="Expenses" detail={`Estate spending · ${year}`} action="Add expense" onAction={() => { setEditing(null); setForm(emptyForm()); setError(''); setEditorOpen(true) }} />
    <Notice>{message}</Notice>
    <ViewTabs<View> label="Expense views" value={view} onChange={setView} items={[{ value: 'records', label: 'Records' }, { value: 'breakdown', label: 'Breakdown' }, { value: 'categories', label: 'Categories' }]} />
    {view !== 'categories' && <>
      <section className="workspace-filters" aria-label="Expense filters">
        <div className="filter-row"><SearchField label="Search expenses" placeholder="Search expenses" value={search} onChange={setSearch} /><select className="field filter-select" aria-label="Filter expense category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">All categories</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></div>
        <div className="period-row"><details className="date-filter"><summary><CalendarDays size={16} /><span>{displayDate(from)} - {displayDate(to)}</span><ChevronDown size={15} /></summary><div className="date-filter-fields"><label className="label">From<input className="field" type="date" value={from} onChange={e => setRange({ from: e.target.value, to })} /></label><label className="label">To<input className="field" type="date" value={to} onChange={e => setRange({ from, to: e.target.value })} /></label><button className="button-secondary" onClick={() => setRange({ from: today().slice(0, 7) + '-01', to: today() })}>This month</button></div></details>{(search || categoryFilter || range.from || range.to) && <button className="text-button" onClick={resetFilters}><RotateCcw size={14} />Reset</button>}</div>
        {!validRange && <Notice error>End date must be on or after the start date.</Notice>}
      </section>
      <div className="expense-result-summary" aria-live="polite"><div><span>Expenses in this view</span><strong>{money(nonLabourCost)}</strong></div><p>{filtered.length} {filtered.length === 1 ? 'record' : 'records'}<span>Excludes labour payments</span></p></div>
      {view === 'records' && <section aria-label="Expense records" className="records-section">
        <div className="ledger-head"><span>Expense / category</span><span>Date</span><span>Amount</span><span className="sr-only">Actions</span></div>
        {filtered.length ? filtered.map(item => <article key={item.id} className="expense-record"><div className="record-primary"><span className="category-mark" aria-hidden="true">{categoryLabel(item).slice(0, 1)}</span><div><h3>{item.description || categoryLabel(item)}</h3><p>{categoryLabel(item)}</p></div></div><time dateTime={item.expense_date}>{displayDate(item.expense_date)}</time><strong className="record-amount">{money(Number(item.amount))}</strong><RecordActions name={item.description || categoryLabel(item)} onEdit={() => startEdit(item)} onDelete={() => setDeleting(item)} /></article>) : <EmptyState title="No expenses in this view" detail="No records match the selected dates and filters." action="Reset filters" onAction={resetFilters} />}
      </section>}
      {view === 'breakdown' && <div className="breakdown-layout">
        <section className="workspace-section"><h2>By category</h2>{largestCategory && <p className="section-caption">Largest: {largestCategory[0]}</p>}<BreakdownBars values={Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])} max={nonLabourCost} /></section>
        <section className="workspace-section"><h2>By month</h2>{peakMonth && <p className="section-caption">Highest: {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${peakMonth[0]}-01T12:00:00`))}</p>}<BreakdownBars values={Object.entries(monthlyTotals).sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => [new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`)), value])} max={peakMonth?.[1] ?? 0} /></section>
        <section className="workspace-section expense-reconciliation"><h2>Spending details</h2><dl className="detail-list"><div><dt>Filtered expenses</dt><dd>{money(nonLabourCost)}</dd></div><div><dt>Average expense</dt><dd>{money(filtered.length ? nonLabourCost / filtered.length : 0)}</dd></div><div><dt>Workers' take-home pay</dt><dd>{money(labourCost)}</dd></div><div><dt>Expenses + take-home pay</dt><dd>{money(nonLabourCost + labourCost)}</dd></div></dl><p className="section-caption">Take-home pay covers all saved workers in the selected dates, after loan deductions. Category and search filters apply to expenses only.</p></section>
      </div>}
    </>}
    {view === 'categories' && <section className="workspace-section"><div className="section-heading"><div><h2>Expense categories</h2><p className="section-caption">{data.categories.filter(c => !c.archived).length} active · {data.categories.filter(c => c.archived).length} archived</p></div></div><form className="category-form" onSubmit={addCategory}><label className="label">{editingCategoryId ? 'Category name' : 'New category'}<input ref={categoryEditorRef} className="field" value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="e.g. Repairs" required /></label><button className="button-primary" disabled={categoryBusy}><Plus size={17} />{editingCategoryId ? 'Save category' : 'Add category'}</button>{editingCategoryId && <button type="button" className="button-secondary" onClick={() => { setEditingCategoryId(null); setCategoryName('') }}>Cancel</button>}</form><div className="category-list">{data.categories.map(category => <div key={category.id} className="category-list-row"><div><strong>{category.name}</strong><span className={`status-label ${category.archived ? '' : 'is-active'}`}>{category.archived ? 'Archived' : 'Active'}</span></div><div className="record-actions"><button className="icon-button" aria-label={`Edit ${category.name}`} title="Edit category" onClick={() => { setEditingCategoryId(category.id); setCategoryName(category.name); categoryEditorRef.current?.focus(); categoryEditorRef.current?.scrollIntoView({ block: 'center' }) }}><Pencil size={17} /></button><button className="icon-button" aria-label={`${category.archived ? 'Restore' : 'Archive'} ${category.name}`} title={category.archived ? 'Restore' : 'Archive'} onClick={() => void toggleCategory(category.id, category.archived)}>{category.archived ? <RotateCcw size={17} /> : <Archive size={17} />}</button></div></div>)}</div></section>}
    <Sheet open={editorOpen} title={editing ? 'Edit expense' : 'Add expense'} onClose={() => setEditorOpen(false)} busy={saving}>
      <form className="workspace-form" onSubmit={saveExpense}><Notice error>{error}</Notice><label className="label">Amount (₹)<input className="field amount-input" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></label><div className="form-pair"><label className="label">Date<input className="field" type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} required /></label><label className="label">Category<select className="field" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} required><option value="">Choose category</option>{data.categories.filter(c => !c.archived || c.id === form.category_id).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label></div>{!data.categories.some(c => !c.archived) && <button type="button" className="text-button" onClick={() => { setEditorOpen(false); setView('categories') }}>Add a category first</button>}<label className="label">Description <span className="optional">(optional)</span><textarea className="field" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What was this expense for?" /></label><div className="sheet-footer"><button type="button" className="button-secondary" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save expense'}</button></div></form>
    </Sheet>
    <ConfirmDialog open={!!deleting} title="Delete expense?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteExpense()}>This expense will be permanently removed from your totals.</ConfirmDialog>
  </div>
}

function BreakdownBars({ values, max }: { values: [string, number][]; max: number }) {
  return values.length ? <div className="breakdown-bars">{values.map(([name, amount]) => <div key={name}><div><span>{name}</span><strong>{money(amount)}</strong></div><div className="breakdown-track"><span style={{ width: `${max ? Math.max(0, Math.min(100, amount / max * 100)) : 0}%` }} /></div></div>)}</div> : <EmptyState title="No spending to show" />
}
