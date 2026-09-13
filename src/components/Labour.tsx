import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { money, monthlyLabourTotal, recordedPaymentTotal, wednesdaysInMonth, workersForPaymentDate, yearlyLabourTotal } from '../lib/calculations'
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
  const [repayments, setRepayments] = useState<Record<string, string>>({})
  const [resettingWeek, setResettingWeek] = useState('')
  const [lastSavedWeek, setLastSavedWeek] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [workerAmount, setWorkerAmount] = useState('')
  const [workerActive, setWorkerActive] = useState(true)
  const [editing, setEditing] = useState<Worker | null>(null)
  const [deleting, setDeleting] = useState<Worker | null>(null)
  const [loanForm, setLoanForm] = useState(emptyLoan)
  const [deletingLoan, setDeletingLoan] = useState<WorkerLoan | null>(null)
  const [message, setMessage] = useState('')

  const allMonths = useMemo(() => Array.from({ length: 12 }, (_, monthIndex) => ({ monthIndex, dates: wednesdaysInMonth(year, monthIndex) })), [year])
  const workerLoanBalances = useMemo(() => data.workers.map((worker) => ({
    worker,
    balance: data.workerLoans.filter((loan) => loan.worker_id === worker.id).reduce((total, loan) => total + (loan.kind === 'advance' ? Number(loan.amount) : -Number(loan.amount)), 0)
  })), [data.workers, data.workerLoans])
  const loanBalances = workerLoanBalances.filter((item) => item.balance !== 0)
  const outstandingLoanByWorker = Object.fromEntries(workerLoanBalances.filter((item) => item.balance > 0).map(({ worker, balance }) => [worker.id, balance]))
  const recordedRepaymentsByWeek = useMemo(() => data.workerLoans.filter((loan) => loan.kind === 'repayment').reduce<Record<string, number>>((totals, loan) => {
    const key = `${loan.loan_date}:${loan.worker_id}`
    totals[key] = (totals[key] ?? 0) + Number(loan.amount)
    return totals
  }, {}), [data.workerLoans])
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
    const repaymentRows = workers.map((worker) => {
      const amount = Math.min(asNumber(repayments[`${date}:${worker.id}`]), outstandingLoanByWorker[worker.id] ?? 0)
      return amount > 0 ? { worker_id: worker.id, loan_date: date, amount, kind: 'repayment' as const, notes: 'Repayment recorded with weekly payment' } : null
    }).filter((row): row is { worker_id: string; loan_date: string; amount: number; kind: 'repayment'; notes: string } => row !== null)
    const { error: paymentError } = await supabase.from('weekly_payments').upsert(rows, { onConflict: 'worker_id,week_start' })
    if (paymentError) { setMessage(paymentError.message); return }
    if (repaymentRows.length) {
      const { error: loanError } = await supabase.from('worker_loans').insert(repaymentRows)
      if (loanError) { setMessage(`Weekly payments were saved, but loan repayments need to be recorded again: ${loanError.message}`); return }
    }
    setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${date}:`))))
    setLastSavedWeek(date)
    setMessage(`Weekly payments for ${friendlyDate(date)} updated${repaymentRows.length ? ` with ${repaymentRows.length} loan repayment${repaymentRows.length === 1 ? '' : 's'}.` : '.'}`)
    await refresh()
  }

  async function resetWeek(date: string) {
    setResettingWeek('')
    const [loanResult, paymentResult] = await Promise.all([
      supabase.from('worker_loans').delete().eq('loan_date', date).eq('kind', 'repayment').eq('notes', 'Repayment recorded with weekly payment'),
      supabase.from('weekly_payments').delete().eq('week_start', date)
    ])
    if (loanResult.error || paymentResult.error) {
      setMessage(`Could not fully reset ${friendlyDate(date)}. ${loanResult.error?.message ?? paymentResult.error?.message ?? ''}`)
      return
    }
    const workers = workersForPaymentDate(data.workers, data.weeklyPayments, date)
    setAmounts((current) => ({ ...current, ...Object.fromEntries(workers.map((worker) => [worker.id, String(worker.default_weekly_amount)])) }))
    setRemoved((current) => ({ ...current, ...Object.fromEntries(workers.map((worker) => [worker.id, false])) }))
    setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${date}:`))))
    setLastSavedWeek('')
    setMessage(`Saved labour for ${friendlyDate(date)} was reset to ₹0 and its weekly loan repayments were undone.`)
    await refresh()
  }

  async function saveWorkerProfile(event: FormEvent) {
    event.preventDefault()
    const payload = { name: workerName.trim(), default_weekly_amount: asNumber(workerAmount), active: workerActive }
    const request = editing ? supabase.from('workers').update(payload).eq('id', editing.id) : supabase.from('workers').insert(payload)
    const { error } = await request
    setMessage(error ? error.message : editing ? 'Worker updated.' : 'Worker added to every month and week with this default amount.')
    if (!error) { setWorkerName(''); setWorkerAmount(''); setWorkerActive(true); setEditing(null); await refresh() }
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
  const startEditing = (worker: Worker) => { setEditing(worker); setWorkerName(worker.name); setWorkerAmount(String(worker.default_weekly_amount)); setWorkerActive(worker.active) }

  return <div className="page space-y-5">
    <header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Payments</p><h1 className="mt-1 text-3xl font-extrabold">Labour payments</h1><p className="mt-1 text-stone-600">Choose a month and Wednesday to update the full team’s payment record.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3"><SummaryCard label={`Labour cost in ${year}`} value={money(paidThisYear)} detail="Included automatically in total estate expenses." tone="labour" /><SummaryCard label="Outstanding worker loans" value={money(totalLoanBalance)} detail="Advances less recorded repayments." tone="expense" /><SummaryCard label="Weekly payment flow" value="Set amounts → remove anyone not paid → save once" detail="New active workers appear in all months and weeks." tone="production" compact wide /></section>
    <section className="space-y-3">{allMonths.map(({ monthIndex, dates }) => {
      const isOpen = openMonth === monthIndex
      const monthTotal = monthlyLabourTotal(data.weeklyPayments, year, monthIndex)
      return <div className="card overflow-hidden p-0" key={monthIndex}><button className="flex min-h-17 w-full items-center gap-3 px-4 text-left sm:px-5" onClick={() => { setOpenMonth(isOpen ? -1 : monthIndex); setOpenWednesday('') }} aria-expanded={isOpen}><span className="min-w-0 flex-1"><span className="block text-xl font-extrabold text-stone-900">{monthName(monthIndex)}</span><span className="mt-1 block text-sm font-semibold text-stone-500">{dates.length} Wednesdays</span></span><span className="shrink-0 text-right"><span className="block text-sm font-bold text-stone-500">Labour cost</span><span className="block text-xl font-extrabold text-leaf-700">{money(monthTotal)}</span></span><span className="shrink-0 text-2xl text-stone-400">{isOpen ? '−' : '+'}</span></button>{isOpen && <div className="border-t border-stone-200 p-3 sm:p-5"><div className="space-y-3">{dates.map((date) => <WednesdayCard key={date} date={date} workers={data.workers} payments={data.weeklyPayments} open={openWednesday === date} amounts={amounts} removed={removed} setAmounts={setAmounts} setRemoved={setRemoved} onToggle={() => setOpenWednesday((current) => current === date ? '' : date)} onSaveAll={() => void saveAll(date)} onReset={() => setResettingWeek(date)} onDraftChange={() => setLastSavedWeek('')} loanBalances={outstandingLoanByWorker} recordedRepayments={recordedRepaymentsByWeek} repayments={repayments} setRepayments={setRepayments} saved={lastSavedWeek === date} />)}</div></div>}</div>
    })}</section>
    <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form className="card space-y-3" onSubmit={saveLoan}><h2 className="text-xl font-extrabold">Worker loan / advance</h2><p className="text-sm text-stone-600">Record an advance given to a worker or a repayment received. The balance stays visible above.</p><label className="label">Worker<select className="field" value={loanForm.worker_id} onChange={(event) => setLoanForm({ ...loanForm, worker_id: event.target.value })} required><option value="">Choose a worker</option>{data.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}{worker.active ? '' : ' (inactive)'}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="label">Date<input className="field" type="date" value={loanForm.loan_date} onChange={(event) => setLoanForm({ ...loanForm, loan_date: event.target.value })} required /></label><label className="label">Type<select className="field" value={loanForm.kind} onChange={(event) => setLoanForm({ ...loanForm, kind: event.target.value as 'advance' | 'repayment' })}><option value="advance">Loan / advance given</option><option value="repayment">Repayment received</option></select></label></div><label className="label">Amount (₹)<input className="field" inputMode="decimal" min="1" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: event.target.value })} required /></label><label className="label">Notes (optional)<input className="field" value={loanForm.notes} onChange={(event) => setLoanForm({ ...loanForm, notes: event.target.value })} placeholder="e.g. Festival advance" /></label><button className="button-primary">Record {loanForm.kind === 'advance' ? 'advance' : 'repayment'}</button></form>
      <div className="card"><h2 className="text-xl font-extrabold">Worker loan balances</h2><div className="mt-3 space-y-2 sm:hidden">{loanBalances.length ? loanBalances.map(({ worker, balance }) => <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 p-3" key={worker.id}><span className="min-w-0 truncate font-bold">{worker.name}</span><span className={balance < 0 ? 'shrink-0 font-bold text-leaf-700' : 'shrink-0 font-bold text-red-700'}>{balance < 0 ? `Credit ${money(Math.abs(balance))}` : money(balance)}</span></div>) : <EmptyRecord>No outstanding worker loans.</EmptyRecord>}</div><div className="table-wrap mt-3 hidden sm:block"><table className="data-table"><thead><tr><th>Worker</th><th>Outstanding</th></tr></thead><tbody>{loanBalances.length ? loanBalances.map(({ worker, balance }) => <tr key={worker.id}><td className="font-bold">{worker.name}</td><td className={balance < 0 ? 'font-bold text-leaf-700' : 'font-bold text-red-700'}>{balance < 0 ? `Credit ${money(Math.abs(balance))}` : money(balance)}</td></tr>) : <tr><td colSpan={2} className="text-stone-500">No outstanding worker loans.</td></tr>}</tbody></table></div><h3 className="mt-6 text-lg font-extrabold">Loan history</h3><div className="mt-3 space-y-2 sm:hidden">{data.workerLoans.length ? data.workerLoans.map((loan) => <div className="rounded-xl border border-stone-200 p-3" key={loan.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-extrabold">{data.workers.find((worker) => worker.id === loan.worker_id)?.name ?? 'Deleted worker'}</p><p className="mt-1 text-sm text-stone-500">{loan.loan_date} · {loan.kind === 'advance' ? 'Advance' : 'Repayment'}</p></div><p className="shrink-0 font-extrabold">{money(Number(loan.amount))}</p></div>{loan.notes && <p className="mt-2 break-words text-sm text-stone-600">{loan.notes}</p>}<button type="button" className="mt-3 font-bold text-red-700 underline" onClick={() => setDeletingLoan(loan)}>Delete record</button></div>) : <EmptyRecord>No worker loan records.</EmptyRecord>}</div><div className="table-wrap mt-3 hidden sm:block"><table className="data-table"><thead><tr><th>Date</th><th>Worker</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr></thead><tbody>{data.workerLoans.length ? data.workerLoans.map((loan) => <tr key={loan.id}><td>{loan.loan_date}</td><td className="font-bold">{data.workers.find((worker) => worker.id === loan.worker_id)?.name ?? 'Deleted worker'}</td><td>{loan.kind === 'advance' ? 'Advance' : 'Repayment'}</td><td className="font-bold">{money(Number(loan.amount))}</td><td>{loan.notes || '—'}</td><td><button type="button" className="font-bold text-red-700 underline" onClick={() => setDeletingLoan(loan)}>Delete</button></td></tr>) : <tr><td colSpan={6} className="text-stone-500">No worker loan records.</td></tr>}</tbody></table></div></div></section>
    <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form className="card space-y-3" onSubmit={saveWorkerProfile}><h2 className="text-xl font-extrabold">{editing ? `Edit ${editing.name}` : 'Add a worker'}</h2><p className="text-sm text-stone-600">{editing ? 'Change the worker details and status, then update once.' : 'Their default payment will be available in every month and week.'}</p><label className="label">Worker name<input className="field" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required /></label><label className="label">Default weekly amount (₹)<input className="field" inputMode="decimal" value={workerAmount} onChange={(event) => setWorkerAmount(event.target.value)} required /></label>{editing && <label className="label">Status<select className="field" value={workerActive ? 'active' : 'inactive'} onChange={(event) => setWorkerActive(event.target.value === 'active')}><option value="active">Active — shown in all weeks</option><option value="inactive">Inactive — hidden from new weeks</option></select></label>}<div className="flex flex-wrap gap-3"><button className="button-primary">{editing ? 'Update worker' : 'Add worker'}</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setWorkerName(''); setWorkerAmount(''); setWorkerActive(true) }}>Cancel</button>}</div></form>
      <div className="card"><h2 className="text-xl font-extrabold">Manage workers</h2><p className="mt-1 text-sm text-stone-600">Choose Edit to change a worker’s name, default payment, or active status.</p><div className="mt-3 space-y-2 sm:hidden">{data.workers.length ? data.workers.map((worker) => <div className="rounded-xl border border-stone-200 p-3" key={worker.id}><div className="flex items-start justify-between gap-3"><p className="min-w-0 truncate font-extrabold">{worker.name}</p><span className={`worker-status shrink-0 ${worker.active ? 'is-active' : 'is-inactive'}`}>{worker.active ? 'Active' : 'Inactive'}</span></div><p className="mt-2 text-sm text-stone-600">Default weekly amount <strong className="text-stone-900">{money(Number(worker.default_weekly_amount))}</strong></p><div className="mt-3 flex gap-4"><button type="button" className="font-bold text-leaf-700 underline transition hover:text-leaf-600" onClick={() => startEditing(worker)}>Edit</button><button type="button" className="font-bold text-red-700 underline transition hover:text-red-800" onClick={() => setDeleting(worker)}>Delete</button></div></div>) : <EmptyRecord>No workers added yet.</EmptyRecord>}</div><div className="table-wrap mt-3 hidden sm:block"><table className="data-table"><thead><tr><th>Name</th><th>Status</th><th>Default / week</th><th>Actions</th></tr></thead><tbody>{data.workers.map((worker) => <tr key={worker.id}><td className="font-bold">{worker.name}</td><td><span className={`worker-status ${worker.active ? 'is-active' : 'is-inactive'}`}>{worker.active ? 'Active' : 'Inactive'}</span></td><td>{money(Number(worker.default_weekly_amount))}</td><td><div className="flex gap-3"><button type="button" className="font-bold text-leaf-700 underline transition hover:text-leaf-600" onClick={() => startEditing(worker)}>Edit</button><button type="button" className="font-bold text-red-700 underline transition hover:text-red-800" onClick={() => setDeleting(worker)}>Delete</button></div></td></tr>)}</tbody></table></div></div></section>
    <ConfirmDialog open={!!resettingWeek} title="Reset all payments for this week?" onCancel={() => setResettingWeek('')} onConfirm={() => void resetWeek(resettingWeek)} confirmLabel="Reset payments" confirmVariant="danger">This immediately resets saved labour to ₹0 and removes loan repayments recorded with this weekly payment. You will not need to save again.</ConfirmDialog>
    <ConfirmDialog open={!!deleting} title="Delete worker?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteWorker()}>This permanently deletes the worker, weekly payments, and loan records.</ConfirmDialog>
    <ConfirmDialog open={!!deletingLoan} title="Delete loan record?" onCancel={() => setDeletingLoan(null)} onConfirm={() => void deleteLoan()}>This changes the worker’s outstanding loan balance.</ConfirmDialog>
  </div>
}

