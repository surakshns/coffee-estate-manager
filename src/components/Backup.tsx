import { useRef, useState } from 'react'
import { downloadCsv, parseCsv } from '../lib/csv'
import { supabase } from '../lib/supabase'
import type { Dataset, EstateData } from '../lib/types'

const datasets: { key: Dataset; label: string }[] = [
  { key: 'workers', label: 'Workers' }, { key: 'labourRates', label: 'Yearly daily pay rates' }, { key: 'weeklyPayments', label: 'Weekly payments' }, { key: 'workerLoans', label: 'Worker loans' }, { key: 'jointLoans', label: 'Joint loans' }, { key: 'jointLoanRepayments', label: 'Joint loan clearances' }, { key: 'categories', label: 'Expense categories' }, { key: 'expenses', label: 'Expenses' }, { key: 'prices', label: 'Coffee prices' }, { key: 'monthlyGuideEntries', label: 'Coffee estate guide notes' }, { key: 'production', label: 'Production' }, { key: 'sales', label: 'Sales' }
]

export function Backup({ data, refresh }: { data: EstateData; refresh: () => Promise<void> }) {
  const [dataset, setDataset] = useState<Dataset>('expenses'); const [message, setMessage] = useState(''); const fileInput = useRef<HTMLInputElement>(null)
  const exportRows = (key: Dataset) => {
    if (key === 'weeklyPayments') return data.weeklyPayments.map((item) => ({ week_start: item.week_start, amount: item.amount, days_worked: item.days_worked ?? '', daily_rate: item.daily_rate ?? '', loan_deduction: item.loan_deduction ?? 0, excluded: item.excluded ?? false, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '' }))
    if (key === 'workerLoans') return data.workerLoans.map((item) => ({ loan_date: item.loan_date, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '', kind: item.kind, amount: item.amount, notes: item.notes }))
    if (key === 'jointLoans') return data.jointLoans.map((item) => ({ loan_date: item.loan_date, worker_one_name: data.workers.find((worker) => worker.id === item.worker_one_id)?.name ?? '', worker_two_name: data.workers.find((worker) => worker.id === item.worker_two_id)?.name ?? '', amount: item.amount, notes: item.notes }))
    if (key === 'jointLoanRepayments') return data.jointLoanRepayments.map((item) => {
      const loan = data.jointLoans.find((jointLoan) => jointLoan.id === item.joint_loan_id)
      return { joint_loan_date: loan?.loan_date ?? '', worker_one_name: data.workers.find((worker) => worker.id === loan?.worker_one_id)?.name ?? '', worker_two_name: data.workers.find((worker) => worker.id === loan?.worker_two_id)?.name ?? '', repayment_date: item.repayment_date, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '', amount: item.amount, notes: item.notes }
    })
    if (key === 'expenses') return data.expenses.map((item) => ({ expense_date: item.expense_date, category: item.expense_categories?.name ?? '', description: item.description, amount: item.amount }))
    if (key === 'monthlyGuideEntries') return data.monthlyGuideEntries.map((item) => ({ month_number: item.month_number, title: item.title, notes: item.notes }))
    if (key === 'categories') return data.categories.map(({ name, archived }) => ({ name, archived }))
    return (data[key] as unknown as Record<string, unknown>[]).map(({ id: _id, ...row }) => row)
  }
  function exportOne(key: Dataset) { downloadCsv(`coffee-estate-${key}-${new Date().toISOString().slice(0, 10)}.csv`, exportRows(key)) }
  async function importFile(file: File) {
    const rows = parseCsv(await file.text()); if (!rows.length) { setMessage('No valid CSV rows were found.'); return }
    try {
      if (dataset === 'workers') {
        const { error } = await supabase.from('workers').insert(rows.map((row) => ({ name: row.name, active: row.active !== 'false', default_weekly_amount: Number(row.default_weekly_amount) })))
        if (error) throw error
      } else if (dataset === 'categories') {
        const { error } = await supabase.from('expense_categories').insert(rows.map((row) => ({ name: row.name, archived: row.archived === 'true' })))
        if (error) throw error
      } else if (dataset === 'weeklyPayments') {
        const inserts = rows.map((row) => ({ worker_id: data.workers.find((worker) => worker.name.trim().toLowerCase() === row.worker_name.trim().toLowerCase())?.id, week_start: row.week_start, amount: Number(row.amount), days_worked: row.days_worked ? Number(row.days_worked) : null, daily_rate: row.daily_rate ? Number(row.daily_rate) : null, loan_deduction: Number(row.loan_deduction || 0), excluded: row.excluded === 'true' }))
        if (inserts.some((row) => !row.worker_id)) throw new Error('Create or import all matching worker names before importing weekly payments.')
        const { error } = await supabase.from('weekly_payments').upsert(inserts as { worker_id: string; week_start: string; amount: number; days_worked: number | null; daily_rate: number | null; loan_deduction: number; excluded: boolean }[], { onConflict: 'worker_id,week_start' })
        if (error) throw error
      } else if (dataset === 'labourRates') {
        const { error } = await supabase.from('labour_daily_rates').upsert(rows.map((row) => ({ rate_year: Number(row.rate_year), daily_rate: Number(row.daily_rate) })), { onConflict: 'user_id,rate_year' })
        if (error) throw error
      } else if (dataset === 'workerLoans') {
        const inserts = rows.map((row) => ({ worker_id: data.workers.find((worker) => worker.name.trim().toLowerCase() === row.worker_name.trim().toLowerCase())?.id, loan_date: row.loan_date, kind: row.kind === 'repayment' ? 'repayment' : 'advance', amount: Number(row.amount), notes: row.notes ?? '' }))
        if (inserts.some((row) => !row.worker_id)) throw new Error('Create or import all matching worker names before importing worker loans.')
        const { error } = await supabase.from('worker_loans').insert(inserts as { worker_id: string; loan_date: string; kind: 'advance' | 'repayment'; amount: number; notes: string }[])
        if (error) throw error
      } else if (dataset === 'jointLoans') {
        const workerId = (name: string) => data.workers.find((worker) => worker.name.trim().toLowerCase() === name.trim().toLowerCase())?.id
        const inserts = rows.map((row) => ({ worker_one_id: workerId(row.worker_one_name), worker_two_id: workerId(row.worker_two_name), loan_date: row.loan_date, amount: Number(row.amount), notes: row.notes ?? '' }))
        if (inserts.some((row) => !row.worker_one_id || !row.worker_two_id)) throw new Error('Create or import both matching worker names before importing joint loans.')
        const { error } = await supabase.from('joint_loans').insert(inserts as { worker_one_id: string; worker_two_id: string; loan_date: string; amount: number; notes: string }[])
        if (error) throw error
      } else if (dataset === 'jointLoanRepayments') {
        const workerId = (name: string) => data.workers.find((worker) => worker.name.trim().toLowerCase() === name.trim().toLowerCase())?.id
        const inserts = rows.map((row) => {
          const one = workerId(row.worker_one_name); const two = workerId(row.worker_two_name)
          const loan = data.jointLoans.find((item) => item.loan_date === row.joint_loan_date && ((item.worker_one_id === one && item.worker_two_id === two) || (item.worker_one_id === two && item.worker_two_id === one)))
          return { joint_loan_id: loan?.id, worker_id: row.worker_name ? workerId(row.worker_name) : null, repayment_date: row.repayment_date, amount: Number(row.amount), notes: row.notes ?? '' }
        })
        if (inserts.some((row) => !row.joint_loan_id)) throw new Error('Import the matching joint loans first, then refresh before importing their clearances.')
        const { error } = await supabase.from('joint_loan_repayments').insert(inserts as { joint_loan_id: string; worker_id: string | null; repayment_date: string; amount: number; notes: string }[])
        if (error) throw error
      } else if (dataset === 'expenses') {
        const inserts = rows.map((row) => ({ expense_date: row.expense_date, category_id: data.categories.find((category) => category.name.toLowerCase() === row.category.toLowerCase())?.id, description: row.description ?? '', amount: Number(row.amount) }))
        if (inserts.some((row) => !row.category_id)) throw new Error('Create or import matching expense categories before importing expenses.')
        const { error } = await supabase.from('expenses').insert(inserts as { expense_date: string; category_id: string; description: string; amount: number }[])
        if (error) throw error
      } else if (dataset === 'prices') {
        const { error } = await supabase.from('coffee_prices').insert(rows.map((row) => ({ price_date: row.price_date, coffee_type: row.coffee_type, grade: row.grade || 'Standard', source: row.source || 'CSV import', price_per_kg: Number(row.price_per_kg) })))
        if (error) throw error
      } else if (dataset === 'monthlyGuideEntries') {
        const inserts = rows.map((row) => ({ month_number: Number(row.month_number) || Number(row.plan_month?.slice(5, 7)), title: row.title?.trim() ?? '', notes: row.notes ?? '' }))
        if (inserts.some((row) => !Number.isInteger(row.month_number) || row.month_number < 1 || row.month_number > 12 || !row.title)) throw new Error('Each guide row needs a month number from 1–12 and a title.')
        const { error } = await supabase.from('monthly_tasks').insert(inserts)
        if (error) throw error
      } else if (dataset === 'production') {
        const { error } = await supabase.from('production_records').insert(rows.map((row) => ({ production_year: Number(row.production_year), bags_produced: Number(row.bags_produced), bag_weight_kg: Number(row.bag_weight_kg), notes: row.notes || null })))
        if (error) throw error
      } else if (dataset === 'sales') {
        const { error } = await supabase.from('sales').insert(rows.map((row) => ({ production_year: Number(row.production_year), sale_date: row.sale_date, bags_sold: Number(row.bags_sold), selling_price_per_bag: Number(row.selling_price_per_bag), buyer: row.buyer || '' })))
        if (error) throw error
      }
      setMessage(`${rows.length} ${dataset} rows imported.`); await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed.') }
  }
  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Your records</p><h1 className="mt-1 text-3xl font-extrabold">Backup and import</h1><p className="mt-1 text-stone-600">Download CSV copies regularly. Keep them somewhere safe, such as your computer or drive.</p></header>{message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="card"><h2 className="text-xl font-extrabold">Export a CSV backup</h2><p className="mt-1 text-stone-600">Each button downloads a simple spreadsheet file.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{datasets.map((item) => <button className="button-secondary justify-between" key={item.key} onClick={() => exportOne(item.key)}><span>{item.label}</span><span aria-hidden>↓ CSV</span></button>)}</div></section>
    <section className="card"><h2 className="text-xl font-extrabold">Import a CSV</h2><p className="mt-1 text-stone-600">Use a CSV downloaded from this app. Importing adds rows; it does not erase existing records.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="label flex-1">Record type<select className="field" value={dataset} onChange={(event) => setDataset(event.target.value as Dataset)}>{datasets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><input className="hidden" ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} /><button className="button-primary" onClick={() => fileInput.current?.click()}>Choose CSV file</button></div></section></div>
}
