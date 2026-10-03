import { Check, Minus, Pencil, Plus } from 'lucide-react'
import { money } from '../lib/calculations'
import type { Worker } from '../lib/types'

type WeeklyPayCardProps = {
  worker: Worker
  days: string
  dailyRate: number
  gross: number
  deduction: number
  deductionInput: string
  loanBalance: number
  skipped: boolean
  locked: boolean
  busy: boolean
  onDaysChange: (days: string) => void
  onToggleIncluded: () => void
  onDeductionChange: (amount: string) => void
  onEditDeduction?: () => void
}

export function WeeklyPayCard({ worker, days, dailyRate, gross, deduction, deductionInput, loanBalance, skipped, locked, busy, onDaysChange, onToggleIncluded, onDeductionChange, onEditDeduction }: WeeklyPayCardProps) {
  const dayCount = skipped ? 0 : Number(days)
  const dayDescription = `${dayCount} ${dayCount === 1 ? 'day' : 'days'}`
  const headingId = `pay-worker-${worker.id}`
  const attendanceId = `attendance-${worker.id}`
  const deductionId = `deduction-${worker.id}`

  return <article className={`labour-worker-payment ${skipped ? 'is-skipped' : ''} ${locked ? 'is-locked' : ''}`} aria-labelledby={headingId}>
    <div className="labour-worker-heading">
      <div className="labour-worker-identity"><h3 id={headingId}>{worker.name}</h3><p>{money(dailyRate)} per day</p></div>
      {locked ? <span className={`labour-saved-status ${skipped ? 'is-skipped' : ''}`}>{skipped ? 'Skipped' : <><Check size={14} aria-hidden="true" />Saved</>}</span> : <button type="button" className={`labour-week-action ${skipped ? 'is-restore' : ''}`} aria-label={`${skipped ? 'Add to this week' : 'Skip this week'} for ${worker.name}`} disabled={busy} onClick={onToggleIncluded}>
        {skipped ? <Plus size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
        {skipped ? 'Add to this week' : 'Skip this week'}
      </button>}
    </div>

    <div className="labour-attendance">
      <p id={attendanceId} className="labour-amount-label">Days worked</p>
      {locked || skipped ? <p className="labour-attendance-value">{dayDescription}{skipped && <span> · Skipped this week</span>}</p> : <>
        <div className="labour-day-options" role="group" aria-describedby={attendanceId} aria-label={`Days worked by ${worker.name}`}>
          {[1, 2, 3, 4, 5, 6].map(day => <button key={day} type="button" aria-label={`${day} ${day === 1 ? 'day' : 'days'} for ${worker.name}`} aria-pressed={Number(days) === day} disabled={busy} onClick={() => onDaysChange(String(day))}><strong>{day}</strong><span>{day === 1 ? 'day' : 'days'}</span></button>)}
        </div>
        {(Number(days) < 1 || Number(days) > 6 || !Number.isInteger(Number(days))) && <p className="labour-attendance-note">Current attendance: {dayDescription}. Choose a day count to update it.</p>}
      </>}
    </div>

    <div className="labour-repayment">
      <div className="labour-repayment-heading">{onEditDeduction ? <span className="labour-amount-label">Loan deduction</span> : <label htmlFor={deductionId}>Loan deduction</label>}<p>{money(loanBalance)} still owed</p></div>
      {onEditDeduction ? <button type="button" className="labour-deduction-trigger" data-loan-deduction-trigger aria-label={`Edit loan deduction for ${worker.name}`} aria-describedby={deductionId} disabled={busy || locked || skipped} onClick={onEditDeduction}><span id={deductionId}><span>₹</span><strong>{skipped ? '0' : deductionInput || '0'}</strong></span><span className="labour-deduction-trigger-hint"><Pencil size={15} aria-hidden="true" />Tap to enter</span></button> : <div className="labour-currency-input"><span aria-hidden="true">₹</span><input id={deductionId} type="text" inputMode="decimal" disabled={busy || locked || skipped} aria-label={`Personal loan deduction in rupees for ${worker.name}`} value={skipped ? '0' : deductionInput} placeholder="0" onChange={event => onDeductionChange(event.target.value)} /></div>}
    </div>

    <div className="labour-calculated-pay">
      <div><span>Pay this worker</span><p>{skipped ? 'Not included this week' : deduction > 0 ? `${money(gross)} wages − ${money(deduction)} loan` : `${dayDescription} × ${money(dailyRate)}`}</p></div>
      <strong>{money(Math.max(0, gross - deduction))}</strong>
    </div>
  </article>
}
