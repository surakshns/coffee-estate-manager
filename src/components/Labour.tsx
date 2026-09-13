import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { money, monthlyLabourTotal, recordedPaymentTotal, weeklyTotal, wednesdaysInMonth, workersForPaymentDate, yearlyLabourTotal } from '../lib/calculations'
import { supabase } from '../lib/supabase'
import type { EstateData, Worker, WorkerLoan } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

const asNumber = (value: string) => Number(value || 0)
const monthName = (monthIndex: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, monthIndex, 1))
const friendlyDate = (date: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const today = () => new Date().toISOString().slice(0, 10)
type LoanForm = { worker_id: string; loan_date: string; amount: string; kind: 'advance' | 'repayment'; notes: string }
const emptyLoan = (): LoanForm => ({ worker_id: '', loan_date: today(), amount: '', kind: 'advance', notes: '' })

export function Labour({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [openMonth, setOpenMonth] = useState(new Date().getMonth())
  const [openWednesday, setOpenWednesday] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Record<string, boolean>>({})
  const [workerName, setWorkerName] = useState('')
  const [workerAmount, setWorkerAmount] = useState('')
  const [editing, setEditing] = useState<Worker | null>(null)
  const [deleting, setDeleting] = useState<Worker | null>(null)
  const [loanForm, setLoanForm] = useState(emptyLoan)
  const [deletingLoan, setDeletingLoan] = useState<WorkerLoan | null>(null)
  const [message, setMessage] = useState('')
  const allMonths = useMemo(() => Array.from({ length: 12 }, (_, monthIndex) => ({ monthIndex, dates: wednesdaysInMonth(year, monthIndex) })), [year])
  const loanBalances = useMemo(() => data.workers.map((worker) => ({
    worker,
    balance: data.workerLoans.filter((loan) => loan.worker_id === worker.id).reduce((total, loan) => total + (loan.kind === 'advance' ? Number(loan.amount) : -Number(loan.amount)), 0)
  })).filter((item) => item.balance !== 0), [data.workers, data.workerLoans])
  const totalLoanBalance = loanBalances.reduce((total, item) => total + item.balance, 0)

  useEffect(() => {
    if (!openWednesday) return
    const nextAmounts: Record<string, string> = {}
    const nextRemoved: Record<string, boolean> = {}
    workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday).forEach((worker) => {
      const historical = data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)
      nextAmounts[worker.id] = String(historical?.amount ?? worker.default_weekly_amount)
      nextRemoved[worker.id] = Boolean(historical?.excluded)
    })
    setAmounts(nextAmounts)
    setRemoved(nextRemoved)
  }, [data.workers, data.weeklyPayments, openWednesday])

  async function saveAll(date: string) {
    const workers = workersForPaymentDate(data.workers, data.weeklyPayments, date)
    const rows = workers.map((worker) => ({ worker_id: worker.id, week_start: date, amount: removed[worker.id] ? 0 : asNumber(amounts[worker.id]), excluded: Boolean(removed[worker.id]) }))
    const { error } = await supabase.from('weekly_payments').upsert(rows, { onConflict: 'worker_id,week_start' })
    setMessage(error ? error.message : `Weekly payments for ${friendlyDate(date)} updated.`)
    if (!error) await refresh()
  }
  async function saveWorkerProfile(event: FormEvent) {
    event.preventDefault()
    const payload = { name: workerName.trim(), default_weekly_amount: asNumber(workerAmount), active: editing?.active ?? true }
    const request = editing ? supabase.from('workers').update(payload).eq('id', editing.id) : supabase.from('workers').insert(payload)
    const { error } = await request
    setMessage(error ? error.message : editing ? 'Worker updated.' : 'Worker added to every month and week with this default amount.')
    if (!error) { setWorkerName(''); setWorkerAmount(''); setEditing(null); await refresh() }
  }
  async function toggleWorker(worker: Worker) {
    const { error } = await supabase.from('workers').update({ active: !worker.active }).eq('id', worker.id)
    setMessage(error ? error.message : `${worker.name} marked ${worker.active ? 'inactive' : 'active'}.`)
    if (!error) await refresh()
  }
  async function deleteWorker() {
    if (!deleting) return
    const { error } = await supabase.from('workers').delete().eq('id', deleting.id)
    setMessage(error ? error.message : 'Worker, weekly payments, and loan records deleted.')
    setDeleting(null)
    if (!error) await refresh()
  }
  async function saveLoan(event: FormEvent) {
    event.preventDefault()
    const { error } = await supabase.from('worker_loans').insert({ ...loanForm, amount: asNumber(loanForm.amount) })
    setMessage(error ? error.message : loanForm.kind === 'advance' ? 'Worker advance recorded.' : 'Loan repayment recorded.')
    if (!error) { setLoanForm(emptyLoan()); await refresh() }
  }
  async function deleteLoan() {
    if (!deletingLoan) return
    const { error } = await supabase.from('worker_loans').delete().eq('id', deletingLoan.id)
    setMessage(error ? error.message : 'Loan record deleted.')
    setDeletingLoan(null)
    if (!error) await refresh()
  }
  const paidThisYear = yearlyLabourTotal(data.weeklyPayments, year)

  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Payments</p><h1 className="mt-1 text-3xl font-extrabold">Labour payments</h1><p className="mt-1 text-stone-600">Choose a month and Wednesday to update the full team’s payment record.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-3"><div className="card"><p className="text-sm font-bold text-stone-600">Labour cost in {year}</p><p className="mt-1 text-3xl font-extrabold">{money(paidThisYear)}</p><p className="mt-1 text-sm text-stone-500">Included automatically in total estate expenses.</p></div><div className="card"><p className="text-sm font-bold text-stone-600">Outstanding worker loans</p><p className="mt-1 text-3xl font-extrabold">{money(totalLoanBalance)}</p><p className="mt-1 text-sm text-stone-500">Advances less recorded repayments.</p></div><div className="card"><p className="text-sm font-bold text-stone-600">Weekly payment flow</p><p className="mt-1 text-base font-semibold">Set amounts → remove anyone not paid → save once</p><p className="mt-1 text-sm text-stone-500">New active workers appear in all months and weeks.</p></div></section>
    <section className="space-y-3">{allMonths.map(({ monthIndex, dates }) => {
      const isOpen = openMonth === monthIndex
      const monthTotal = monthlyLabourTotal(data.weeklyPayments, year, monthIndex)
      return <div className="card p-0" key={monthIndex}><button className="flex min-h-17 w-full items-center justify-between gap-3 px-4 text-left sm:px-5" onClick={() => { setOpenMonth(isOpen ? -1 : monthIndex); setOpenWednesday('') }} aria-expanded={isOpen}><span><span className="block text-xl font-extrabold text-stone-900">{monthName(monthIndex)}</span><span className="mt-1 block text-sm font-semibold text-stone-500">{dates.length} Wednesdays</span></span><span className="text-right"><span className="block text-sm font-bold text-stone-500">Labour cost</span><span className="block text-xl font-extrabold text-leaf-700">{money(monthTotal)}</span></span><span className="text-2xl text-stone-400">{isOpen ? '−' : '+'}</span></button>
        {isOpen && <div className="border-t border-stone-200 p-3 sm:p-5"><div className="space-y-3">{dates.map((date) => <WednesdayCard key={date} date={date} workers={data.workers} payments={data.weeklyPayments} open={openWednesday === date} amounts={amounts} removed={removed} setAmounts={setAmounts} setRemoved={setRemoved} onToggle={() => setOpenWednesday((current) => current === date ? '' : date)} onSaveAll={() => void saveAll(date)} />)}</div></div>}
      </div>
    })}</section>
    <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form className="card space-y-3" onSubmit={saveWorkerProfile}><h2 className="text-xl font-extrabold">{editing ? `Edit ${editing.name}` : 'Add a worker'}</h2><p className="text-sm text-stone-600">Their default payment will be available in every month and week.</p><label className="label">Worker name<input className="field" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required /></label><label className="label">Default weekly amount (₹)<input className="field" inputMode="decimal" value={workerAmount} onChange={(event) => setWorkerAmount(event.target.value)} required /></label><div className="flex flex-wrap gap-3"><button className="button-primary">{editing ? 'Update worker' : 'Add worker'}</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setWorkerName(''); setWorkerAmount('') }}>Cancel</button>}</div></form>
      <div className="card"><h2 className="text-xl font-extrabold">Manage workers</h2><div className="table-wrap mt-3"><table className="data-table"><thead><tr><th>Name</th><th>Status</th><th>Default / week</th><th>Actions</th></tr></thead><tbody>{data.workers.map((worker) => <tr key={worker.id}><td className="font-bold">{worker.name}</td><td><button className="rounded-lg bg-stone-100 px-3 py-1.5 font-bold" onClick={() => void toggleWorker(worker)}>{worker.active ? 'Active' : 'Inactive'}</button></td><td>{money(Number(worker.default_weekly_amount))}</td><td><div className="flex gap-2"><button className="font-bold text-leaf-700 underline" onClick={() => { setEditing(worker); setWorkerName(worker.name); setWorkerAmount(String(worker.default_weekly_amount)) }}>Edit</button><button className="font-bold text-red-700 underline" onClick={() => setDeleting(worker)}>Delete</button></div></td></tr>)}</tbody></table></div></div></section>
    <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form className="card space-y-3" onSubmit={saveLoan}><h2 className="text-xl font-extrabold">Worker loan / advance</h2><p className="text-sm text-stone-600">Record an advance given to a worker or a repayment received. The balance stays visible above.</p><label className="label">Worker<select className="field" value={loanForm.worker_id} onChange={(event) => setLoanForm({ ...loanForm, worker_id: event.target.value })} required><option value="">Choose a worker</option>{data.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}{worker.active ? '' : ' (inactive)'}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="label">Date<input className="field" type="date" value={loanForm.loan_date} onChange={(event) => setLoanForm({ ...loanForm, loan_date: event.target.value })} required /></label><label className="label">Type<select className="field" value={loanForm.kind} onChange={(event) => setLoanForm({ ...loanForm, kind: event.target.value as 'advance' | 'repayment' })}><option value="advance">Loan / advance given</option><option value="repayment">Repayment received</option></select></label></div><label className="label">Amount (₹)<input className="field" inputMode="decimal" min="1" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: event.target.value })} required /></label><label className="label">Notes (optional)<input className="field" value={loanForm.notes} onChange={(event) => setLoanForm({ ...loanForm, notes: event.target.value })} placeholder="e.g. Festival advance" /></label><button className="button-primary">Record {loanForm.kind === 'advance' ? 'advance' : 'repayment'}</button></form>
      <div className="card"><h2 className="text-xl font-extrabold">Worker loan balances</h2><div className="table-wrap mt-3"><table className="data-table"><thead><tr><th>Worker</th><th>Outstanding</th></tr></thead><tbody>{loanBalances.length ? loanBalances.map(({ worker, balance }) => <tr key={worker.id}><td className="font-bold">{worker.name}</td><td className={balance < 0 ? 'font-bold text-leaf-700' : 'font-bold text-red-700'}>{balance < 0 ? `Credit ${money(Math.abs(balance))}` : money(balance)}</td></tr>) : <tr><td colSpan={2} className="text-stone-500">No outstanding worker loans.</td></tr>}</tbody></table></div><h3 className="mt-6 text-lg font-extrabold">Loan history</h3><div className="table-wrap mt-3"><table className="data-table"><thead><tr><th>Date</th><th>Worker</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr></thead><tbody>{data.workerLoans.length ? data.workerLoans.map((loan) => <tr key={loan.id}><td>{loan.loan_date}</td><td className="font-bold">{data.workers.find((worker) => worker.id === loan.worker_id)?.name ?? 'Deleted worker'}</td><td>{loan.kind === 'advance' ? 'Advance' : 'Repayment'}</td><td className="font-bold">{money(Number(loan.amount))}</td><td>{loan.notes || '—'}</td><td><button className="font-bold text-red-700 underline" onClick={() => setDeletingLoan(loan)}>Delete</button></td></tr>) : <tr><td colSpan={6} className="text-stone-500">No worker loan records.</td></tr>}</tbody></table></div></div></section>
    <ConfirmDialog open={!!deleting} title="Delete worker?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteWorker()}>This permanently deletes the worker, weekly payments, and loan records.</ConfirmDialog>
    <ConfirmDialog open={!!deletingLoan} title="Delete loan record?" onCancel={() => setDeletingLoan(null)} onConfirm={() => void deleteLoan()}>This changes the worker’s outstanding loan balance.</ConfirmDialog>
  </div>
}

