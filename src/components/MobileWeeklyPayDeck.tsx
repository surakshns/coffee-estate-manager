import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

const EXIT_DURATION = 180
const ARRIVAL_DURATION = 130
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function MobileWeeklyPayDeck({ dateLabel, workers, busy, locked, saved, dirty, error, includedCount, workingDays, wages, takeHome, renderWorker, renderDeduction, workerError, onClose, onDiscard, onSave }: Props) {
  const [index, setIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [arriving, setArriving] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [attemptedNext, setAttemptedNext] = useState(false)
  const [editingDeduction, setEditingDeduction] = useState(false)
  const [cardOverflows, setCardOverflows] = useState(false)
  const [cardAtBottom, setCardAtBottom] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLParagraphElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const dragYRef = useRef(0)
  const directionRef = useRef<1 | -1>(1)
  const leavingRef = useRef(false)
  const pendingStepRef = useRef<1 | -1 | null>(null)
  const returnToDeductionRef = useRef(false)
  const suppressedClickRef = useRef<{ target: Element; until: number } | null>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const closeOriginRef = useRef<HTMLElement | null>(null)
  const closeTitleId = useId()
  const closeDescriptionId = useId()
  const worker = workers[index]
  const issue = worker && !locked ? workerError(worker) : ''
  const reviewing = !worker

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const writeDrag = useCallback(() => {
    const motion = motionRef.current
    if (!motion) return
    motion.style.setProperty('--swipe-y', `${dragYRef.current}px`)
    motion.style.setProperty('--swipe-angle', `${dragYRef.current / 90}deg`)
    stageRef.current?.style.setProperty('--swipe-progress', String(Math.min(1, Math.abs(dragYRef.current) / 80)))
  }, [])

  const resetDrag = useCallback(() => {
    cancelFrame()
    motionRef.current?.classList.remove('is-dragging')
    dragYRef.current = 0
    writeDrag()
    setDragging(false)
  }, [cancelFrame, writeDrag])

  const stopMotion = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    if (arrivalTimerRef.current !== null) clearTimeout(arrivalTimerRef.current)
    timerRef.current = null
    arrivalTimerRef.current = null
    pendingStepRef.current = null
    leavingRef.current = false
    resetDrag()
    setLeaving(false)
    setArriving(false)
  }, [resetDrag])

  const updateDirection = useCallback((next: 1 | -1) => {
    if (directionRef.current === next) return
    directionRef.current = next
    setDirection(next)
  }, [])

  const finishNavigation = useCallback(() => {
    const step = pendingStepRef.current
    if (!leavingRef.current || step === null) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    pendingStepRef.current = null
    leavingRef.current = false
    cancelFrame()
    dragYRef.current = 0
    stageRef.current?.style.setProperty('--swipe-progress', '0')
    setIndex(current => Math.max(0, Math.min(current + step, workers.length)))
    setDragging(false)
    setLeaving(false)
    setArriving(true)
    setAttemptedNext(false)
  }, [cancelFrame, workers.length])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      if (arrivalTimerRef.current !== null) clearTimeout(arrivalTimerRef.current)
      cancelFrame()
    }
  }, [cancelFrame])

  useEffect(() => {
    if (!arriving) return
    arrivalTimerRef.current = setTimeout(() => {
      arrivalTimerRef.current = null
      setArriving(false)
    }, reducedMotion() ? 0 : ARRIVAL_DURATION + 40)
    return () => {
      if (arrivalTimerRef.current !== null) clearTimeout(arrivalTimerRef.current)
      arrivalTimerRef.current = null
    }
  }, [arriving, index])

  useEffect(() => {
    if (busy || editingDeduction || closeRequested) stopMotion()
  }, [busy, editingDeduction, closeRequested, stopMotion])

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
    if (busy || leavingRef.current || editingDeduction || closeRequested || (step === 1 && !worker) || (step === -1 && index === 0)) { resetDrag(); return }
    if (step === 1 && issue) { setAttemptedNext(true); resetDrag(); return }
    // Flush the final sample before changing animation phases. A touchend can
    // arrive before its queued frame, especially on a quick flick.
    cancelFrame()
    writeDrag()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    updateDirection(step)
    leavingRef.current = true
    pendingStepRef.current = step
    setDragging(false)
    setArriving(false)
    setLeaving(true)
    // animationend completes ordinary swipes; the timer also covers reduced
    // motion and browsers that omit that event when the view changes.
    timerRef.current = setTimeout(finishNavigation, reducedMotion() ? 0 : EXIT_DURATION + 40)
  }, [busy, editingDeduction, closeRequested, worker, issue, index, resetDrag, cancelFrame, writeDrag, updateDirection, finishNavigation])

  // Every worker-card surface accepts a swipe, including controls. A tap still
  // activates its control; dragging suppresses the resulting compatibility click.
  // Review totals retain normal scrolling until the matching scroll boundary.
  // Attach before paint so the first touch on an arriving card is not lost.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || busy || leaving || editingDeduction || closeRequested) return
    let origin: { x: number; y: number; startedAt: number; next: boolean; previous: boolean; target: Element | null } | null = null
    let lastY = 0
    let lastMoveAt = 0
    let samples = 0
    let gestureDragging = false
    const start = (event: TouchEvent) => {
      origin = null
      suppressedClickRef.current = null
      if (event.touches.length !== 1 || leavingRef.current) {
        if (!leavingRef.current) { gestureDragging = false; resetDrag() }
        return
      }
      const fromHandle = event.target instanceof Element && !!event.target.closest('.labour-deck-swipe-handle')
      const scroller = scrollRef.current
      // Worker cards always swipe. Only the review needs scroll-boundary reads.
      const top = !worker && scroller ? scroller.scrollTop : 0
      const visibleHeight = !worker && scroller ? scroller.clientHeight : 0
      const fullHeight = !worker && scroller ? scroller.scrollHeight : 0
      const scrollable = fullHeight > visibleHeight + 1
      origin = {
        x: event.touches[0].clientX, y: event.touches[0].clientY,
        startedAt: performance.now(),
        next: !!worker || fromHandle || (scrollable ? top + visibleHeight >= fullHeight - 1 : top <= 0),
        previous: !!worker || fromHandle || top <= 0,
        target: event.target instanceof Element ? event.target.closest('button, input, select, textarea, label, a') ?? event.target : null
      }
      lastY = 0
      samples = 0
      lastMoveAt = origin.startedAt
      gestureDragging = false
    }
    const move = (event: TouchEvent) => {
      if (!origin) return
      if (event.touches.length !== 1) { origin = null; resetDrag(); return }
      const dx = Math.abs(event.touches[0].clientX - origin.x)
      const dy = event.touches[0].clientY - origin.y
      if (origin.target && Math.max(dx, Math.abs(dy)) >= 10) suppressedClickRef.current = { target: origin.target, until: Date.now() + 700 }
      if (!gestureDragging && dx > Math.max(12, Math.abs(dy))) { origin = null; resetDrag(); return }
      if (!gestureDragging && Math.abs(dy) < 10) return
      if ((dy < 0 && (!origin.next || !worker)) || (dy > 0 && (!origin.previous || index === 0))) { origin = null; resetDrag(); return }
      if (!event.cancelable) { origin = null; resetDrag(); return }
      event.preventDefault()
      if (!gestureDragging) {
        gestureDragging = true
        // Removing arrival once prevents short/cancelled drags from replaying
        // it when the card settles back into position.
        motionRef.current?.classList.remove('is-arriving')
        motionRef.current?.classList.add('is-dragging')
        setArriving(false)
        setDragging(true)
      }
      lastY = dy
      samples += 1
      lastMoveAt = performance.now()
      updateDirection(dy < 0 ? 1 : -1)
      dragYRef.current = Math.max(-180, Math.min(dy, 180))
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        writeDrag()
      })
    }
    const end = () => {
      const endedAt = performance.now()
      const duration = origin ? endedAt - origin.startedAt : 0
      // Two samples distinguish a deliberate flick from one finger adjustment.
      const flick = samples >= 2 && duration >= 16 && duration <= 200 && endedAt - lastMoveAt <= 80 && Math.abs(lastY) >= 38 && Math.abs(lastY) / duration >= .55
      const changeCard = origin && gestureDragging && (Math.abs(lastY) >= 80 || flick)
      if (suppressedClickRef.current) suppressedClickRef.current.until = Date.now() + 700
      origin = null
      gestureDragging = false
      if (changeCard) navigate(lastY < 0 ? 1 : -1)
      else resetDrag()
    }
    const cancel = () => { origin = null; gestureDragging = false; resetDrag() }
    stage.addEventListener('touchstart', start, { passive: true })
    stage.addEventListener('touchmove', move, { passive: false })
    stage.addEventListener('touchend', end)
    stage.addEventListener('touchcancel', cancel)
    return () => {
      stage.removeEventListener('touchstart', start)
      stage.removeEventListener('touchmove', move)
      stage.removeEventListener('touchend', end)
      stage.removeEventListener('touchcancel', cancel)
      if (origin && gestureDragging && !leavingRef.current && mountedRef.current) resetDrag()
      else cancelFrame()
    }
  }, [navigate, busy, leaving, editingDeduction, closeRequested, worker, index, resetDrag, cancelFrame, writeDrag, updateDirection])

  function goTo(nextIndex: number) {
    if (busy || leaving || editingDeduction || closeRequested) return
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex > workers.length || nextIndex === index) return
    resetDrag()
    updateDirection(nextIndex < index ? -1 : 1)
    setIndex(nextIndex)
    setArriving(true)
    setAttemptedNext(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  function openDeduction() {
    if (busy || leaving || locked) return
    stopMotion()
    setEditingDeduction(true)
  }

  function finishDeduction() {
    returnToDeductionRef.current = true
    setEditingDeduction(false)
  }

  function scrollCardDetails() {
    const scroller = scrollRef.current
    if (!scroller) return
    const nextTop = Math.min(scroller.scrollTop + scroller.clientHeight * .8, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTo({ top: cardAtBottom ? 0 : Math.max(0, nextTop), behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function requestClose() {
    if (busy) return
    if (closeRequested) { setCloseRequested(false); return }
    if (editingDeduction) { finishDeduction(); return }
    if (!dirty) { onClose(); return }
    stopMotion()
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
        <div key={worker?.id ?? 'review'} ref={motionRef} className={`labour-deck-motion ${worker ? 'has-worker' : ''} ${leaving ? 'is-leaving' : ''} ${dragging ? 'is-dragging' : ''} ${arriving ? 'is-arriving' : ''}`} style={{ '--swipe-exit': direction === 1 ? '-110%' : '110%', '--swipe-rotation': direction === 1 ? '-4deg' : '4deg', '--card-enter-y': direction === 1 ? '10px' : '-10px', '--swipe-duration': `${EXIT_DURATION}ms`, '--card-enter-duration': `${ARRIVAL_DURATION}ms` } as CSSProperties} onAnimationEnd={event => {
          if (event.target !== event.currentTarget) return
          if (event.animationName === 'labour-card-dismiss') finishNavigation()
          if (event.animationName === 'labour-card-arrive') setArriving(false)
        }}>
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
