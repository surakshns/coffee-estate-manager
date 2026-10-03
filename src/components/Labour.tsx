import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { money, monthlyLabourTotal, wednesdaysInMonth, workersForPaymentDate, yearlyLabourTotal } from '../lib/calculations'
import { ArrowUp, CalendarDays, Check, Pencil, Settings2, Users, Wallet } from 'lucide-react'
import { PageHeading, Sheet, Notice, SearchField, EmptyState } from './Workspace'
import { supabase } from '../lib/supabase'
import type { EstateData, Worker, WorkerLoan } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { LabourLoans } from './LabourLoans'
import { WeeklyPayCard } from './WeeklyPayCard'
import { MobileWeeklyPayDeck } from './MobileWeeklyPayDeck'
import { WEEKLY_REPAYMENT_NOTE, workerLoanAccounts } from '../lib/labourLoans'
import './labour.css'

const asNumber = (value: string | undefined) => Number((value ?? '').replace(/,/g, '') || 0)
const daysLabel = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
const formattedAmount = (value: string) => {
  if (!value) return ''
  const clean = value.replace(/,/g, '').replace(/[^\d.]/g, '')
  const [whole = '', ...decimalParts] = clean.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const decimals = decimalParts.join('').slice(0, 2)
  return `${Number(normalizedWhole).toLocaleString('en-IN')}${clean.includes('.') ? `.${decimals}` : ''}`
}
const monthName = (monthIndex: number) => new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, monthIndex, 1))
const friendlyDate = (date: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const shortDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const today = () => new Date().toLocaleDateString('en-CA')
const preferredWednesday = (year: number, month: number) => {
  const dates = wednesdaysInMonth(year, month)
  return [...dates].reverse().find((date) => date <= today()) ?? dates[0]
}
type LoanForm = { worker_id: string; loan_date: string; amount: string; kind: 'advance' | 'repayment'; notes: string }
type View = 'payments' | 'loans' | 'workers'
type WeekSelection = { month: number; date: string }
const emptyLoan = (): LoanForm => ({ worker_id: '', loan_date: today(), amount: '', kind: 'advance', notes: '' })

export function Labour({ data, year, refresh, onYearChange }: { data: EstateData; year: number; refresh: () => Promise<void>; onYearChange?: (year: number) => void }) {
  const [view, setView] = useState<View>('payments')
  const [editor, setEditor] = useState<'worker' | 'loan' | 'rate' | null>(null)
  const [openMonth, setOpenMonth] = useState(new Date().getMonth())
  const [openWednesday, setOpenWednesday] = useState(() => preferredWednesday(year, new Date().getMonth()))
  const [daysWorked, setDaysWorked] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Record<string, boolean>>({})
  const [repayments, setRepayments] = useState<Record<string, string>>({})
  const [workerSearch, setWorkerSearch] = useState('')
  const [isPhone, setIsPhone] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches)
  const [phoneDeckOpen, setPhoneDeckOpen] = useState(false)
  const [dirtyDraft, setDirtyDraft] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<WeekSelection | null>(null)
  const [resettingWeek, setResettingWeek] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [workerDays, setWorkerDays] = useState('5')
  const [editingWeek, setEditingWeek] = useState(false)
  const [discardingWeek, setDiscardingWeek] = useState(false)
  const [workerActive, setWorkerActive] = useState(true)
  const [editing, setEditing] = useState<Worker | null>(null)
  const [deleting, setDeleting] = useState<Worker | null>(null)
  const [loanForm, setLoanForm] = useState(emptyLoan)
  const [deletingLoan, setDeletingLoan] = useState<WorkerLoan | null>(null)
  const [rateInput, setRateInput] = useState('450')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const previousYear = useRef(year)
  const requestedWeek = useRef<string | null>(null)
  const weeklyPayFormRef = useRef<HTMLFormElement>(null)

  const dates = useMemo(() => wednesdaysInMonth(year, openMonth), [year, openMonth])
  const loanAccounts = useMemo(() => workerLoanAccounts(data.workers, data.workerLoans), [data.workers, data.workerLoans])
  const outstandingLoanByWorker = Object.fromEntries(loanAccounts.filter(account => account.balance > 0).map(account => [account.workerId, account.balance]))
  const recordedRepaymentsByWeek = useMemo(() => data.workerLoans.filter((loan) => loan.kind === 'repayment' && loan.notes === WEEKLY_REPAYMENT_NOTE).reduce<Record<string, number>>((totals, loan) => {
    const key = `${loan.loan_date}:${loan.worker_id}`
    totals[key] = (totals[key] ?? 0) + Number(loan.amount)
    return totals
  }, {}), [data.workerLoans])
  const annualRate = Number(data.labourRates.find((rate) => rate.rate_year === year)?.daily_rate ?? 450)
  const totalLoanBalance = loanAccounts.reduce((total, account) => total + Math.max(0, account.balance), 0)
  const paymentWorkers = workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday)
  const rateForWorker = (worker: Worker) => Number(data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)?.daily_rate ?? annualRate)
  const grossForWorker = (worker: Worker) => {
    if (removed[worker.id]) return 0
    const saved = data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)
    const rate = rateForWorker(worker)
    const savedDays = saved?.days_worked ?? (saved && rate > 0 ? Math.round(Number(saved.amount) / rate * 10) / 10 : 0)
    return saved && asNumber(daysWorked[worker.id]) === Number(savedDays) ? Number(saved.amount) : asNumber(daysWorked[worker.id]) * rate
  }
  const personalDeductionFor = (worker: Worker) => removed[worker.id] ? 0 : asNumber(repayments[`${openWednesday}:${worker.id}`])
  const workerErrorFor = (worker: Worker) => {
    const days = removed[worker.id] ? 0 : asNumber(daysWorked[worker.id])
    const deduction = personalDeductionFor(worker)
    if (!Number.isFinite(days) || days < 0 || days > 7 || deduction > grossForWorker(worker)) return 'Check days worked and loan deductions. Deductions cannot exceed the weekly wage.'
    if (deduction > (outstandingLoanByWorker[worker.id] ?? 0) + (recordedRepaymentsByWeek[`${openWednesday}:${worker.id}`] ?? 0)) return `Loan deduction for ${worker.name} exceeds the amount still owed.`
    return ''
  }
  const draftTotal = paymentWorkers.reduce((sum, worker) => sum + grossForWorker(worker), 0)
  const draftTakeHome = paymentWorkers.reduce((sum, worker) => sum + Math.max(0, grossForWorker(worker) - personalDeductionFor(worker)), 0)
  const draftWorkingDays = paymentWorkers.reduce((sum, worker) => sum + (removed[worker.id] ? 0 : asNumber(daysWorked[worker.id])), 0)
  const savedWeeklyWorkingDays = data.weeklyPayments
    .filter(payment => payment.week_start === openWednesday && !payment.excluded)
    .reduce((sum, payment) => {
      const rate = Number(payment.daily_rate ?? annualRate)
      const days = payment.days_worked ?? (rate > 0 ? Math.round(Number(payment.amount) / rate * 10) / 10 : 0)
      return sum + Number(days)
    }, 0)
  const monthlyTakeHome = data.weeklyPayments
    .filter((payment) => !payment.excluded && new Date(`${payment.week_start}T12:00:00`).getFullYear() === year && new Date(`${payment.week_start}T12:00:00`).getMonth() === openMonth)
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0)
  const monthlyWorkingDays = data.weeklyPayments
    .filter((payment) => !payment.excluded && new Date(`${payment.week_start}T12:00:00`).getFullYear() === year && new Date(`${payment.week_start}T12:00:00`).getMonth() === openMonth)
    .reduce((sum, payment) => sum + Number(payment.days_worked ?? 0), 0)
  const includedWorkers = paymentWorkers.filter((worker) => !removed[worker.id]).length
  const hasSavedPayment = data.weeklyPayments.some((payment) => payment.week_start === openWednesday)
  const weekLocked = hasSavedPayment && !editingWeek
  const recordedTakeHome = (date: string) => data.weeklyPayments
    .filter((payment) => payment.week_start === date && !payment.excluded)
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.loan_deduction ?? 0)), 0)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => { setIsPhone(media.matches); if (!media.matches) setPhoneDeckOpen(false) }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (previousYear.current === year) return
    previousYear.current = year
    setOpenWednesday(requestedWeek.current ?? preferredWednesday(year, openMonth))
    requestedWeek.current = null
    setEditingWeek(false)
    setDirtyDraft(false)
    setMessage('')
  }, [year, openMonth])

  useEffect(() => {
    setRateInput(formattedAmount(String(annualRate)))
  }, [annualRate, year])

  useEffect(() => {
    // Keep an unfinished payment sheet when team or loan data refreshes.
    if (dirtyDraft) return
    const nextDays: Record<string, string> = {}
    const nextRemoved: Record<string, boolean> = {}
    const nextRepayments: Record<string, string> = {}
    workersForPaymentDate(data.workers, data.weeklyPayments, openWednesday).forEach((worker) => {
      const historical = data.weeklyPayments.find((payment) => payment.worker_id === worker.id && payment.week_start === openWednesday)
      const rate = Number(historical?.daily_rate ?? annualRate)
      const savedDays = historical?.days_worked
      const derivedDays = savedDays ?? (historical ? (rate > 0 ? Number(historical.amount) / rate : 0) : worker.default_days_worked ?? 5)
      nextDays[worker.id] = String(Math.round(derivedDays * 10) / 10)
      nextRemoved[worker.id] = Boolean(historical?.excluded)
      const key = `${openWednesday}:${worker.id}`
      nextRepayments[key] = formattedAmount(String(historical?.loan_deduction ?? recordedRepaymentsByWeek[key] ?? 0))
    })
    setDaysWorked(nextDays)
    setRemoved(nextRemoved)
    setRepayments(nextRepayments)
  }, [data.workers, data.weeklyPayments, openWednesday, annualRate, dirtyDraft, recordedRepaymentsByWeek, editingWeek])

  useEffect(() => {
    if (!dirtyDraft) return
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirtyDraft])

  function notify(text: string, error = false) { setMessage(text); setMessageError(error) }
  function markDraft() { setDirtyDraft(true); setMessage('') }
  function updateDays(workerId: string, value: string) {
    markDraft()
    setDaysWorked(current => ({ ...current, [workerId]: value }))
  }
  function applySelection(selection: WeekSelection) {
    const selectedYear = Number(selection.date.slice(0, 4))
    if (selectedYear !== year && onYearChange) {
      requestedWeek.current = selection.date
      onYearChange(selectedYear)
    }
    setEditingWeek(false)
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
    if (weekLocked) return
    const rows = workers.map((worker) => ({
      worker_id: worker.id, days_worked: removed[worker.id] ? 0 : asNumber(daysWorked[worker.id]),
      daily_rate: rateForWorker(worker), excluded: Boolean(removed[worker.id]),
      personal_deduction: personalDeductionFor(worker)
    }))
    const issue = workers.map(workerErrorFor).find(Boolean)
    if (issue) { notify(issue, true); return }
    await runAction('payments', async () => {
      const { error } = await supabase.rpc('save_weekly_labour', { p_week_start: date, p_rows: rows })
      if (error) { notify(error.message, true); return }
      await refresh()
      setDirtyDraft(false)
      setEditingWeek(false)
      setPhoneDeckOpen(false)
      notify(`Payments saved for ${friendlyDate(date)}. Take-home to pay: ${money(draftTakeHome)}.`)
    })
  }

  function cancelWeekEdit() {
    setDirtyDraft(false)
    setEditingWeek(false)
    setDiscardingWeek(false)
    setMessage('')
  }

  async function resetWeek(date: string) {
    setResettingWeek('')
    await runAction('reset', async () => {
      const { error } = await supabase.rpc('clear_weekly_labour', { p_week_start: date })
      if (error) { notify(error.message, true); return }
      setRepayments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${date}:`))))
      await refresh()
      setDirtyDraft(false)
      setEditingWeek(false)
      notify(`Saved labour for ${friendlyDate(date)} is now ₹0. Weekly loan repayments were undone. Default days below are an unsaved draft.`)
    })
  }

  async function saveWorkerProfile(event: FormEvent) {
    event.preventDefault()
    if (!workerName.trim()) { notify('Enter the worker’s name.', true); return }
    if (!Number.isInteger(Number(workerDays)) || Number(workerDays) < 0 || Number(workerDays) > 6) { notify('Choose default working days from 0 to 6.', true); return }
    await runAction('worker', async () => {
      const payload = { name: workerName.trim(), default_days_worked: Number(workerDays), default_weekly_amount: Number(workerDays) * annualRate, active: workerActive }
      const request = editing ? supabase.from('workers').update(payload).eq('id', editing.id) : supabase.from('workers').insert(payload)
      const { error } = await request
      if (error) { notify(error.message, true); return }
      notify(editing ? 'Worker details updated.' : 'Worker added. Their default days are ready for new weeks.')
      setWorkerName(''); setWorkerDays('5'); setWorkerActive(true); setEditing(null); setEditor(null)
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
      if (!error) { setLoanForm(emptyLoan()); setEditor(null); await refresh() }
    })
  }
  async function saveDailyRate(event: FormEvent) {
    event.preventDefault()
    const dailyRate = asNumber(rateInput)
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) { notify('Enter a daily pay rate greater than zero.', true); return }
    await runAction('rate', async () => {
      const { error } = await supabase.from('labour_daily_rates').upsert({ rate_year: year, daily_rate: dailyRate }, { onConflict: 'user_id,rate_year' })
      notify(error ? error.message : `Daily pay rate for ${year} saved as ${money(dailyRate)}.`, !!error)
      if (!error) await refresh()
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
    setEditing(worker); setWorkerName(worker.name); setWorkerDays(String(worker.default_days_worked ?? 5)); setWorkerActive(worker.active)
    setMessage(''); setEditor('worker')
  }

  const activeCount = data.workers.filter((worker) => worker.active).length
  const visiblePaymentWorkers = isPhone ? paymentWorkers : paymentWorkers.filter(worker => worker.name.toLowerCase().includes(workerSearch.trim().toLowerCase()))
  function startPhoneAdvance() {
    if (busy) return
    if (hasSavedPayment) setEditingWeek(true)
    setMessage('')
    setPhoneDeckOpen(true)
  }
  function paymentCard(worker: Worker) {
    const repaymentKey = `${openWednesday}:${worker.id}`
    return <WeeklyPayCard key={`${openWednesday}:${worker.id}`} worker={worker} days={daysWorked[worker.id] ?? String(worker.default_days_worked ?? 5)} dailyRate={rateForWorker(worker)} gross={grossForWorker(worker)} deduction={personalDeductionFor(worker)} deductionInput={repayments[repaymentKey] ?? ''} loanBalance={outstandingLoanByWorker[worker.id] ?? 0} skipped={!!removed[worker.id]} locked={weekLocked} busy={!!busy}
      onDaysChange={value => updateDays(worker.id, value)}
      onToggleIncluded={() => { markDraft(); setRemoved(current => ({ ...current, [worker.id]: !current[worker.id] })) }}
      onDeductionChange={value => { markDraft(); setRepayments(current => ({ ...current, [repaymentKey]: formattedAmount(value) })) }} />
  }
  function openLoan(kind: 'advance' | 'repayment', workerId = '') {
    setLoanForm({ ...emptyLoan(), kind, worker_id: workerId })
    setMessage(''); setEditor('loan')
  }
  function viewLoanWeek(date: string) {
    if (Number(date.slice(0, 4)) !== year && !onYearChange) {
      notify(`Select record year ${date.slice(0, 4)} to view this weekly payment.`, true)
      return
    }
    setView('payments'); setWorkerSearch('')
    chooseWeek({ month: Number(date.slice(5, 7)) - 1, date })
  }
  return <div className="page labour-page">
    <PageHeading title="Labour" detail={`${activeCount} active ${activeCount === 1 ? 'worker' : 'workers'} · ${year}`} action={view === 'workers' ? 'Add worker' : undefined} onAction={() => { setEditing(null); setWorkerName(''); setWorkerDays('5'); setWorkerActive(true); setMessage(''); setEditor('worker') }} />
    <details className="labour-overview"><summary>Payment & loan overview</summary><div className="labour-summary">
      <SummaryCard label={`${monthName(openMonth)} payments`} value={money(monthlyLabourTotal(data.weeklyPayments, year, openMonth))} detail="Saved labour cost this month" />
      <SummaryCard label={`Paid in ${year}`} value={money(yearlyLabourTotal(data.weeklyPayments, year))} detail="Included in estate expenses" />
      <SummaryCard label="Worker loan balance" value={money(totalLoanBalance)} detail="Advances less repayments" />
      {view === 'payments' && <><SummaryCard label="This week’s work days" value={daysLabel(savedWeeklyWorkingDays)} detail={hasSavedPayment ? 'Saved worker days in the selected week' : 'No saved payment for this week'} /><SummaryCard label={`${monthName(openMonth)} work days`} value={daysLabel(monthlyWorkingDays)} detail="All saved worker days this month" /><SummaryCard label={`${monthName(openMonth)} take-home`} value={money(monthlyTakeHome)} detail="Wages after loan deductions" /></>}
    </div></details>
    <nav className="labour-views" aria-label="Labour sections">
      {([{ value: 'payments', label: 'Weekly pay', Icon: CalendarDays }, { value: 'loans', label: 'Loans', Icon: Wallet }, { value: 'workers', label: 'Workers', Icon: Users }] as const).map(({ value, label, Icon }) => <button key={value} type="button" className={view === value ? 'is-active' : ''} aria-current={view === value ? 'page' : undefined} onClick={() => setView(value)}><Icon size={18} aria-hidden="true" />{label}{value === 'payments' && dirtyDraft && <span className="labour-draft-dot" aria-label="Unsaved changes" />}</button>)}
    </nav>
    {message && <p className={`labour-message ${messageError ? 'is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{messageError ? '' : '✓ '}{message}</p>}

    {view === 'payments' && <>
      <section className="labour-panel labour-period" aria-labelledby="labour-period-title">
        <div className="labour-section-heading"><div><p className="labour-step">Step 1</p><h2 id="labour-period-title">Choose payment week</h2></div><label className="labour-month-label">Month<select className="field" value={openMonth} disabled={!!busy} onChange={(event) => { const month = Number(event.target.value); chooseWeek({ month, date: preferredWednesday(year, month) }) }}>{Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{monthName(month)} {year}</option>)}</select></label></div>
        <div className="labour-weeks" aria-label="Wednesday payment dates">{dates.map((date) => {
          const saved = data.weeklyPayments.some((payment) => payment.week_start === date)
          const selected = openWednesday === date
          return <button type="button" key={date} className={`labour-week ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={!!busy} onClick={() => chooseWeek({ month: openMonth, date })}><span className="labour-week-day">Wed</span><strong>{shortDate(date)}</strong><span className={`labour-week-state ${saved ? 'is-saved' : ''}`}>{selected && dirtyDraft ? 'Changed' : saved ? '✓ Saved' : 'New'}</span><span className="labour-week-total">Take-home {money(recordedTakeHome(date))}</span></button>
        })}</div>
      </section>
      <form ref={weeklyPayFormRef} id="weekly-pay-form" className="labour-panel labour-payment-sheet" onSubmit={(event) => void saveAll(event)}>
        <div className="labour-section-heading"><div><p className="labour-step">Step 2</p><h2>{friendlyDate(openWednesday)}</h2></div><span className={`labour-status ${hasSavedPayment && !dirtyDraft ? 'is-saved' : ''}`}>{dirtyDraft ? 'Unsaved changes' : hasSavedPayment ? '✓ Saved record' : 'New payment'}</span></div>
        {!isPhone && <>
          {hasSavedPayment && <div className="labour-edit-toolbar">{weekLocked ? <><p>Saved payment. Select Edit to make changes.</p><button type="button" className="button-secondary" disabled={!!busy} onClick={() => setEditingWeek(true)}>Edit weekly payments</button></> : <><p>Editing this week. Save updates when finished.</p><button type="button" className="button-secondary" disabled={!!busy} onClick={() => dirtyDraft ? setDiscardingWeek(true) : cancelWeekEdit()}>Cancel editing</button></>}</div>}
          {!hasSavedPayment && paymentWorkers.length > 0 && <p className="labour-hint">Tap days worked. Add a loan deduction if needed, then save.</p>}
          {paymentWorkers.length > 0 && <div className="labour-payment-tools"><SearchField value={workerSearch} onChange={setWorkerSearch} label="Find worker in weekly pay" placeholder="Find a worker" /><span>{workerSearch ? `${visiblePaymentWorkers.length} of ${paymentWorkers.length}` : paymentWorkers.length} workers · {includedWorkers} included</span></div>}
          {paymentWorkers.length > 0 && !visiblePaymentWorkers.length && <EmptyState title="No matching workers" detail="All workers are still included when you save this week." action="Clear worker search" onAction={() => setWorkerSearch('')} />}
        </>}
        {isPhone && paymentWorkers.length > 0 ? <section className="labour-phone-pay-summary" aria-label="Weekly pay summary">
          <div className="labour-phone-pay-total"><p>{hasSavedPayment && !dirtyDraft ? 'Saved take-home' : 'Draft take-home'}</p><strong>{money(draftTakeHome)}</strong><p className="labour-total-detail">{includedWorkers} {includedWorkers === 1 ? 'worker' : 'workers'} · {daysLabel(draftWorkingDays)} days</p></div>
          <dl className="labour-pay-breakdown"><div><dt>Wages</dt><dd>{money(draftTotal)}</dd></div><div><dt>Loan deductions</dt><dd>{money(draftTotal - draftTakeHome)}</dd></div></dl>
          <button type="button" className="button-primary" disabled={!!busy} onClick={startPhoneAdvance}>{hasSavedPayment ? 'Edit advance' : 'Start advance'}{hasSavedPayment ? <Pencil size={17} aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}</button>
          <p className="labour-phone-pay-hint">Swipe up: next · Swipe down: previous. Save after reviewing.</p>
          {hasSavedPayment && editingWeek && <button type="button" className="labour-phone-cancel" disabled={!!busy} onClick={() => dirtyDraft ? setDiscardingWeek(true) : cancelWeekEdit()}>Cancel editing</button>}
        </section> : <div className="labour-payment-list">{paymentWorkers.length ? visiblePaymentWorkers.map(paymentCard) : <div className="labour-empty"><span aria-hidden="true">♧</span><h3>Add your first worker</h3><p>Set their default days once to make every payday easier.</p><button type="button" className="button-primary" onClick={() => setView('workers')}>Add a worker</button></div>}</div>}
        {!isPhone && <>
          <dl className="labour-pay-breakdown"><div><dt>Wages</dt><dd>{money(draftTotal)}</dd></div><div><dt>Loan deductions</dt><dd>{money(draftTotal - draftTakeHome)}</dd></div></dl>
          <div className="labour-save-bar"><div><p className="labour-total-label">Take-home to pay <strong>{money(Number.isFinite(draftTakeHome) ? draftTakeHome : 0)}</strong></p><p className="labour-total-detail">{includedWorkers} {includedWorkers === 1 ? 'worker' : 'workers'} · {daysLabel(draftWorkingDays)} days{dirtyDraft ? ' · Unsaved changes' : hasSavedPayment ? ' · Saved' : ' · Not saved'}</p></div>{weekLocked ? <button type="button" className="button-primary labour-save-button" disabled={!!busy} onClick={() => setEditingWeek(true)}>Edit this week</button> : <button type="submit" className="button-primary labour-save-button" disabled={!paymentWorkers.length || !!busy}>{busy === 'payments' ? 'Saving…' : hasSavedPayment ? 'Save updates' : 'Save weekly pay'}<Check size={18} /></button>}</div>
        </>}
        {hasSavedPayment && <details className="labour-reset"><summary>Correct a saved week</summary><p>Clear the saved payments and undo loan repayments recorded with this weekly payment.</p><button type="button" className="labour-danger-button" disabled={!!busy} onClick={() => setResettingWeek(openWednesday)}>{busy === 'reset' ? 'Clearing saved payments…' : 'Clear saved payments for this week'}</button></details>}
      </form>
      {isPhone && phoneDeckOpen && paymentWorkers.length > 0 && <MobileWeeklyPayDeck key={openWednesday} dateLabel={friendlyDate(openWednesday)} workers={paymentWorkers} busy={!!busy} locked={weekLocked} saved={hasSavedPayment} error={messageError ? message : ''} includedCount={includedWorkers} workingDays={draftWorkingDays} wages={draftTotal} takeHome={draftTakeHome} renderWorker={paymentCard} workerError={workerErrorFor} onClose={() => setPhoneDeckOpen(false)} onSave={() => weeklyPayFormRef.current?.requestSubmit()} />}
    </>}

    {view === 'loans' && <LabourLoans data={data} busy={!!busy} onRecord={openLoan} onDelete={setDeletingLoan} onEditWeek={viewLoanWeek} />}

    {view === 'workers' && <div className="labour-management-grid"><div className="section-heading"><p className="section-caption">Daily pay · {money(annualRate)}</p><button className="button-secondary" onClick={() => { setMessage(''); setEditor('rate') }}><Settings2 size={17} />Pay rate</button></div>
      <div className="labour-panel"><div className="labour-section-heading"><div><h2>Your workers</h2><p>{activeCount} active · {data.workers.length} total</p></div></div><div className="labour-team-list">{data.workers.length ? data.workers.map((worker) => <article key={worker.id}><div className="labour-record-heading"><div><h3>{worker.name}</h3><p>{worker.default_days_worked ?? 5} default days per week</p></div><span className={`labour-status ${worker.active ? 'is-saved' : ''}`}>{worker.active ? 'Active' : 'Inactive'}</span></div><div className="labour-worker-actions"><button type="button" className="button-secondary" disabled={!!busy} aria-label={`Edit ${worker.name}`} onClick={() => startEditing(worker)}>Edit details</button><details><summary aria-label={`More options for ${worker.name}`}>More</summary><button type="button" className="labour-text-danger" disabled={!!busy} onClick={() => setDeleting(worker)}>Delete worker & records</button></details></div></article>) : <EmptyRecord>Your team will appear here when you add a worker.</EmptyRecord>}</div><p className="labour-footnote">To stop future payments while keeping history, edit a worker and set their status to inactive.</p></div>
    </div>}

    <Sheet open={!!editor} title={editor === 'worker' ? editing ? 'Edit worker' : 'Add worker' : editor === 'loan' ? 'Advance or repayment' : 'Daily pay rate'} busy={!!busy} onClose={() => setEditor(null)}>
      <Notice error={messageError}>{message}</Notice>
      {editor === 'worker' && (<form className="labour-panel labour-form" onSubmit={(event) => void saveWorkerProfile(event)}><p className="labour-step">Your team</p><h2>{editing ? `Edit ${editing.name}` : 'Add a worker'}</h2><p>{editing ? 'Update their details or make them inactive when they leave.' : 'Choose their usual number of working days. You can change it for any week.'}</p><label className="label">Worker name<input className="field" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required autoComplete="off" placeholder="Enter full name" /></label><label className="label">Default working days<select className="field" value={workerDays} onChange={(event) => setWorkerDays(event.target.value)}>{Array.from({ length: 7 }, (_, day) => <option key={day} value={day}>{day} {day === 1 ? 'day' : 'days'}</option>)}</select></label><p>{workerDays} days × {money(annualRate)} = {money(Number(workerDays) * annualRate)} before deductions.</p>{editing && <label className="label">Worker status<select className="field" value={workerActive ? 'active' : 'inactive'} onChange={(event) => setWorkerActive(event.target.value === 'active')}><option value="active">Active — include in weekly payments</option><option value="inactive">Inactive — keep past records only</option></select></label>}<div className="labour-form-actions"><button className="button-primary" disabled={!!busy}>{busy === 'worker' ? 'Saving worker…' : editing ? 'Save worker details' : 'Add worker'}</button>{editing && <button type="button" className="button-secondary" disabled={!!busy} onClick={() => { setEditing(null); setWorkerName(''); setWorkerDays('5'); setWorkerActive(true); setEditor(null) }}>Cancel editing</button>}</div></form>)}
      {editor === 'loan' && (<form className="labour-panel labour-form" onSubmit={(event) => void saveLoan(event)}><p className="labour-step">Individual loans</p><h2>Record an advance or repayment</h2><p>For money connected to one worker.</p><label className="label">Worker<select className="field" value={loanForm.worker_id} onChange={(event) => setLoanForm({ ...loanForm, worker_id: event.target.value })} required><option value="">Choose a worker</option>{data.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}{worker.active ? '' : ' (inactive)'}</option>)}</select></label><label className="label">What are you recording?<select className="field" value={loanForm.kind} onChange={(event) => setLoanForm({ ...loanForm, kind: event.target.value as 'advance' | 'repayment' })}><option value="advance">Advance given to worker</option><option value="repayment">Repayment received from worker</option></select></label><div className="labour-form-pair"><label className="label">Date<input className="field" type="date" value={loanForm.loan_date} onChange={(event) => setLoanForm({ ...loanForm, loan_date: event.target.value })} required /></label><label className="label">Amount (₹)<input className="field" type="text" inputMode="decimal" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: formattedAmount(event.target.value) })} required placeholder="0" /></label></div><label className="label">Notes <span className="labour-optional">(optional)</span><input className="field" value={loanForm.notes} onChange={(event) => setLoanForm({ ...loanForm, notes: event.target.value })} placeholder="e.g. Festival advance" /></label><button className="button-primary" disabled={!!busy || !data.workers.length}>{busy === 'loan' ? 'Saving record…' : `Save ${loanForm.kind === 'advance' ? 'advance' : 'repayment'}`}</button>{!data.workers.length && <p>Add a worker in Manage workers first.</p>}</form>)}
      {editor === 'rate' && (<form className="labour-panel labour-form labour-rate-panel" onSubmit={(event) => void saveDailyRate(event)}><p className="labour-step">Yearly setting</p><h2>Daily pay rate for {year}</h2><p>This is used when you enter days worked. Saved weeks keep the rate used on that date.</p><label className="label">Pay per day (₹)<input className="field" type="text" inputMode="decimal" value={rateInput} onChange={(event) => setRateInput(formattedAmount(event.target.value))} required placeholder="450" /></label><button className="button-primary" disabled={!!busy}>{busy === 'rate' ? 'Saving rate…' : `Save ${year} rate`}</button></form>)}
    </Sheet>
    <ConfirmDialog open={discardingWeek} title="Discard payment changes?" onCancel={() => setDiscardingWeek(false)} onConfirm={cancelWeekEdit} confirmLabel="Discard changes">Your saved payments will stay as they were.</ConfirmDialog>
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