function WednesdayCard({ date, workers, payments, open, amounts, removed, setAmounts, setRemoved, onToggle, onSaveAll }: { date: string; workers: Worker[]; payments: EstateData['weeklyPayments']; open: boolean; amounts: Record<string, string>; removed: Record<string, boolean>; setAmounts: React.Dispatch<React.SetStateAction<Record<string, string>>>; setRemoved: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; onToggle: () => void; onSaveAll: () => void }) {
  const paymentWorkers = workersForPaymentDate(workers, payments, date)
  const total = paymentWorkers.reduce((sum, worker) => sum + (removed[worker.id] ? 0 : asNumber(amounts[worker.id])), 0)
  const recordedTotal = recordedPaymentTotal(payments, date)
  const isRecorded = payments.some((payment) => payment.week_start === date)
  const suggestedTotal = weeklyTotal(workers, payments, date)
  return <div className="overflow-hidden rounded-xl border border-stone-200"><button className="flex min-h-15 w-full items-center justify-between gap-3 bg-stone-50 px-4 text-left" onClick={onToggle} aria-expanded={open}><span><span className="block text-base font-extrabold text-stone-900">{friendlyDate(date)}</span><span className="block text-sm text-stone-500">Labour cost: {money(isRecorded ? recordedTotal : suggestedTotal)}</span></span><span className="text-xl text-stone-400">{open ? '−' : '+'}</span></button>
    {open && <div className="space-y-3 p-3 sm:p-4">{paymentWorkers.length ? paymentWorkers.map((worker) => <div className={`flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:items-center ${removed[worker.id] ? 'bg-stone-50 opacity-70' : ''}`} key={worker.id}><span className="min-w-42 font-extrabold">{worker.name}</span><label className="flex flex-1 items-center gap-2 text-sm font-bold text-stone-600">Amount ₹<input className="field mt-0 max-w-45" inputMode="decimal" disabled={removed[worker.id]} value={amounts[worker.id] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [worker.id]: event.target.value }))} /></label><button className="button-secondary" onClick={() => setRemoved((current) => ({ ...current, [worker.id]: !current[worker.id] }))}>{removed[worker.id] ? 'Restore this week' : 'Remove this week'}</button></div>) : <p className="rounded-xl bg-amber-50 p-3 text-amber-900">No active workers. Add a worker below.</p>}
      <div className="flex flex-col gap-3 border-t border-stone-200 pt-3 sm:flex-row sm:items-center"><button className="button-primary" onClick={onSaveAll} disabled={!paymentWorkers.length}>Save all payments</button><span className="text-sm font-bold text-stone-600">Labour cost for this week: {money(total)}</span></div>
    </div>}
  </div>
}
