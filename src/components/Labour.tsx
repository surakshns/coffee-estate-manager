import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { money, monthlyLabourTotal, recordedPaymentTotal, weeklyTotal, wednesdaysInMonth, workersForPaymentDate, yearlyLabourTotal } from '../lib/calculations'
import { supabase } from '../lib/supabase'
import type { EstateData, Worker } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

const asNumber = (value: string) => Number(value || 0)
const monthName = (monthIndex: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, monthIndex, 1))
const friendlyDate = (date: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))

export function Labour({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [openMonth, setOpenMonth] = useState(new Date().getMonth())
  const [openWednesday, setOpenWednesday] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [addingForDate, setAddingForDate] = useState('')
  const [quickWorkerName, setQuickWorkerName] = useState('')
  const [quickWorkerAmount, setQuickWorkerAmount] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [workerAmount, setWorkerAmount] = useState('')
  const [editing, setEditing] = useState<Worker | null>(null)
  const [deleting, setDeleting] = useState<Worker | null>(null)
  const [message, setMessage] = useState('')
  const allMonths = useMemo(() => Array.from({ length: 12 }, (_, monthIndex) => ({ monthIndex, dates: wednesdaysInMonth(year, monthIndex) })), [year])
  const workersForOpenDate = useMemo(() => openWednesday ? workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday) : [], [data.workers, data.weeklyPayments, openWednesday])

  useEffect(() => {
    if (!openWednesday) return
    const next: Record<string, string> = {}
    workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday).forEach((worker) => {
      const historical = data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)
      next[worker.id] = String(historical?.amount ?? worker.default_weekly_amount)
    })
    setAmounts(next)
  }, [data.workers, data.weeklyPayments, openWednesday])

  function toggleWednesday(date: string) {
    setAddingForDate('')
    setOpenWednesday((current) => current === date ? '' : date)
  }
  async function saveAll(date: string) {
    const workers = workersForPaymentDate(data.workers, data.weeklyPayments, date)
    const rows = workers.map((worker) => ({ worker_id: worker.id, week_start: date, amount: asNumber(amounts[worker.id]) }))
    const { error } = await supabase.from('weekly_payments').upsert(rows, { onConflict: 'worker_id,week_start' })
    setMessage(error ? error.message : `Payments for ${friendlyDate(date)} were saved.`)
    if (!error) await refresh()
  }
  async function saveWorker(date: string, worker: Worker) {
    const { error } = await supabase.from('weekly_payments').upsert({ worker_id: worker.id, week_start: date, amount: asNumber(amounts[worker.id]) }, { onConflict: 'worker_id,week_start' })
    setMessage(error ? error.message : `${worker.name}’s payment was saved.`)
    if (!error) await refresh()
  }
  async function addWorkerToWednesday(event: FormEvent) {
    event.preventDefault()
    if (!addingForDate) return
    const { data: worker, error: workerError } = await supabase.from('workers').insert({ name: quickWorkerName.trim(), default_weekly_amount: asNumber(quickWorkerAmount), active: true }).select('id').single()
    if (workerError || !worker) { setMessage(workerError?.message ?? 'Could not add worker.'); return }
    const { error: paymentError } = await supabase.from('weekly_payments').upsert({ worker_id: worker.id, week_start: addingForDate, amount: asNumber(quickWorkerAmount) }, { onConflict: 'worker_id,week_start' })
    setMessage(paymentError ? paymentError.message : `${quickWorkerName} was added and paid for ${friendlyDate(addingForDate)}.`)
    if (!paymentError) { setQuickWorkerName(''); setQuickWorkerAmount(''); setAddingForDate(''); await refresh() }
  }
  async function saveWorkerProfile(event: FormEvent) {
    event.preventDefault()
    const payload = { name: workerName.trim(), default_weekly_amount: asNumber(workerAmount), active: editing?.active ?? true }
    const request = editing ? supabase.from('workers').update(payload).eq('id', editing.id) : supabase.from('workers').insert(payload)
    const { error } = await request
    setMessage(error ? error.message : editing ? 'Worker updated.' : 'Worker added. Choose a Wednesday to record the first payment.')
    if (!error) { setWorkerName(''); setWorkerAmount(''); setEditing(null); await refresh() }
  }
  async function toggleWorker(worker: Worker) { const { error } = await supabase.from('workers').update({ active: !worker.active }).eq('id', worker.id); setMessage(error ? error.message : `${worker.name} marked ${worker.active ? 'inactive' : 'active'}.`); if (!error) await refresh() }
  async function deleteWorker() { if (!deleting) return; const { error } = await supabase.from('workers').delete().eq('id', deleting.id); setMessage(error ? 'This worker has payment history. Mark them inactive instead.' : 'Worker deleted.'); setDeleting(null); if (!error) await refresh() }
  const paidThisYear = yearlyLabourTotal(data.weeklyPayments, year)

  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Payments</p><h1 className="mt-1 text-3xl font-extrabold">Labour payments</h1><p className="mt-1 text-stone-600">Open a month, then the Wednesday you paid. Saved payments are permanent historical records.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-2"><div className="card"><p className="text-sm font-bold text-stone-600">Labour paid in {year}</p><p className="mt-1 text-3xl font-extrabold">{money(paidThisYear)}</p><p className="mt-1 text-sm text-stone-500">Only saved Wednesday payments are included.</p></div><div className="card"><p className="text-sm font-bold text-stone-600">How it works</p><p className="mt-1 text-base font-semibold">Monthly total → Wednesday → workers and amounts → Save</p><p className="mt-1 text-sm text-stone-500">Default amounts are only suggestions until you save that Wednesday.</p></div></section>
    <section className="space-y-3">{allMonths.map(({ monthIndex, dates }) => {
      const isOpen = openMonth === monthIndex
      const monthTotal = monthlyLabourTotal(data.weeklyPayments, year, monthIndex)
      return <div className="card p-0" key={monthIndex}><button className="flex min-h-17 w-full items-center justify-between gap-3 px-4 text-left sm:px-5" onClick={() => { setOpenMonth(isOpen ? -1 : monthIndex); setOpenWednesday(''); setAddingForDate('') }} aria-expanded={isOpen}><span><span className="block text-xl font-extrabold text-stone-900">{monthName(monthIndex)}</span><span className="mt-1 block text-sm font-semibold text-stone-500">{dates.length} Wednesdays</span></span><span className="text-right"><span className="block text-sm font-bold text-stone-500">Paid this month</span><span className="block text-xl font-extrabold text-leaf-700">{money(monthTotal)}</span></span><span className="text-2xl text-stone-400">{isOpen ? '−' : '+'}</span></button>
        {isOpen && <div className="border-t border-stone-200 p-3 sm:p-5"><div className="space-y-3">{dates.map((date) => <WednesdayCard key={date} date={date} workers={data.workers} payments={data.weeklyPayments} open={openWednesday === date} amounts={amounts} setAmounts={setAmounts} onToggle={() => toggleWednesday(date)} onSaveAll={() => void saveAll(date)} onSaveWorker={(worker) => void saveWorker(date, worker)} adding={addingForDate === date} onStartAdding={() => { setAddingForDate(date); setQuickWorkerName(''); setQuickWorkerAmount('') }} onCancelAdding={() => setAddingForDate('')} quickName={quickWorkerName} quickAmount={quickWorkerAmount} setQuickName={setQuickWorkerName} setQuickAmount={setQuickWorkerAmount} onAddWorker={addWorkerToWednesday} />)}</div></div>}
      </div>
    })}</section>
    <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form className="card space-y-3" onSubmit={saveWorkerProfile}><h2 className="text-xl font-extrabold">{editing ? `Edit ${editing.name}` : 'Add a worker'}</h2><p className="text-sm text-stone-600">Add a worker here, or directly inside a Wednesday payment.</p><label className="label">Worker name<input className="field" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required /></label><label className="label">Default weekly amount (₹)<input className="field" inputMode="decimal" value={workerAmount} onChange={(event) => setWorkerAmount(event.target.value)} required /></label><div className="flex flex-wrap gap-3"><button className="button-primary">{editing ? 'Save changes' : 'Add worker'}</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setWorkerName(''); setWorkerAmount('') }}>Cancel</button>}</div></form>
      <div className="card"><h2 className="text-xl font-extrabold">Manage workers</h2><div className="table-wrap mt-3"><table className="data-table"><thead><tr><th>Name</th><th>Status</th><th>Default / week</th><th>Actions</th></tr></thead><tbody>{data.workers.map((worker) => <tr key={worker.id}><td className="font-bold">{worker.name}</td><td><button className="rounded-lg bg-stone-100 px-3 py-1.5 font-bold" onClick={() => void toggleWorker(worker)}>{worker.active ? 'Active' : 'Inactive'}</button></td><td>{money(Number(worker.default_weekly_amount))}</td><td><div className="flex gap-2"><button className="font-bold text-leaf-700 underline" onClick={() => { setEditing(worker); setWorkerName(worker.name); setWorkerAmount(String(worker.default_weekly_amount)) }}>Edit</button><button className="font-bold text-red-700 underline" onClick={() => setDeleting(worker)}>Delete</button></div></td></tr>)}</tbody></table></div></div></section>
    <ConfirmDialog open={!!deleting} title="Delete worker?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteWorker()}>This cannot be undone. If the worker has payment history, mark them inactive instead so past monthly and yearly totals remain correct.</ConfirmDialog>
  </div>
}

