import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { estateToday } from '../lib/estateDates'
import { errorMessage } from '../lib/errors'
import type { EstateData, Expense } from '../lib/types'
import { Notice, Sheet } from './Workspace'

type ExpenseEditorProps = {
  data: EstateData
  refresh: () => Promise<void>
  open: boolean
  onClose: () => void
  editing?: Expense | null
  onSaved?: (message: string) => void
  onManageCategories?: () => void
}

// Each opening starts a fresh form; a failed save leaves that form in place.
export function ExpenseEditor({ open, editing = null, ...props }: ExpenseEditorProps) {
  return open ? <ExpenseEditorForm key={editing?.id ?? 'new'} editing={editing} {...props} /> : null
}

function ExpenseEditorForm({ data, refresh, onClose, editing, onSaved, onManageCategories }: Omit<ExpenseEditorProps, 'open' | 'editing'> & { editing: Expense | null }) {
  const [form, setForm] = useState(() => ({
    expense_date: editing?.expense_date ?? estateToday(),
    category_id: editing?.category_id ?? '',
    description: editing?.description ?? '',
    amount: editing ? String(editing.amount) : ''
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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
      onSaved?.(editing ? 'Expense updated.' : 'Expense added.')
      onClose()
      await refresh()
    } catch (error) { setError(errorMessage(error, 'Could not save the expense. Please try again.')) }
    finally { setSaving(false) }
  }

  return <Sheet open title={editing ? 'Edit expense' : 'Add expense'} onClose={onClose} busy={saving}>
    <form className="workspace-form" onSubmit={saveExpense}>
      <Notice error>{error}</Notice>
      <label className="label">Amount (₹)<input className="field amount-input" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></label>
      <div className="form-pair">
        <label className="label">Date<input className="field" type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} required /></label>
        <label className="label">Category<select className="field" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} required><option value="">Choose category</option>{data.categories.filter(c => !c.archived || c.id === form.category_id).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label>
      </div>
      {!data.categories.some(c => !c.archived) && (onManageCategories
        ? <button type="button" className="text-button" onClick={() => { onClose(); onManageCategories() }}>Add a category first</button>
        : <Notice error>Add a category in Expenses before saving.</Notice>)}
      <label className="label">Description <span className="optional">(optional)</span><textarea className="field" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What was this expense for?" /></label>
      <div className="sheet-footer"><button type="button" className="button-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save expense'}</button></div>
    </form>
  </Sheet>
}
