import { useRef, useState } from 'react'
import { downloadCsv, parseCsv } from '../lib/csv'
import { prepareImport, type ImportPlan } from '../lib/backupImport'
import { estateToday } from '../lib/estateDates'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type { Dataset, EstateData } from '../lib/types'
import { Notice, PageHeading, Sheet } from './Workspace'

const datasets: { key: Dataset; label: string }[] = [
  { key: 'workers', label: 'Workers' }, { key: 'labourRates', label: 'Yearly daily pay rates' }, { key: 'weeklyPayments', label: 'Weekly payments' }, { key: 'workerLoans', label: 'Worker loans' }, { key: 'categories', label: 'Expense categories' }, { key: 'expenses', label: 'Expenses' }, { key: 'prices', label: 'Coffee prices' }, { key: 'monthlyGuideEntries', label: 'Coffee estate guide notes' }, { key: 'production', label: 'Production' }, { key: 'sales', label: 'Sales' }
]
type Preview = { dataset: Dataset; fileName: string; source: Record<string, string>[]; plan: ImportPlan }

export function Backup({ data, refresh }: { data: EstateData; refresh: () => Promise<void> }) {
  const [dataset, setDataset] = useState<Dataset>('expenses')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const exportRows = (key: Dataset) => {
    if (key === 'weeklyPayments') return data.weeklyPayments.map((item) => ({ week_start: item.week_start, amount: item.amount, days_worked: item.days_worked ?? '', daily_rate: item.daily_rate ?? '', loan_deduction: item.loan_deduction ?? 0, excluded: item.excluded ?? false, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '' }))
    if (key === 'workerLoans') return data.workerLoans.map((item) => ({ loan_date: item.loan_date, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '', kind: item.kind, amount: item.amount, notes: item.notes }))
    if (key === 'expenses') return data.expenses.map((item) => ({ expense_date: item.expense_date, category: item.expense_categories?.name ?? '', description: item.description, amount: item.amount }))
    if (key === 'monthlyGuideEntries') return data.monthlyGuideEntries.map((item) => ({ month_number: item.month_number, title: item.title, notes: item.notes }))
    if (key === 'categories') return data.categories.map(({ name, archived }) => ({ name, archived }))
    return (data[key] as unknown as Record<string, unknown>[]).map(({ id: _id, ...row }) => row)
  }

  function exportOne(key: Dataset) { downloadCsv(`coffee-estate-${key}-${estateToday()}.csv`, exportRows(key)) }
  async function reviewFile(file: File) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setMessage('')
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a CSV smaller than 5 MB.')
      const source = parseCsv(await file.text())
      setPreview({ dataset, fileName: file.name, source, plan: prepareImport(dataset, source, data) })
    } catch (cause) { setError(errorMessage(cause, 'Could not read this CSV.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function importReviewed() {
    if (!preview || busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      // Revalidate against the latest records before making the single bulk write.
      const plan = prepareImport(preview.dataset, preview.source, data)
      const query = supabase.from(plan.table)
      const result = plan.rpc ? await supabase.rpc(plan.rpc, { p_rows: plan.rows }) : plan.onConflict
        ? await query.upsert(plan.rows, { onConflict: plan.onConflict, defaultToNull: false })
        : await query.insert(plan.rows)
      if (result.error) throw result.error
      setPreview(null)
      setMessage(`${plan.rows.length} records imported${plan.replacements ? ` · ${plan.replacements} existing records updated` : ''}.`)
      await refresh()
    } catch (cause) { setError(errorMessage(cause, 'Import failed. Please try again.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const columns = preview ? Object.keys(preview.source[0]).slice(0, 6) : []
  return <div className="page workspace-page backup-page">
    <PageHeading title="Backup & import" detail="Keep a copy of your estate records" />
    <Notice>{message}</Notice><Notice error>{error}</Notice>
    <section className="workspace-section backup-export">
      <h2>Download your records</h2><p className="section-detail">Each CSV includes all years. Save the files somewhere private. Document files are downloaded from the Documents screen.</p>
      <div className="backup-grid">{datasets.map(item => <button className="backup-download" key={item.key} onClick={() => exportOne(item.key)}><span><strong>{item.label}</strong><small>{data[item.key].length.toLocaleString()} records</small></span><span aria-hidden="true">↓ CSV</span></button>)}</div>
    </section>
    <section className="workspace-section">
      <h2>Restore from a CSV</h2><p className="section-detail">Choose a record type and an app CSV. You can review the records before importing. Restore workers and categories first, then worker loans, then weekly payments and expenses. Weekly imports reconcile pay deductions in the loan ledger.</p>
      <div className="backup-import-controls"><label className="label">Record type<select className="field" value={dataset} disabled={busy} onChange={event => { setDataset(event.target.value as Dataset); setError('') }}>{datasets.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <input className="hidden" ref={fileInput} type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void reviewFile(file); event.target.value = '' }} />
      <button className="button-primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Reading CSV…' : 'Choose CSV to review'}</button></div>
      <p className="section-detail">Workers and categories with matching names, weekly payments for the same worker and date, and yearly rates update existing records. Other record types add rows; importing the same file twice adds duplicates.</p>
    </section>
    <Sheet open={!!preview} title="Review import" busy={busy} onClose={() => { setPreview(null); setError('') }} wide>
      {preview && <div className="workspace-form"><Notice error>{error}</Notice><p className="import-file-name">{preview.fileName}</p><div className="import-summary"><strong>{preview.plan.rows.length.toLocaleString()} records</strong><span>{datasets.find(item => item.key === preview.dataset)?.label}</span><span>{preview.plan.replacements ? `${preview.plan.replacements} existing records will be updated.` : 'These records will be added.'}</span></div>
      <div className="table-scroll import-preview"><table><caption>First {Math.min(5, preview.source.length)} records{Object.keys(preview.source[0]).length > 6 ? ' · first 6 columns' : ''}</caption><thead><tr>{columns.map(key => <th scope="col" key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{preview.source.slice(0, 5).map((row, index) => <tr key={index}>{columns.map(key => <td key={key}>{row[key] || '—'}</td>)}</tr>)}</tbody></table></div>
      {!preview.plan.onConflict && <p className="section-detail">This adds records. If you have imported this file before, cancel to avoid duplicates.</p>}
      <div className="sheet-footer"><button className="button-secondary" disabled={busy} onClick={() => { setPreview(null); setError('') }}>Cancel</button><button className="button-primary" disabled={busy} onClick={() => void importReviewed()}>{busy ? 'Importing…' : `Import ${preview.plan.rows.length} records`}</button></div></div>}
    </Sheet>
  </div>
}
