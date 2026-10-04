import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Check, Delete } from 'lucide-react'
import type { LoanDeductionSuggestion } from '../lib/repaymentSuggestions'

type Props = {
  workerName: string
  value: string
  wages: number
  maximum: number
  suggestions: LoanDeductionSuggestion[]
  busy: boolean
  onChange: (value: string) => void
  onDone: () => void
}

const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function MobileLoanDeductionEditor({ workerName, value, wages, maximum, suggestions, busy, onChange, onDone }: Props) {
  const amountRef = useRef<HTMLInputElement>(null)
  const replaceOnDigit = useRef(true)
  const raw = value.replace(/,/g, '') || '0'
  const amount = Number(raw)
  const invalid = !Number.isFinite(amount) || amount > maximum

  useEffect(() => { amountRef.current?.focus({ preventScroll: true }) }, [])

  function enter(key: string) {
    if (busy) return
    const current = replaceOnDigit.current ? '' : raw
    if (key === '.') {
      if (current.includes('.')) return
      onChange(`${current || '0'}.`)
    } else {
      if (current.includes('.') && current.split('.')[1].length >= 2) return
      onChange(`${current}${key}`)
    }
    replaceOnDigit.current = false
  }

  function removeDigit() {
    if (busy) return
    replaceOnDigit.current = false
    onChange(raw.slice(0, -1) || '0')
  }

  function setAmount(amount: number) {
    if (busy) return
    replaceOnDigit.current = true
    onChange(String(amount))
  }

  function noDeduction() {
    if (busy) return
    setAmount(0)
    onDone()
  }

  function keyboardInput(event: KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (/^\d$/.test(event.key) || event.key === '.') {
      event.preventDefault()
      enter(event.key)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      removeDigit()
    } else if (event.key === 'Delete') {
      event.preventDefault()
      setAmount(0)
    }
  }

  return <section className="labour-deduction-editor" aria-labelledby="labour-deduction-title" onKeyDown={keyboardInput}>
    <div className="labour-deduction-editor-body">
      <div className="labour-deduction-display">
        <div className="labour-deduction-heading"><p title={workerName}>{workerName}</p><h3 id="labour-deduction-title">Loan deduction</h3></div>
        <div className={`labour-deduction-amount ${invalid ? 'is-invalid' : ''}`}><span aria-hidden="true">₹</span><input ref={amountRef} type="text" inputMode="none" readOnly aria-label={`Loan deduction in rupees for ${workerName}`} aria-invalid={invalid} aria-describedby={invalid ? 'labour-deduction-error' : undefined} value={value || '0'} /><span className="labour-deduction-limit">Max {rupees(maximum)}</span></div>
        {invalid ? <p id="labour-deduction-error" className="labour-deduction-error" role="alert">Deduction cannot exceed {rupees(maximum)}.</p> : <div className="labour-deduction-pay" role="status" aria-live="polite"><span>Pay {workerName}</span><strong>{rupees(Math.max(0, wages - amount))}</strong></div>}
      </div>
      {suggestions.length > 0 && <div className="labour-deduction-shortcuts" role="group" aria-label="Suggested deduction amounts">{suggestions.map(suggestion => <button type="button" key={suggestion.amount} className={suggestion.recommended ? 'is-recommended' : ''} disabled={busy} aria-label={`Set ${rupees(suggestion.amount)}`} aria-pressed={amount === suggestion.amount} onClick={() => setAmount(suggestion.amount)}><strong>{rupees(suggestion.amount)}</strong></button>)}</div>}
      <div className="labour-deduction-keypad" role="group" aria-label="Deduction number pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => <button type="button" key={digit} disabled={busy} onClick={() => enter(String(digit))}>{digit}</button>)}
        <button type="button" aria-label="Decimal point" disabled={busy} onClick={() => enter('.')}>.</button>
        <button type="button" disabled={busy} onClick={() => enter('0')}>0</button>
        <button type="button" aria-label="Delete last digit" disabled={busy} onClick={removeDigit}><Delete size={23} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="labour-deduction-actions"><button type="button" className="button-secondary" disabled={busy} onClick={noDeduction}>No deduction</button><button type="button" className="button-primary" disabled={busy || invalid} onClick={onDone}>Done<Check size={18} aria-hidden="true" /></button></div>
  </section>
}
