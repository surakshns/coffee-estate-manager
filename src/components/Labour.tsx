import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { money, monthlyLabourTotal, recordedPaymentTotal, wednesdaysInMonth, workersForPaymentDate, yearlyLabourTotal } from '../lib/calculations'
import { scrollToEditor } from '../lib/scroll'
import { supabase } from '../lib/supabase'
import type { EstateData, Worker, WorkerLoan } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import './labour.css'

const asNumber = (value: string | undefined) => Number(value || 0)
const monthName = (monthIndex: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, monthIndex, 1))
const friendlyDate = (date: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const shortDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const today = () => new Date().toISOString().slice(0, 10)
const preferredWednesday = (year: number, month: number) => {
  const dates = wednesdaysInMonth(year, month)
  return [...dates].reverse().find((date) => date <= today()) ?? dates[0]
}
type LoanForm = { worker_id: string; loan_date: string; amount: string; kind: 'advance' | 'repayment'; notes: string }
type View = 'payments' | 'loans' | 'workers'
type WeekSelection = { month: number; date: string }
const emptyLoan = (): LoanForm => ({ worker_id: '', loan_date: today(), amount: '', kind: 'advance', notes: '' })

export function Labour({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [view, setView] = useState<View>('payments')
  const [openMonth, setOpenMonth] = useState(new Date().getMonth())
  const [openWednesday, setOpenWednesday] = useState(() => preferredWednesday(year, new Date().getMonth()))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Record<string, boolean>>({})
  const [repayments, setRepayments] = useState<Record<string, string>>({})
  const [dirtyDraft, setDirtyDraft] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<WeekSelection | null>(null)
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
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const previousYear = useRef(year)
  const workerEditorRef = useRef<HTMLFormElement>(null)

  const dates = useMemo(() => wednesdaysInMonth(year, openMonth), [year, openMonth])
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
  const paymentWorkers = workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday)
  const draftTotal = paymentWorkers.reduce((sum, worker) => sum + (removed[worker.id] ? 0 : asNumber(amounts[worker.id])), 0)
  const includedWorkers = paymentWorkers.filter((worker) => !removed[worker.id]).length
  const hasSavedPayment = data.weeklyPayments.some((payment) => payment.week_start === openWednesday)
  const recordedTotal = recordedPaymentTotal(data.weeklyPayments, openWednesday)

  useEffect(() => {
    if (previousYear.current === year) return
    previousYear.current = year
    setOpenWednesday(preferredWednesday(year, openMonth))
    setDirtyDraft(false)
    setLastSavedWeek('')
    setMessage('')
  }, [year, openMonth])

  useEffect(() => {
    // Keep an unfinished payment sheet when team or loan data refreshes.
    if (dirtyDraft) return
    const nextAmounts: Record<string, string> = {}
    const nextRemoved: Record<string, boolean> = {}
    workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday).forEach((worker) => {
      const historical = data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)
      nextAmounts[worker.id] = String(historical?.amount ?? worker.default_weekly_amount)
      nextRemoved[worker.id] = Boolean(historical?.excluded)
    })
    setAmounts(nextAmounts)
    setRemoved(nextRemoved)
  }, [data.workers, data.weeklyPayments, openWednesday, dirtyDraft])

  useEffect(() => {
    if (!dirtyDraft) return
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirtyDraft])

  function notify(text: string, error = false) { setMessage(text); setMessageError(error) }
  function markDraft() { setDirtyDraft(true); setLastSavedWeek(''); setMessage('') }
  function applySelection(selection: WeekSelection) {
    setOpenMonth(selection.month)
    setOpenWednesday(selection.date)
    setDirtyDraft(false)
    setPendingSelection(null)
    setMessage('')
    setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${openWednesday}:`))))
  }
  function chooseWeek(selection: WeekSelection) {
    if (selection.date === openWednesday || busy) return
    if (dirtyDraft) setPendingSelection(selection)
    else applySelection(selection)
  }
  async function runAction(action: string, operation: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(action)
    setMessage('')
    try { await operation() }
    catch (error) { notify(error instanceof Error ? error.message : 'Something went wrong. Please check your connection and try again.', true) }
    finally { busyRef.current = false; setBusy('') }
  }

  async function saveAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const date = openWednesday
    const workers = workersForPaymentDate(data.workers, data.weeklyPayments, date)
    if (!workers.length) return
    const invalid = workers.find((worker) => {
      const amount = asNumber(amounts[worker.id])
      const repayment = asNumber(repayments[`${date}:${worker.id}`])
      return (!removed[worker.id] && (!Number.isFinite(amount) || amount < 0)) || !Number.isFinite(repayment) || repayment < 0 || repayment > (outstandingLoanByWorker[worker.id] ?? 0)
    })
    if (invalid) { notify(`Check the payment and loan repayment amounts for ${invalid.name}. Use a positive amount or zero, and keep repayments within the outstanding loan.`, true); return }
    await runAction('payments', async () => {
      const rows = workers.map((worker) => ({ worker_id: worker.id, week_start: date, amount: removed[worker.id] ? 0 : asNumber(amounts[worker.id]), excluded: Boolean(removed[worker.id]) }))
      const repaymentRows = workers.map((worker) => {
        const amount = Math.min(asNumber(repayments[`${date}:${worker.id}`]), outstandingLoanByWorker[worker.id] ?? 0)
        return amount > 0 ? { worker_id: worker.id, loan_date: date, amount, kind: 'repayment' as const, notes: 'Repayment recorded with weekly payment' } : null
      }).filter((row): row is { worker_id: string; loan_date: string; amount: number; kind: 'repayment'; notes: string } => row !== null)
      const { error: paymentError } = await supabase.from('weekly_payments').upsert(rows, { onConflict: 'worker_id,week_start' })
      if (paymentError) { notify(paymentError.message, true); return }
      if (repaymentRows.length) {
        const { error: loanError } = await supabase.from('worker_loans').insert(repaymentRows)
        if (loanError) { notify(`Payments saved, but loan repayments need to be recorded again: ${loanError.message}`, true); return }
      }
      setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${date}:`))))
      await refresh()
      setDirtyDraft(false)
      setLastSavedWeek(date)
      notify(`Payments saved for ${friendlyDate(date)}${repaymentRows.length ? `, including ${repaymentRows.length} loan repayment${repaymentRows.length === 1 ? '' : 's'}` : ''}.`)
    })
  }

  async function resetWeek(date: string) {
    setResettingWeek('')
    await runAction('reset', async () => {
      const [loanResult, paymentResult] = await Promise.all([
        supabase.from('worker_loans').delete().eq('loan_date', date).eq('kind', 'repayment').eq('notes', 'Repayment recorded with weekly payment'),
        supabase.from('weekly_payments').delete().eq('week_start', date)
      ])
      if (loanResult.error || paymentResult.error) { notify(`Could not fully reset ${friendlyDate(date)}. ${loanResult.error?.message ?? paymentResult.error?.message ?? ''}`, true); return }
      setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${date}:`))))
      await refresh()
      setDirtyDraft(false)
      setLastSavedWeek('')
      notify(`Saved labour for ${friendlyDate(date)} is now ₹0. Weekly loan repayments were undone. Default amounts below are an unsaved draft.`)
    })
  }

  async function saveWorkerProfile(event: FormEvent) {
    event.preventDefault()
    if (!workerName.trim()) { notify('Enter the worker’s name.', true); return }
    if (!Number.isFinite(asNumber(workerAmount)) || asNumber(workerAmount) < 0) { notify('Enter a valid weekly amount of zero or more.', true); return }
    await runAction('worker', async () => {
      const payload = { name: workerName.trim(), default_weekly_amount: asNumber(workerAmount), active: workerActive }
      const request = editing ? supabase.from('workers').update(payload).eq('id', editing.id) : supabase.from('workers').insert(payload)
      const { error } = await request
      if (error) { notify(error.message, true); return }
      notify(editing ? 'Worker details updated.' : 'Worker added. Their default amount is ready for weekly payments.')
      setWorkerName(''); setWorkerAmount(''); setWorkerActive(true); setEditing(null)
      await refresh()
    })
  }
  async function deleteWorker() {
    if (!deleting) return
    const worker = deleting
    setDeleting(null)
    await runAction('delete-worker', async () => {
      const { error } = await supabase.from('workers').delete().eq('id', worker.id)
      notify(error ? error.message : 'Worker, weekly payments, and loan records deleted.', !!error)
      if (!error) await refresh()
    })
  }
  async function saveLoan(event: FormEvent) {
    event.preventDefault()
    if (!Number.isFinite(asNumber(loanForm.amount)) || asNumber(loanForm.amount) <= 0) { notify('Enter an amount greater than zero.', true); return }
    await runAction('loan', async () => {
      const { error } = await supabase.from('worker_loans').insert({ ...loanForm, amount: asNumber(loanForm.amount) })
      notify(error ? error.message : loanForm.kind === 'advance' ? 'Worker advance recorded.' : 'Loan repayment recorded.', !!error)
      if (!error) { setLoanForm(emptyLoan()); await refresh() }
    })
  }
  async function deleteLoan() {
    if (!deletingLoan) return
    const loan = deletingLoan
    setDeletingLoan(null)
    await runAction('delete-loan', async () => {
      const { error } = await supabase.from('worker_loans').delete().eq('id', loan.id)
      notify(error ? error.message : 'Loan record deleted.', !!error)
      if (!error) await refresh()
    })
  }
  function startEditing(worker: Worker) {
    setEditing(worker); setWorkerName(worker.name); setWorkerAmount(String(worker.default_weekly_amount)); setWorkerActive(worker.active)
    scrollToEditor(workerEditorRef.current)
    workerEditorRef.current?.querySelector('input')?.focus({ preventScroll: true })
  }

  const activeCount = data.workers.filter((worker) => worker.active).length
  return <div className="page labour-page">
    <header className="labour-heading"><div><p className="labour-eyebrow">Your people, taken care of</p><h1>Labour payments</h1><p>Choose a Wednesday, check the amounts, and save.</p></div><span className="labour-team-count"><span aria-hidden="true">♧</span> {activeCount} active {activeCount === 1 ? 'worker' : 'workers'}</span></header>
    <div className="labour-summary">
      <SummaryCard label={`${monthName(openMonth)} payments`} value={money(monthlyLabourTotal(data.weeklyPayments, year, openMonth))} detail="Saved labour cost this month" />
      <SummaryCard label={`Paid in ${year}`} value={money(yearlyLabourTotal(data.weeklyPayments, year))} detail="Included in estate expenses" />
      <SummaryCard label="Worker loan balance" value={money(totalLoanBalance)} detail="Advances less repayments" />
    </div>
    <nav className="labour-views" aria-label="Labour sections">
      {([{ value: 'payments', label: 'Weekly pay', icon: '₹' }, { value: 'loans', label: 'Loans & advances', icon: '↗' }, { value: 'workers', label: 'Manage workers', icon: '♧' }] as const).map(({ value, label, icon }) => <button key={value} type="button" className={view === value ? 'is-active' : ''} aria-current={view === value ? 'page' : undefined} onClick={() => setView(value)}><span aria-hidden="true">{icon}</span>{label}{value === 'payments' && dirtyDraft && <span className="labour-draft-dot" aria-label="Unsaved changes" />}</button>)}
    </nav>
    {message && <p className={`labour-message ${messageError ? 'is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{messageError ? '' : '✓ '}{message}</p>}

    {view === 'payments' && <>
      <section className="labour-panel labour-period" aria-labelledby="labour-period-title">
        <div className="labour-section-heading"><div><p className="labour-step">Step 1</p><h2 id="labour-period-title">Choose payment week</h2></div><label className="labour-month-label">Month<select className="field" value={openMonth} disabled={!!busy} onChange={(event) => { const month = Number(event.target.value); chooseWeek({ month, date: preferredWednesday(year, month) }) }}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{monthName(month)} {year}</option>)}</select></label></div>
        <div className="labour-weeks" aria-label="Wednesday payment dates">{dates.map((date) => {
          const saved = data.weeklyPayments.some((payment) => payment.week_start === date)
          const selected = openWednesday === date
          return <button type="button" key={date} className={`labour-week ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={!!busy} onClick={() => chooseWeek({ month: openMonth, date })}><span className="labour-week-day">Wednesday</span><strong>{shortDate(date)}</strong><span className={`labour-week-state ${saved ? 'is-saved' : ''}`}>{selected && dirtyDraft ? '• Unsaved changes' : saved ? '✓ Saved' : 'Not saved'}</span><span className="labour-week-total">{money(recordedPaymentTotal(data.weeklyPayments, date))}</span></button>
        })}</div>
      </section>
      <form className="labour-panel labour-payment-sheet" onSubmit={(event) => void saveAll(event)}>
        <div className="labour-section-heading"><div><p className="labour-step">Step 2</p><h2>{friendlyDate(openWednesday)}</h2><p>Check each worker’s payment for this week.</p></div><span className={`labour-status ${hasSavedPayment && !dirtyDraft ? 'is-saved' : ''}`}>{dirtyDraft ? 'Unsaved changes' : hasSavedPayment ? '✓ Saved record' : 'New payment'}</span></div>
        {!hasSavedPayment && paymentWorkers.length > 0 && <p className="labour-hint">Usual weekly amounts are filled in for you. They count as expenses only after you save.</p>}
        <div className="labour-payment-list">{paymentWorkers.length ? paymentWorkers.map((worker, index) => {
          const skipped = !!removed[worker.id]
          const repaymentKey = `${openWednesday}:${worker.id}`
          const loanBalance = outstandingLoanByWorker[worker.id] ?? 0
          const recordedRepayment = recordedRepaymentsByWeek[repaymentKey] ?? 0
          const repaymentLimit = loanBalance + recordedRepayment
          return <div className={`labour-worker-payment ${skipped ? 'is-skipped' : ''}`} key={worker.id}>
            <div className="labour-worker-identity"><span className="labour-worker-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{worker.name}</h3><p>{skipped ? 'Skipped this week · no wage payment' : `Usual amount ${money(Number(worker.default_weekly_amount))}`}</p></div></div>
            <label className="labour-amount-label" htmlFor={`pay-${worker.id}`}>Weekly payment<span className="labour-currency-input"><span aria-hidden="true">₹</span><input id={`pay-${worker.id}`} aria-label={`Weekly payment in rupees for ${worker.name}`} type="number" inputMode="decimal" min="0" step="0.01" required disabled={skipped || !!busy} value={skipped ? '0' : amounts[worker.id] ?? ''} onChange={(event) => { markDraft(); setAmounts((current) => ({ ...current, [worker.id]: event.target.value })) }} /></span></label>
            <button type="button" className={`labour-skip ${skipped ? 'is-restore' : ''}`} disabled={!!busy} aria-label={`${skipped ? 'Include' : 'Skip'} ${worker.name} ${skipped ? 'in' : 'for'} this week`} onClick={() => { markDraft(); setRemoved((current) => ({ ...current, [worker.id]: !current[worker.id] })) }}>{skipped ? '↶ Include this week' : 'Skip this week'}</button>
            {(loanBalance > 0 || recordedRepayment > 0) && <div className="labour-repayment"><div><strong>Loan repayment</strong><p>{recordedRepayment > 0 ? `${money(recordedRepayment)} already recorded for this date` : `${money(loanBalance)} outstanding · optional this week`}</p></div><label className="labour-currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" min="0" step="0.01" max={repaymentLimit} readOnly={recordedRepayment > 0} disabled={!!busy} aria-label={`Loan repayment in rupees for ${worker.name}`} value={recordedRepayment > 0 ? String(recordedRepayment) : repayments[repaymentKey] ?? ''} placeholder="0" onChange={(event) => { markDraft(); setRepayments((current) => ({ ...current, [repaymentKey]: event.target.value })) }} /></label></div>}
          </div>
        }) : <div className="labour-empty"><span aria-hidden="true">♧</span><h3>Add your first worker</h3><p>Set their usual weekly amount once to make every payday easier.</p><button type="button" className="button-primary" onClick={() => setView('workers')}>Add a worker</button></div>}</div>
        {paymentWorkers.some((worker) => (outstandingLoanByWorker[worker.id] ?? 0) > 0 || (recordedRepaymentsByWeek[`${openWednesday}:${worker.id}`] ?? 0) > 0) && <p className="labour-footnote">Loan repayments are recorded separately. They do not automatically reduce the weekly payment amount.</p>}
        <div className="labour-save-bar"><div><p className="labour-step">Step 3 · Review & save</p><p className="labour-total-label">Total weekly payment <strong>{money(Number.isFinite(draftTotal) ? draftTotal : 0)}</strong></p><p className="labour-total-detail">{includedWorkers} {includedWorkers === 1 ? 'worker' : 'workers'} included{hasSavedPayment ? ` · Previously saved ${money(recordedTotal)}` : ' · Not yet added to expenses'}</p></div><button type="submit" className="button-primary labour-save-button" disabled={!paymentWorkers.length || !!busy}>{busy === 'payments' ? 'Saving payments…' : lastSavedWeek === openWednesday && !dirtyDraft ? '✓ Payments saved' : hasSavedPayment ? 'Save updated payments' : 'Save weekly payments'}</button></div>
        {hasSavedPayment && <details className="labour-reset"><summary>Correct a saved week</summary><p>Clear the saved payments and undo loan repayments recorded with this weekly payment.</p><button type="button" className="labour-danger-button" disabled={!!busy} onClick={() => setResettingWeek(openWednesday)}>{busy === 'reset' ? 'Clearing saved payments…' : 'Clear saved payments for this week'}</button></details>}
      </form>
    </>}

    {view === 'loans' && <div className="labour-management-grid">
      <form className="labour-panel labour-form" onSubmit={(event) => void saveLoan(event)}><p className="labour-step">Loans & advances</p><h2>Record an advance or repayment</h2><p>Keep track of money given to workers and money received back.</p><label className="label">Worker<select className="field" value={loanForm.worker_id} onChange={(event) => setLoanForm({ ...loanForm, worker_id: event.target.value })} required><option value="">Choose a worker</option>{data.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}{worker.active ? '' : ' (inactive)'}</option>)}</select></label><label className="label">What are you recording?<select className="field" value={loanForm.kind} onChange={(event) => setLoanForm({ ...loanForm, kind: event.target.value as 'advance' | 'repayment' })}><option value="advance">Advance given to worker</option><option value="repayment">Repayment received from worker</option></select></label><div className="labour-form-pair"><label className="label">Date<input className="field" type="date" value={loanForm.loan_date} onChange={(event) => setLoanForm({ ...loanForm, loan_date: event.target.value })} required /></label><label className="label">Amount (₹)<input className="field" type="number" inputMode="decimal" min="0.01" step="0.01" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: event.target.value })} required placeholder="0" /></label></div><label className="label">Notes <span className="labour-optional">(optional)</span><input className="field" value={loanForm.notes} onChange={(event) => setLoanForm({ ...loanForm, notes: event.target.value })} placeholder="e.g. Festival advance" /></label><button className="button-primary" disabled={!!busy || !data.workers.length}>{busy === 'loan' ? 'Saving record…' : `Save ${loanForm.kind === 'advance' ? 'advance' : 'repayment'}`}</button>{!data.workers.length && <p>Add a worker in Manage workers first.</p>}</form>
      <div className="labour-panel"><h2>Outstanding balances</h2><p className="labour-section-description">What each worker still owes.</p><div className="labour-balance-list">{loanBalances.length ? loanBalances.map(({ worker, balance }) => <div key={worker.id}><strong>{worker.name}</strong><span className={balance < 0 ? 'is-credit' : ''}>{balance < 0 ? `Credit ${money(Math.abs(balance))}` : money(balance)}</span></div>) : <EmptyRecord>No outstanding loans. All settled.</EmptyRecord>}</div><details className="labour-history"><summary>Loan history <span>{data.workerLoans.length} records</span></summary><div className="labour-history-list">{data.workerLoans.length ? data.workerLoans.map((loan) => <article key={loan.id}><div className="labour-record-heading"><div><h3>{data.workers.find((worker) => worker.id === loan.worker_id)?.name ?? 'Deleted worker'}</h3><p>{shortDate(loan.loan_date)} {loan.loan_date.slice(0, 4)} · {loan.kind === 'advance' ? 'Advance given' : 'Repayment received'}</p></div><strong>{money(Number(loan.amount))}</strong></div>{loan.notes && <p className="labour-record-note">{loan.notes}</p>}<button type="button" className="labour-text-danger" disabled={!!busy} aria-label={`Delete ${loan.kind} of ${money(Number(loan.amount))} on ${loan.loan_date}`} onClick={() => setDeletingLoan(loan)}>Delete record</button></article>) : <EmptyRecord>No advances or repayments recorded yet.</EmptyRecord>}</div></details></div>
    </div>}

    {view === 'workers' && <div className="labour-management-grid">
      <form ref={workerEditorRef} className="labour-panel labour-form" onSubmit={(event) => void saveWorkerProfile(event)}><p className="labour-step">Your team</p><h2>{editing ? `Edit ${editing.name}` : 'Add a worker'}</h2><p>{editing ? 'Update their details or make them inactive when they leave.' : 'Enter their usual weekly payment. You can change it for any week.'}</p><label className="label">Worker name<input className="field" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required autoComplete="off" placeholder="Enter full name" /></label><label className="label">Usual weekly payment (₹)<input className="field" type="number" inputMode="decimal" min="0" step="0.01" value={workerAmount} onChange={(event) => setWorkerAmount(event.target.value)} required placeholder="0" /></label>{editing && <label className="label">Worker status<select className="field" value={workerActive ? 'active' : 'inactive'} onChange={(event) => setWorkerActive(event.target.value === 'active')}><option value="active">Active — include in weekly payments</option><option value="inactive">Inactive — keep past records only</option></select></label>}<div className="labour-form-actions"><button className="button-primary" disabled={!!busy}>{busy === 'worker' ? 'Saving worker…' : editing ? 'Save worker details' : 'Add worker'}</button>{editing && <button type="button" className="button-secondary" disabled={!!busy} onClick={() => { setEditing(null); setWorkerName(''); setWorkerAmount(''); setWorkerActive(true) }}>Cancel editing</button>}</div></form>
      <div className="labour-panel"><div className="labour-section-heading"><div><h2>Your workers</h2><p>{activeCount} active · {data.workers.length} total</p></div></div><div className="labour-team-list">{data.workers.length ? data.workers.map((worker) => <article key={worker.id}><div className="labour-record-heading"><div><h3>{worker.name}</h3><p>{money(Number(worker.default_weekly_amount))} / week</p></div><span className={`labour-status ${worker.active ? 'is-saved' : ''}`}>{worker.active ? 'Active' : 'Inactive'}</span></div><div className="labour-worker-actions"><button type="button" className="button-secondary" disabled={!!busy} aria-label={`Edit ${worker.name}`} onClick={() => startEditing(worker)}>Edit details</button><details><summary aria-label={`More options for ${worker.name}`}>More</summary><button type="button" className="labour-text-danger" disabled={!!busy} onClick={() => setDeleting(worker)}>Delete worker & records</button></details></div></article>) : <EmptyRecord>Your team will appear here when you add a worker.</EmptyRecord>}</div><p className="labour-footnote">To stop future payments while keeping history, edit a worker and set their status to inactive.</p></div>
    </div>}
    <ConfirmDialog open={!!pendingSelection} title="Leave this unsaved payment?" onCancel={() => setPendingSelection(null)} onConfirm={() => { if (pendingSelection) applySelection(pendingSelection) }} confirmLabel="Discard changes" confirmVariant="danger">Your changes for {friendlyDate(openWednesday)} have not been saved. Cancel to return and save, or discard changes to choose another week.</ConfirmDialog>
    <ConfirmDialog open={!!resettingWeek} title="Clear this week’s saved payments?" onCancel={() => setResettingWeek('')} onConfirm={() => void resetWeek(resettingWeek)} confirmLabel="Clear saved payments" confirmVariant="danger">This immediately resets saved labour to ₹0 for {resettingWeek ? friendlyDate(resettingWeek) : 'this week'} and removes loan repayments recorded with this weekly payment. You will not need to save again.</ConfirmDialog>
    <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name ?? 'worker'}?`} onCancel={() => setDeleting(null)} onConfirm={() => void deleteWorker()}>This permanently deletes the worker, all their weekly payments, and loan records. To keep their history, cancel and set the worker to inactive instead.</ConfirmDialog>
    <ConfirmDialog open={!!deletingLoan} title="Delete loan record?" onCancel={() => setDeletingLoan(null)} onConfirm={() => void deleteLoan()}>This changes the worker’s outstanding loan balance.</ConfirmDialog>
  </div>
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="labour-summary-card"><p>{label}</p><strong>{value}</strong><span>{detail}</span></div>
}
function EmptyRecord({ children }: { children: string }) { return <p className="labour-empty-record">{children}</p> }