function SummaryCard({ label, value, detail, tone, compact = false, wide = false }: { label: string; value: string; detail: string; tone: string; compact?: boolean; wide?: boolean }) { return <div className={`summary-tile tone-${tone} ${wide ? 'col-span-2 sm:col-span-1' : ''}`}><p className="tile-label">{label}</p><p className={compact ? 'mt-1 text-base font-semibold' : 'mt-2 text-3xl font-extrabold'}>{value}</p><p className="mt-1 text-sm font-medium opacity-75">{detail}</p></div> }
function EmptyRecord({ children }: { children: string }) { return <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">{children}</p> }

function WednesdayCard({ date, workers, payments, open, amounts, removed, setAmounts, setRemoved, onToggle, onSaveAll, onReset, onDraftChange, loanBalances, recordedRepayments, repayments, setRepayments, saved }: { date: string; workers: Worker[]; payments: EstateData['weeklyPayments']; open: boolean; amounts: Record<string, string>; removed: Record<string, boolean>; setAmounts: React.Dispatch<React.SetStateAction<Record<string, string>>>; setRemoved: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; onToggle: () => void; onSaveAll: () => void; onReset: () => void; onDraftChange: () => void; loanBalances: Record<string, number>; recordedRepayments: Record<string, number>; repayments: Record<string, string>; setRepayments: React.Dispatch<React.SetStateAction<Record<string, string>>>; saved: boolean }) {
  const paymentWorkers = workersForPaymentDate(workers, payments, date)
  const total = paymentWorkers.reduce((sum, worker) => sum + (removed[worker.id] ? 0 : asNumber(amounts[worker.id])), 0)
  const recordedTotal = recordedPaymentTotal(payments, date)
  const hasSavedPayment = payments.some((payment) => payment.week_start === date)
  return <div className="overflow-hidden rounded-xl border border-stone-200"><button className="flex min-h-15 w-full items-center justify-between gap-3 bg-stone-50 px-4 text-left" onClick={onToggle} aria-expanded={open}><span className="min-w-0"><span className="block text-base font-extrabold text-stone-900">{friendlyDate(date)}</span><span className="block text-sm text-stone-500">Labour cost: {money(recordedTotal)}</span></span><span className="shrink-0 text-xl text-stone-400">{open ? '−' : '+'}</span></button>{open && <div className="space-y-3 p-3 sm:p-4">{paymentWorkers.length ? paymentWorkers.map((worker) => { const loanBalance = loanBalances[worker.id] ?? 0; const repaymentKey = `${date}:${worker.id}`; return <div className={`flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:flex-wrap sm:items-center ${removed[worker.id] ? 'bg-stone-50 opacity-70' : ''}`} key={worker.id}><span className="min-w-0 font-extrabold sm:basis-36">{worker.name}</span><label className="flex min-w-42 flex-1 items-center gap-2 text-sm font-bold text-stone-600">Amount ₹<input className="field mt-0 max-w-40" inputMode="decimal" disabled={removed[worker.id]} value={amounts[worker.id] ?? ''} onChange={(event) => { onDraftChange(); setAmounts((current) => ({ ...current, [worker.id]: event.target.value })) }} /></label>{(() => { const recordedRepayment = recordedRepayments[repaymentKey] ?? 0; const repaymentLimit = loanBalance + recordedRepayment; return (loanBalance > 0 || recordedRepayment > 0) && <label className="flex min-w-48 flex-1 items-center gap-2 text-sm font-bold text-stone-600">Loan repayment ₹<input className="field mt-0 max-w-32" inputMode="decimal" min="0" max={repaymentLimit} readOnly={recordedRepayment > 0} aria-label={`Loan repayment for ${worker.name}`} title={recordedRepayment > 0 ? 'Recorded with this weekly payment' : undefined} placeholder={`Up to ${money(repaymentLimit)}`} value={recordedRepayment > 0 ? String(recordedRepayment) : repayments[repaymentKey] ?? ''} onChange={(event) => { onDraftChange(); setRepayments((current) => ({ ...current, [repaymentKey]: event.target.value })) }} /></label> })()}<button type="button" className="button-secondary shrink-0" onClick={() => { onDraftChange(); setRemoved((current) => ({ ...current, [worker.id]: !current[worker.id] })) }}>{removed[worker.id] ? 'Restore this week' : 'Remove this week'}</button></div> }) : <p className="rounded-xl bg-amber-50 p-3 text-amber-900">No active workers. Add a worker below.</p>}<div className="flex flex-col gap-3 border-t border-stone-200 pt-3 sm:flex-row sm:flex-wrap sm:items-center"><button type="button" className="button-primary" onClick={onSaveAll} disabled={!paymentWorkers.length}>Save all payments</button><button type="button" className="button-secondary" onClick={onReset} disabled={!paymentWorkers.length}>Reset all payments</button>{saved && <span className="save-confirmation" role="status">✓ Saved</span>}<span className="text-sm font-bold text-stone-600">{hasSavedPayment ? `Saved labour cost: ${money(recordedTotal)}` : `Unsaved draft total: ${money(total)}`}</span></div></div>}</div>
}