function WednesdayCard({ date, workers, payments, open, amounts, setAmounts, onToggle, onSaveAll, onSaveWorker, adding, onStartAdding, onCancelAdding, quickName, quickAmount, setQuickName, setQuickAmount, onAddWorker }: { date: string; workers: Worker[]; payments: EstateData['weeklyPayments']; open: boolean; amounts: Record<string, string>; setAmounts: Dispatch<SetStateAction<Record<string, string>>>; onToggle: () => void; onSaveAll: () => void; onSaveWorker: (worker: Worker) => void; adding: boolean; onStartAdding: () => void; onCancelAdding: () => void; quickName: string; quickAmount: string; setQuickName: (value: string) => void; setQuickAmount: (value: string) => void; onAddWorker: (event: FormEvent) => void }) {
  const paymentWorkers = workersForPaymentDate(workers, payments, date)
  const savedTotal = recordedPaymentTotal(payments, date)
  const suggestedTotal = weeklyTotal(workers, payments, date)
  const hasSaved = payments.some((payment) => payment.week_start === date)
  return <div className="overflow-hidden rounded-xl border border-stone-200"><button className="flex min-h-15 w-full items-center justify-between gap-3 bg-stone-50 px-4 text-left" onClick={onToggle} aria-expanded={open}><span><span className="block text-base font-extrabold text-stone-900">{friendlyDate(date)}</span><span className="block text-sm text-stone-500">{hasSaved ? `Saved: ${money(savedTotal)}` : `Suggested: ${money(suggestedTotal)}`}</span></span><span className="text-xl text-stone-400">{open ? '−' : '+'}</span></button>
    {open && <div className="space-y-3 p-3 sm:p-4">{paymentWorkers.length ? paymentWorkers.map((worker) => <div className="flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:items-center" key={worker.id}><span className="min-w-42 font-extrabold">{worker.name}</span><label className="flex flex-1 items-center gap-2 text-sm font-bold text-stone-600">Amount ₹<input className="field mt-0 max-w-45" inputMode="decimal" value={amounts[worker.id] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [worker.id]: event.target.value }))} /></label><button className="button-secondary" onClick={() => onSaveWorker(worker)}>Save</button></div>) : <p className="rounded-xl bg-amber-50 p-3 text-amber-900">No workers are active for this date. Add one below.</p>}
      <div className="flex flex-col gap-3 border-t border-stone-200 pt-3 sm:flex-row sm:items-center"><button className="button-primary" onClick={onSaveAll} disabled={!paymentWorkers.length}>Save all payments</button><button className="button-secondary" onClick={onStartAdding}>Add worker for this Wednesday</button><span className="text-sm font-bold text-stone-600">{hasSaved ? `Saved total: ${money(savedTotal)}` : `To save: ${money(suggestedTotal)}`}</span></div>
      {adding && <form className="rounded-xl bg-coffee-50 p-4" onSubmit={onAddWorker}><h3 className="font-extrabold">Add worker and payment</h3><p className="mt-1 text-sm text-stone-600">This amount is saved for this Wednesday and used as the person’s future weekly default.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="label">Worker name<input className="field" value={quickName} onChange={(event) => setQuickName(event.target.value)} required /></label><label className="label">Amount (₹)<input className="field" inputMode="decimal" value={quickAmount} onChange={(event) => setQuickAmount(event.target.value)} required /></label></div><div className="mt-3 flex gap-3"><button className="button-primary">Add and save payment</button><button type="button" className="button-secondary" onClick={onCancelAdding}>Cancel</button></div></form>}
    </div>}
  </div>
}
