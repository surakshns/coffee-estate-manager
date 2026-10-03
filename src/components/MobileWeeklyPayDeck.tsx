import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, Wallet } from 'lucide-react'
import type { Worker } from '../lib/types'
import { money } from '../lib/calculations'
import { Sheet } from './Workspace'

type Props = {
  dateLabel: string
  workers: Worker[]
  busy: boolean
  locked: boolean
  saved: boolean
  error: string
  includedCount: number
  workingDays: number
  wages: number
  takeHome: number
  renderWorker: (worker: Worker) => ReactNode
  workerError: (worker: Worker) => string
  onClose: () => void
  onSave: () => void
}

export function MobileWeeklyPayDeck({ dateLabel, workers, busy, locked, saved, error, includedCount, workingDays, wages, takeHome, renderWorker, workerError, onClose, onSave }: Props) {
  const [index, setIndex] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [attemptedNext, setAttemptedNext] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLParagraphElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const worker = workers[index]
  const issue = worker && !locked ? workerError(worker) : ''
  const reviewing = !worker

  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    progressRef.current?.focus({ preventScroll: true })
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [index])

  useEffect(() => {
    const viewport = window.visualViewport
    const sheet = progressRef.current?.closest('dialog')
    if (!viewport || !sheet) return
    const update = () => {
      sheet.style.setProperty('--labour-deck-height', `${viewport.height}px`)
      sheet.style.setProperty('--labour-deck-top', `${viewport.offsetTop}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      sheet.style.removeProperty('--labour-deck-height')
      sheet.style.removeProperty('--labour-deck-top')
    }
  }, [])

  const navigate = useCallback((step: 1 | -1) => {
    if (busy || leaving || (step === 1 && !worker) || (step === -1 && index === 0)) { setDragY(0); return }
    if (step === 1 && issue) { setAttemptedNext(true); setDragY(0); return }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setDirection(step)
    setLeaving(true)
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timerRef.current = setTimeout(() => {
      setIndex(current => Math.max(0, Math.min(current + step, workers.length)))
      setDragY(0)
      setLeaving(false)
      setAttemptedNext(false)
      timerRef.current = null
    }, reducedMotion ? 0 : 220)
  }, [busy, leaving, worker, issue, index, workers.length])

  // Preserve input gestures and normal scrolling. The handle always permits
  // swiping; card content permits it only at the matching scroll boundary.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || busy || leaving) return
    let origin: { x: number; y: number; next: boolean; previous: boolean } | null = null
    let lastY = 0
    let dragging = false
    const start = (event: TouchEvent) => {
      origin = null
      if (event.touches.length !== 1) return
      if (event.target instanceof Element && event.target.closest('button, input, select, textarea, label, a')) return
      const fromHandle = event.target instanceof Element && !!event.target.closest('.labour-deck-swipe-handle')
      const scroller = scrollRef.current
      const top = scroller?.scrollTop ?? 0
      const visibleHeight = scroller?.clientHeight ?? 0
      const fullHeight = scroller?.scrollHeight ?? 0
      const scrollable = fullHeight > visibleHeight + 1
      origin = {
        x: event.touches[0].clientX, y: event.touches[0].clientY,
        next: fromHandle || (scrollable ? top + visibleHeight >= fullHeight - 1 : top <= 0),
        previous: fromHandle || top <= 0
      }
      lastY = 0
      dragging = false
    }
    const move = (event: TouchEvent) => {
      if (!origin) return
      if (event.touches.length !== 1) { origin = null; setDragY(0); return }
      const dx = Math.abs(event.touches[0].clientX - origin.x)
      const dy = event.touches[0].clientY - origin.y
      if (!dragging && dx > Math.max(12, Math.abs(dy))) { origin = null; return }
      if (!dragging && Math.abs(dy) < 10) return
      if ((dy < 0 && (!origin.next || !worker)) || (dy > 0 && (!origin.previous || index === 0))) { origin = null; setDragY(0); return }
      if (!event.cancelable) { origin = null; setDragY(0); return }
      event.preventDefault()
      dragging = true
      lastY = dy
      setDirection(dy < 0 ? 1 : -1)
      setDragY(Math.max(-180, Math.min(dy, 180)))
    }
    const end = () => {
      const changeCard = origin && dragging && Math.abs(lastY) >= 80
      origin = null
      dragging = false
      if (changeCard) navigate(lastY < 0 ? 1 : -1)
      else setDragY(0)
    }
    const cancel = () => { origin = null; dragging = false; setDragY(0) }
    stage.addEventListener('touchstart', start, { passive: true })
    stage.addEventListener('touchmove', move, { passive: false })
    stage.addEventListener('touchend', end)
    stage.addEventListener('touchcancel', cancel)
    return () => {
      stage.removeEventListener('touchstart', start)
      stage.removeEventListener('touchmove', move)
      stage.removeEventListener('touchend', end)
      stage.removeEventListener('touchcancel', cancel)
    }
  }, [navigate, busy, leaving, worker, index])

  function goTo(nextIndex: number) {
    if (busy || leaving) return
    setDirection(nextIndex < index ? -1 : 1)
    setIndex(nextIndex)
    setAttemptedNext(false)
    setDragY(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  return <Sheet open title={`Weekly pay · ${dateLabel}`} onClose={onClose} busy={busy} className="labour-deck-sheet">
    <div className="labour-mobile-deck">
      <div className="labour-deck-progress">
        <p ref={progressRef} tabIndex={-1} role="status" aria-live="polite">{reviewing ? 'Review this week' : `Worker ${index + 1} of ${workers.length}`}</p>
        <label>Jump to worker<select value={reviewing ? 'review' : worker.id} disabled={busy || leaving} onChange={event => goTo(event.target.value === 'review' ? workers.length : workers.findIndex(item => item.id === event.target.value))}>{workers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="review">Week totals</option></select></label>
        <progress aria-label="Worker card progress" max={workers.length} value={reviewing ? workers.length : index + 1} />
      </div>
      {(error || (attemptedNext && issue)) && <p className="labour-deck-error" role="alert">{error || issue}</p>}

      <div className="labour-deck-stage" ref={stageRef} aria-busy={leaving}>
        <div className="labour-deck-preview" aria-hidden="true"><span>{direction === -1 ? 'Previous worker' : workers[index + 1] ? 'Next worker' : 'Next: week totals'}</span><strong>{direction === -1 ? workers[index - 1]?.name : workers[index + 1]?.name ?? 'Review & save'}</strong></div>
        <div key={worker?.id ?? 'review'} className={`labour-deck-motion ${leaving ? 'is-leaving' : ''} ${dragY !== 0 ? 'is-dragging' : ''}`} style={{ '--swipe-y': `${dragY}px`, '--swipe-angle': `${dragY / 60}deg`, '--swipe-exit': direction === 1 ? '-110%' : '110%', '--swipe-rotation': direction === 1 ? '-6deg' : '6deg', '--card-enter-y': direction === 1 ? '12px' : '-12px' } as CSSProperties}>
          <div className="labour-deck-swipe-handle"><span aria-hidden="true" /><p>{reviewing ? 'Swipe down for previous worker' : index === 0 ? 'Swipe up for next worker' : 'Swipe up: next · Swipe down: previous'}</p></div>
          <div className="labour-deck-card-scroll" ref={scrollRef}>
            {reviewing ? <div className="labour-deck-review">
              <Wallet size={28} aria-hidden="true" />
              <h3>{locked ? 'Saved week totals' : 'Ready to save this week'}</h3>
              <p>{locked ? 'These payments have already been saved.' : `Save all ${workers.length} workers together. Swiping keeps your entries in this draft.`}</p>
              <dl><div><dt>Workers to pay</dt><dd>{includedCount} of {workers.length}</dd></div><div><dt>Days worked</dt><dd>{workingDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</dd></div><div><dt>Wages</dt><dd>{money(wages)}</dd></div><div><dt>Loan deductions</dt><dd>{money(wages - takeHome)}</dd></div><div><dt>Take-home to pay</dt><dd>{money(takeHome)}</dd></div></dl>
              <p>Use the worker selector above to check or correct any entry.</p>
            </div> : renderWorker(worker)}
          </div>
        </div>
      </div>

      <div className="labour-deck-footer">
        <p>{locked ? 'Saved record' : 'Draft · Save the week when finished'}</p>
        <div><button type="button" className="button-secondary" disabled={index === 0 || busy || leaving} onClick={() => navigate(-1)} aria-label="Previous worker"><ArrowDown size={18} aria-hidden="true" />Previous</button>
          {reviewing ? locked ? <button type="button" className="button-primary" disabled={busy || leaving} onClick={onClose}>Done<Check size={18} aria-hidden="true" /></button> : <button type="button" className="button-primary" disabled={busy || leaving} onClick={onSave}>{busy ? 'Saving…' : saved ? 'Save updates' : 'Save weekly pay'}<Check size={18} aria-hidden="true" /></button> : <button type="button" className="button-primary" disabled={busy || leaving} onClick={() => navigate(1)}>{index + 1 === workers.length ? 'Review week' : 'Next worker'}<ArrowUp size={18} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  </Sheet>
}
