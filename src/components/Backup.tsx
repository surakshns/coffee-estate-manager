import { useRef, useState } from 'react'
import { downloadCsv, parseCsv } from '../lib/csv'
import { supabase } from '../lib/supabase'
import type { Dataset, EstateData } from '../lib/types'

const datasets: { key: Dataset; label: string }[] = [
  { key: 'workers', label: 'Workers' }, { key: 'weeklyPayments', label: 'Weekly payments' }, { key: 'categories', label: 'Expense categories' }, { key: 'expenses', label: 'Expenses' }, { key: 'prices', label: 'Coffee prices' }, { key: 'production', label: 'Production' }, { key: 'sales', label: 'Sales' }
]

export function Backup({ data, refresh }: { data: EstateData; refresh: () => Promise<void> }) {
  const [dataset, setDataset] = useState<Dataset>('expenses'); const [message, setMessage] = useState(''); const fileInput = useRef<HTMLInputElement>(null)
  const exportRows = (key: Dataset) => {
    if (key === 'weeklyPayments') return data.weeklyPayments.map((item) => ({ week_start: item.week_start, amount: item.amount, worker_name: data.workers.find((worker) => worker.id === item.worker_id)?.name ?? '' }))
    if (key === 'expenses') return data.expenses.map((item) => ({ expense_date: item.expense_date, category: item.expense_categories?.name ?? '', description: item.description, amount: item.amount }))
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
        const inserts = rows.map((row) => ({ worker_id: data.workers.find((worker) => worker.name.trim().toLowerCase() === row.worker_name.trim().toLowerCase())?.id, week_start: row.week_start, amount: Number(row.amount) }))
        if (inserts.some((row) => !row.worker_id)) throw new Error('Create or import all matching worker names before importing weekly payments.')
        const { error } = await supabase.from('weekly_payments').upsert(inserts as { worker_id: string; week_start: string; amount: number }[], { onConflict: 'worker_id,week_start' })
        if (error) throw error
      } else if (dataset === 'expenses') {
        const inserts = rows.map((row) => ({ expense_date: row.expense_date, category_id: data.categories.find((category) => category.name.toLowerCase() === row.category.toLowerCase())?.id, description: row.description ?? '', amount: Number(row.amount) }))
        if (inserts.some((row) => !row.category_id)) throw new Error('Create or import matching expense categories before importing expenses.')
        const { error } = await supabase.from('expenses').insert(inserts as { expense_date: string; category_id: string; description: string; amount: number }[])
        if (error) throw error
      } else if (dataset === 'prices') {
        const { error } = await supabase.from('coffee_prices').insert(rows.map((row) => ({ price_date: row.price_date, coffee_type: row.coffee_type, grade: row.grade || 'Standard', source: row.source || 'CSV import', price_per_kg: Number(row.price_per_kg) })))
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
