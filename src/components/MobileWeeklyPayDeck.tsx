import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronDown, ChevronUp, Wallet } from 'lucide-react'
import type { Worker } from '../lib/types'
import { money } from '../lib/calculations'
import { Sheet } from './Workspace'

type Props = {
  dateLabel: string
  workers: Worker[]
  busy: boolean
  locked: boolean
  saved: boolean
  dirty: boolean
  error: string
  includedCount: number
  workingDays: number
  wages: number
  takeHome: number
  renderWorker: (worker: Worker, onEditDeduction: () => void) => ReactNode
  renderDeduction: (worker: Worker, onDone: () => void) => ReactNode
  workerError: (worker: Worker) => string
  onClose: () => void
  onDiscard: () => void
  onSave: () => void
}

export function MobileWeeklyPayDeck({ dateLabel, workers, busy, locked, saved, dirty, error, includedCount, workingDays, wages, takeHome, renderWorker, renderDeduction, workerError, onClose, onDiscard, onSave }: Props) {
  const [index, setIndex] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [attemptedNext, setAttemptedNext] = useState(false)
  const [editingDeduction, setEditingDeduction] = useState(false)
  const [cardOverflows, setCardOverflows] = useState(false)
  const [cardAtBottom, setCardAtBottom] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLParagraphElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnToDeductionRef = useRef(false)
  const suppressedClickRef = useRef<{ target: Element; until: number } | null>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const closeOriginRef = useRef<HTMLElement | null>(null)
  const closeTitleId = useId()
  const closeDescriptionId = useId()
  const worker = workers[index]
  const issue = worker && !locked ? workerError(worker) : ''
  const reviewing = !worker

  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    if (!closeRequested) return
    const previous = closeOriginRef.current
    keepEditingRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [closeRequested])

  useEffect(() => {
    progressRef.current?.focus({ preventScroll: true })
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [index])

  useEffect(() => {
    if (editingDeduction || closeRequested || !returnToDeductionRef.current) return
    returnToDeductionRef.current = false
    const trigger = stageRef.current?.querySelector<HTMLButtonElement>('[data-loan-deduction-trigger]')
    trigger?.focus({ preventScroll: true })
    trigger?.scrollIntoView?.({ block: 'nearest' })
  }, [editingDeduction, closeRequested])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || editingDeduction || closeRequested) return
    const update = () => {
      setCardOverflows(scroller.scrollHeight > scroller.clientHeight + 1)
      setCardAtBottom(scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1)
    }
    update()
    scroller.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(scroller)
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild)
    return () => { scroller.removeEventListener('scroll', update); observer?.disconnect() }
  }, [index, editingDeduction, closeRequested])

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
    if (busy || leaving || editingDeduction || closeRequested || (step === 1 && !worker) || (step === -1 && index === 0)) { setDragY(0); return }
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
  }, [busy, leaving, editingDeduction, closeRequested, worker, issue, index, workers.length])

  // Every worker-card surface accepts a swipe, including controls. A tap still
  // activates its control; dragging suppresses the resulting compatibility click.
  // Review totals retain normal scrolling until the matching scroll boundary.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || busy || leaving || editingDeduction || closeRequested) return
    let origin: { x: number; y: number; next: boolean; previous: boolean; target: Element | null } | null = null
    let lastY = 0
    let dragging = false
    const start = (event: TouchEvent) => {
      origin = null
      suppressedClickRef.current = null
      if (event.touches.length !== 1) return
      const fromHandle = event.target instanceof Element && !!event.target.closest('.labour-deck-swipe-handle')
      const scroller = scrollRef.current
      const top = scroller?.scrollTop ?? 0
      const visibleHeight = scroller?.clientHeight ?? 0
      const fullHeight = scroller?.scrollHeight ?? 0
      const scrollable = fullHeight > visibleHeight + 1
      origin = {
        x: event.touches[0].clientX, y: event.touches[0].clientY,
        next: !!worker || fromHandle || (scrollable ? top + visibleHeight >= fullHeight - 1 : top <= 0),
        previous: !!worker || fromHandle || top <= 0,
        target: event.target instanceof Element ? event.target.closest('button, input, select, textarea, label, a') ?? event.target : null
      }
      lastY = 0
      dragging = false
    }
    const move = (event: TouchEvent) => {
      if (!origin) return
      if (event.touches.length !== 1) { origin = null; setDragY(0); return }
      const dx = Math.abs(event.touches[0].clientX - origin.x)
      const dy = event.touches[0].clientY - origin.y
      if (origin.target && Math.max(dx, Math.abs(dy)) >= 10) suppressedClickRef.current = { target: origin.target, until: Date.now() + 700 }
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
      if (suppressedClickRef.current) suppressedClickRef.current.until = Date.now() + 700
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
  }, [navigate, busy, leaving, editingDeduction, closeRequested, worker, index])

  function goTo(nextIndex: number) {
    if (busy || leaving || editingDeduction || closeRequested) return
    setDirection(nextIndex < index ? -1 : 1)
    setIndex(nextIndex)
    setAttemptedNext(false)
    setDragY(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  function openDeduction() {
    if (busy || leaving || locked) return
    setDragY(0)
    setEditingDeduction(true)
  }

  function finishDeduction() {
    returnToDeductionRef.current = true
    setEditingDeduction(false)
  }

  function scrollCardDetails() {
    const scroller = scrollRef.current
    if (!scroller) return
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextTop = Math.min(scroller.scrollTop + scroller.clientHeight * .8, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTo({ top: cardAtBottom ? 0 : Math.max(0, nextTop), behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  function requestClose() {
    if (busy) return
    if (closeRequested) { setCloseRequested(false); return }
    if (editingDeduction) { finishDeduction(); return }
    if (!dirty) { onClose(); return }
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    setLeaving(false)
    setDragY(0)
    closeOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCloseRequested(true)
  }

  return <Sheet open title={`Weekly pay · ${dateLabel}`} onClose={requestClose} closeLabel={editingDeduction && !closeRequested ? 'Back to advance' : undefined} busy={busy} className={`labour-deck-sheet ${editingDeduction && !closeRequested ? 'is-editing-deduction' : ''}`}>
    <div className="labour-mobile-deck" hidden={closeRequested} inert={closeRequested}>
      {editingDeduction && worker ? renderDeduction(worker, finishDeduction) : <>
      <div className="labour-deck-progress">
        <p ref={progressRef} tabIndex={-1} role="status" aria-live="polite">{reviewing ? 'Review this week' : `Worker ${index + 1} of ${workers.length}`}</p>
        <label>Jump to worker<select value={reviewing ? 'review' : worker.id} disabled={busy || leaving} onChange={event => goTo(event.target.value === 'review' ? workers.length : workers.findIndex(item => item.id === event.target.value))}>{workers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="review">Week totals</option></select></label>
        <progress aria-label="Worker card progress" max={workers.length} value={reviewing ? workers.length : index + 1} />
      </div>
      {(error || (attemptedNext && issue)) && <p className="labour-deck-error" role="alert">{error || issue}</p>}

      <div className="labour-deck-stage" ref={stageRef} aria-busy={leaving} onClickCapture={event => {
        const suppressed = suppressedClickRef.current
        const target = event.target
        if (suppressed && Date.now() <= suppressed.until && target instanceof Element && (suppressed.target.contains(target) || target.contains(suppressed.target))) {
          suppressedClickRef.current = null
          event.preventDefault()
          event.stopPropagation()
        }
      }}>
        <div className={`labour-deck-preview ${direction === -1 ? 'is-previous' : 'is-next'}`} aria-hidden="true"><span>{direction === -1 ? 'Previous worker' : workers[index + 1] ? 'Next worker' : 'Next: week totals'}</span><strong>{direction === -1 ? workers[index - 1]?.name : workers[index + 1]?.name ?? 'Review & save'}</strong></div>
        <div key={worker?.id ?? 'review'} className={`labour-deck-motion ${worker ? 'has-worker' : ''} ${leaving ? 'is-leaving' : ''} ${dragY !== 0 ? 'is-dragging' : ''}`} style={{ '--swipe-y': `${dragY}px`, '--swipe-angle': `${dragY / 60}deg`, '--swipe-exit': direction === 1 ? '-110%' : '110%', '--swipe-rotation': direction === 1 ? '-6deg' : '6deg', '--card-enter-y': direction === 1 ? '12px' : '-12px' } as CSSProperties}>
          <div className="labour-deck-swipe-handle"><span aria-hidden="true" /><div><p>{reviewing ? 'Swipe down for previous worker' : index === 0 ? 'Swipe up for next worker' : 'Swipe up: next · Swipe down: previous'}</p>{worker && cardOverflows && <button type="button" className="labour-deck-scroll-button" disabled={busy || leaving} onClick={scrollCardDetails}>{cardAtBottom ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{cardAtBottom ? 'Back to top' : 'More details'}</button>}</div></div>
          <div className="labour-deck-card-scroll" ref={scrollRef}>
            {reviewing ? <div className="labour-deck-review">
              <Wallet size={28} aria-hidden="true" />
              <h3>{locked ? 'Saved week totals' : 'Ready to save this week'}</h3>
              <p>{locked ? 'These payments have already been saved.' : `Save all ${workers.length} workers together. Swiping keeps your entries in this draft.`}</p>
              <dl><div><dt>Workers to pay</dt><dd>{includedCount} of {workers.length}</dd></div><div><dt>Days worked</dt><dd>{workingDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</dd></div><div><dt>Wages</dt><dd>{money(wages)}</dd></div><div><dt>Loan deductions</dt><dd>{money(wages - takeHome)}</dd></div><div><dt>Take-home to pay</dt><dd>{money(takeHome)}</dd></div></dl>
              <p>Use the worker selector above to check or correct any entry.</p>
            </div> : renderWorker(worker, openDeduction)}
          </div>
        </div>
      </div>

      <div className="labour-deck-footer">
        <p>{locked ? 'Saved record' : 'Draft · Save the week when finished'}</p>
        {(reviewing || index + 1 === workers.length) && <div>{reviewing ? locked ? <button type="button" className="button-primary" disabled={busy || leaving} onClick={requestClose}>Done<Check size={18} aria-hidden="true" /></button> : <button type="button" className="button-primary" disabled={busy || leaving} onClick={onSave}>{busy ? 'Saving…' : saved ? 'Save updates' : 'Save weekly pay'}<Check size={18} aria-hidden="true" /></button> : <button type="button" className="button-primary" disabled={busy || leaving} onClick={() => navigate(1)}>Review week<ArrowUp size={18} aria-hidden="true" /></button>}</div>}
      </div>
      </>}
    </div>
    {closeRequested && <section className="labour-close-prompt" role="alertdialog" aria-labelledby={closeTitleId} aria-describedby={closeDescriptionId}>
      <div className="labour-close-prompt-card">
        <h3 id={closeTitleId}>Save changes before closing?</h3>
        <p id={closeDescriptionId}>Save the current entries for this week, or discard your changes.</p>
        <div className="labour-close-summary"><span>Take-home to pay</span><strong>{money(takeHome)}</strong><p>{includedCount} {includedCount === 1 ? 'worker' : 'workers'} · {workingDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })} days</p></div>
        {error && <p className="labour-deck-error" role="alert">{error}</p>}
        <div className="labour-close-actions">
          <button type="button" className="button-primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="button-secondary labour-close-discard" disabled={busy} onClick={onDiscard}>Discard changes</button>
          <button ref={keepEditingRef} type="button" className="button-secondary" disabled={busy} onClick={() => setCloseRequested(false)}>Keep editing</button>
        </div>
      </div>
    </section>}
  </Sheet>
}
