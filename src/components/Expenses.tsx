import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, ChevronDown, Plus, Archive, RotateCcw, Pencil } from 'lucide-react'
import { money } from '../lib/calculations'
import { estateToday } from '../lib/estateDates'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type { EstateData, Expense } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { ExpenseEditor } from './ExpenseEditor'
import { EmptyState, Notice, PageHeading, RecordActions, SearchField, ViewTabs, displayDate } from './Workspace'

type View = 'records' | 'breakdown' | 'categories'

export function Expenses({ data, year, refresh, initialView = 'records' }: { data: EstateData; year: number; refresh: () => Promise<void>; initialView?: View }) {
  const [editing, setEditing] = useState<Expense | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [view, setView] = useState<View>(initialView)
  const [categoryName, setCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const categoryEditorRef = useRef<HTMLInputElement>(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  useEffect(() => setLimit(50), [search, categoryFilter, range.from, range.to, year])
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [message, setMessage] = useState('')
  const [recordError, setRecordError] = useState('')
  const categoryWriting = useRef(false)
  const deletingRef = useRef(false)
  const [categoryBusy, setCategoryBusy] = useState(false)
  const from = range.from || `${year}-01-01`
  const to = range.to || `${year}-12-31`
  const validRange = from <= to
  const categoryNames = useMemo(() => new Map(data.categories.map(category => [category.id, category.name])), [data.categories])
  const categoryLabel = (item: Expense) => categoryNames.get(item.category_id) ?? item.expense_categories?.name ?? 'Uncategorised'
  const filtered = data.expenses.filter(item => validRange && item.expense_date >= from && item.expense_date <= to && (!categoryFilter || item.category_id === categoryFilter) && `${item.description} ${categoryLabel(item)}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.expense_date.localeCompare(a.expense_date))
  const categoryTotals = filtered.reduce<Record<string, number>>((totals, item) => { const name = categoryLabel(item); totals[name] = (totals[name] ?? 0) + Number(item.amount); return totals }, {})
  const monthlyTotals = filtered.reduce<Record<string, number>>((totals, item) => { const month = item.expense_date.slice(0, 7); totals[month] = (totals[month] ?? 0) + Number(item.amount); return totals }, {})
  const largestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]
  const peakMonth = Object.entries(monthlyTotals).sort((a, b) => b[1] - a[1])[0]
  const nonLabourCost = filtered.reduce((sum, item) => sum + Number(item.amount), 0)
  const labourCost = data.weeklyPayments.filter(p => validRange && !p.excluded && p.week_start >= from && p.week_start <= to).reduce((sum, p) => sum + Math.max(0, Number(p.amount) - Number(p.loan_deduction ?? 0)), 0)
  const resetFilters = () => { setRange({ from: '', to: '' }); setCategoryFilter(''); setSearch('') }

  async function mutateCategory(action: () => PromiseLike<{ error: { message: string } | null }>, success: string, clearEditor = false) {
    if (categoryWriting.current) return
    categoryWriting.current = true; setCategoryBusy(true); setRecordError(''); setMessage('')
    try {
      const result = await action()
      if (result.error) throw result.error
      setMessage(success)
      if (clearEditor) { setCategoryName(''); setEditingCategoryId(null) }
      await refresh()
    } catch (cause) { setRecordError(errorMessage(cause, 'Could not update this category.')) }
    finally { categoryWriting.current = false; setCategoryBusy(false) }
  }
  async function addCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim() || categoryWriting.current) return
    const name = categoryName.trim()
    if (data.categories.some(item => item.id !== editingCategoryId && item.name.trim().toLowerCase() === name.toLowerCase())) { setRecordError('A category with this name already exists.'); return }
    await mutateCategory(() => editingCategoryId ? supabase.from('expense_categories').update({ name }).eq('id', editingCategoryId) : supabase.from('expense_categories').insert({ name }), editingCategoryId ? 'Category updated.' : 'Category added.', true)
  }
  async function toggleCategory(id: string, archived: boolean) {
    await mutateCategory(() => supabase.from('expense_categories').update({ archived: !archived }).eq('id', id), archived ? 'Category restored.' : 'Category archived.')
  }
  async function deleteExpense() {
    if (!deleting || deletingRef.current) return
    deletingRef.current = true; setRecordError(''); setMessage('')
    const id = deleting.id; setDeleting(null)
    try {
      const result = await supabase.from('expenses').delete().eq('id', id)
      if (result.error) throw result.error
      setMessage('Expense deleted.'); await refresh()
    } catch (cause) { setRecordError(errorMessage(cause, 'Could not delete this expense.')) }
    finally { deletingRef.current = false }
  }
  function startEdit(item: Expense) { setEditing(item); setEditorOpen(true) }

  return <div className="page workspace-page">
    <PageHeading title="Expenses" detail={`Estate spending · ${year}`} action="Add expense" onAction={() => { setEditing(null); setEditorOpen(true) }} />
    <Notice>{message}</Notice><Notice error>{recordError}</Notice>
    <ViewTabs<View> label="Expense views" value={view} onChange={setView} items={[{ value: 'records', label: 'Records' }, { value: 'breakdown', label: 'Breakdown' }, { value: 'categories', label: 'Categories' }]} />
    {view !== 'categories' && <>
      <section className="workspace-filters" aria-label="Expense filters">
        <div className="filter-row"><SearchField label="Search expenses" placeholder="Search expenses" value={search} onChange={setSearch} /><select className="field filter-select" aria-label="Filter expense category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">All categories</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></div>
        <div className="period-row"><details className="date-filter"><summary><CalendarDays size={16} /><span>{displayDate(from)} - {displayDate(to)}</span><ChevronDown size={15} /></summary><div className="date-filter-fields"><label className="label">From<input className="field" type="date" value={from} onChange={e => setRange({ from: e.target.value, to })} /></label><label className="label">To<input className="field" type="date" value={to} onChange={e => setRange({ from, to: e.target.value })} /></label><button className="button-secondary" onClick={() => setRange({ from: estateToday().slice(0, 7) + '-01', to: estateToday() })}>This month</button></div></details>{(search || categoryFilter || range.from || range.to) && <button className="text-button" onClick={resetFilters}><RotateCcw size={14} />Reset</button>}</div>
        {!validRange && <Notice error>End date must be on or after the start date.</Notice>}
      </section>
      <div className="expense-result-summary" aria-live="polite"><div><span>Expenses in this view</span><strong>{money(nonLabourCost)}</strong></div><p>{filtered.length} {filtered.length === 1 ? 'record' : 'records'}<span>Excludes labour payments</span></p></div>
      {view === 'records' && <section aria-label="Expense records" className="records-section">
        <div className="ledger-head"><span>Expense / category</span><span>Date</span><span>Amount</span><span className="sr-only">Actions</span></div>
        {filtered.length ? filtered.slice(0, limit).map(item => <article key={item.id} className="expense-record"><div className="record-primary"><span className="category-mark" aria-hidden="true">{categoryLabel(item).slice(0, 1)}</span><div><h3>{item.description || categoryLabel(item)}</h3><p>{categoryLabel(item)}</p></div></div><time dateTime={item.expense_date}>{displayDate(item.expense_date)}</time><strong className="record-amount">{money(Number(item.amount))}</strong><RecordActions name={item.description || categoryLabel(item)} onEdit={() => startEdit(item)} onDelete={() => setDeleting(item)} /></article>) : <EmptyState title="No expenses in this view" detail="No records match the selected dates and filters." action="Reset filters" onAction={resetFilters} />}
        {filtered.length > limit && <div className="records-more"><p>Showing {limit} of {filtered.length} records. Totals include all matches.</p><button className="button-secondary" onClick={() => setLimit(value => value + 50)}>Show more expenses</button></div>}
      </section>}
      {view === 'breakdown' && <div className="breakdown-layout">
        <section className="workspace-section"><h2>By category</h2>{largestCategory && <p className="section-caption">Largest: {largestCategory[0]}</p>}<BreakdownBars values={Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])} max={nonLabourCost} /></section>
        <section className="workspace-section"><h2>By month</h2>{peakMonth && <p className="section-caption">Highest: {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${peakMonth[0]}-01T12:00:00`))}</p>}<BreakdownBars values={Object.entries(monthlyTotals).sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => [new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`)), value])} max={peakMonth?.[1] ?? 0} /></section>
        <section className="workspace-section expense-reconciliation"><h2>Spending details</h2><dl className="detail-list"><div><dt>Filtered expenses</dt><dd>{money(nonLabourCost)}</dd></div><div><dt>Average expense</dt><dd>{money(filtered.length ? nonLabourCost / filtered.length : 0)}</dd></div><div><dt>Workers' take-home pay</dt><dd>{money(labourCost)}</dd></div><div><dt>Expenses + take-home pay</dt><dd>{money(nonLabourCost + labourCost)}</dd></div></dl><p className="section-caption">Take-home pay covers all saved workers in the selected dates, after loan deductions. Category and search filters apply to expenses only.</p></section>
      </div>}
    </>}
    {view === 'categories' && <section className="workspace-section"><div className="section-heading"><div><h2>Expense categories</h2><p className="section-caption">{data.categories.filter(c => !c.archived).length} active · {data.categories.filter(c => c.archived).length} archived</p></div></div><form className="category-form" onSubmit={addCategory}><label className="label">{editingCategoryId ? 'Category name' : 'New category'}<input ref={categoryEditorRef} disabled={categoryBusy} className="field" value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="e.g. Repairs" required /></label><button className="button-primary" disabled={categoryBusy}><Plus size={17} />{editingCategoryId ? 'Save category' : 'Add category'}</button>{editingCategoryId && <button type="button" disabled={categoryBusy} className="button-secondary" onClick={() => { setEditingCategoryId(null); setCategoryName('') }}>Cancel</button>}</form><div className="category-list">{data.categories.map(category => <div key={category.id} className="category-list-row"><div><strong>{category.name}</strong><span className={`status-label ${category.archived ? '' : 'is-active'}`}>{category.archived ? 'Archived' : 'Active'}</span></div><div className="record-actions"><button className="icon-button" disabled={categoryBusy} aria-label={`Edit ${category.name}`} title="Edit category" onClick={() => { setEditingCategoryId(category.id); setCategoryName(category.name); categoryEditorRef.current?.focus(); categoryEditorRef.current?.scrollIntoView({ block: 'center' }) }}><Pencil size={17} /></button><button className="icon-button" disabled={categoryBusy} aria-label={`${category.archived ? 'Restore' : 'Archive'} ${category.name}`} title={category.archived ? 'Restore' : 'Archive'} onClick={() => void toggleCategory(category.id, category.archived)}>{category.archived ? <RotateCcw size={17} /> : <Archive size={17} />}</button></div></div>)}</div></section>}
    <ExpenseEditor data={data} refresh={refresh} open={editorOpen} editing={editing} onClose={() => setEditorOpen(false)} onSaved={setMessage} onManageCategories={() => setView('categories')} />
    <ConfirmDialog open={!!deleting} title="Delete expense?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteExpense()}>This expense will be permanently removed from your totals.</ConfirmDialog>
  </div>
}

function BreakdownBars({ values, max }: { values: [string, number][]; max: number }) {
  return values.length ? <div className="breakdown-bars">{values.map(([name, amount]) => <div key={name}><div><span>{name}</span><strong>{money(amount)}</strong></div><div className="breakdown-track"><span style={{ width: `${max ? Math.max(0, Math.min(100, amount / max * 100)) : 0}%` }} /></div></div>)}</div> : <EmptyState title="No spending to show" />
}
