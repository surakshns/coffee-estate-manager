// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileWeeklyPayDeck } from './MobileWeeklyPayDeck'

type Props = ComponentProps<typeof MobileWeeklyPayDeck>
const workers = [
  { id: 'ravi', name: 'Ravi', active: true, default_weekly_amount: 2250 },
  { id: 'meena', name: 'Meena', active: true, default_weekly_amount: 2250 },
]
const props = (overrides: Partial<Props> = {}): Props => ({
  dateLabel: 'Wednesday, 7 Oct', workers, busy: false, locked: false, saved: false, dirty: false, error: '', includedCount: 2, workingDays: 10, wages: 4500, takeHome: 4500,
  renderWorker: vi.fn((worker, onEditDeduction) => <article><h3>{worker.name}</h3><button type="button" data-loan-deduction-trigger onClick={onEditDeduction}>Deduction for {worker.name}</button></article>),
  renderDeduction: (worker, onDone) => <section><h3>Deduction for {worker.name}</h3><button type="button" onClick={onDone}>Done</button></section>,
  workerError: () => '', onClose: vi.fn(), onDiscard: vi.fn(), onSave: vi.fn(), ...overrides,
})

let frames: Map<number, FrameRequestCallback>
let frameNumber = 0
const touch = (dy = 0) => ({ clientX: 60, clientY: 200 + dy })
const start = (target: HTMLElement) => fireEvent.touchStart(target, { touches: [touch()] })
const move = (target: HTMLElement, dy: number) => fireEvent.touchMove(target, { touches: [touch(dy)], cancelable: true })
const end = (target: HTMLElement) => fireEvent.touchEnd(target, { touches: [], changedTouches: [touch()] })
function finishAnimation(target: HTMLElement, name: string) {
  // jsdom omits AnimationEvent; React may therefore register the WebKit name.
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'animationName', { value: name })
    fireEvent(target, event)
  }
}
function flushFrames() {
  act(() => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(performance.now()))
  })
}
const motion = () => screen.getByRole('dialog').querySelector<HTMLDivElement>('.labour-deck-motion')!

beforeEach(() => {
  frames = new Map()
  frameNumber = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { const id = ++frameNumber; frames.set(id, callback); return id })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('phone weekly pay swipe motion', () => {
  it('coalesces drag samples into one frame without rerendering the worker for each movement', () => {
    const options = props()
    render(<MobileWeeklyPayDeck {...options} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -12)
    flushFrames()
    const count = vi.mocked(options.renderWorker).mock.calls.length
    for (let dy = -14; dy >= -70; dy -= 2) move(target, dy)
    expect(frames.size).toBe(1)
    expect(vi.mocked(options.renderWorker).mock.calls.length).toBe(count)
    flushFrames()
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('-70px')
    expect(vi.mocked(options.renderWorker).mock.calls.length).toBe(count)
    end(target)
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
  })

  it('settles a short or cancelled swipe without replaying arrival or applying a stale frame', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -35)
    flushFrames()
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('-35px')
    end(target)
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    expect(motion().classList.contains('is-arriving')).toBe(false)
    expect(motion().classList.contains('is-leaving')).toBe(false)
    start(target)
    move(target, -120)
    expect(frames.size).toBe(1)
    fireEvent.touchCancel(target)
    expect(frames.size).toBe(0)
    flushFrames()
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
  })

  it('removes drag mode when a quick gesture ends before React commits its start', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    finishAnimation(motion(), 'labour-card-arrive')
    const target = screen.getByRole('heading', { name: 'Ravi' })
    act(() => { start(target); move(target, -25); end(target) })
    expect(motion().classList.contains('is-dragging')).toBe(false)
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    expect(frames.size).toBe(0)
  })

  it('settles an active gesture when refreshed worker validation replaces its handlers', () => {
    const options = props()
    const view = render(<MobileWeeklyPayDeck {...options} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -60)
    flushFrames()
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('-60px')
    view.rerender(<MobileWeeklyPayDeck {...options} workerError={() => 'Check this worker’s deduction.'} />)
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    expect(motion().classList.contains('is-dragging')).toBe(false)
    end(target)
    expect(motion().classList.contains('is-leaving')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
  })

  it('flushes the final unpainted sample into the exit and changes cards on its own animation completion', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -115)
    expect(frames.size).toBe(1)
    end(target)
    const exiting = motion()
    expect(frames.size).toBe(0)
    expect(exiting.style.getPropertyValue('--swipe-y')).toBe('-115px')
    expect(exiting.classList.contains('is-leaving')).toBe(true)
    finishAnimation(target, 'labour-card-dismiss')
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
    finishAnimation(exiting, 'labour-card-dismiss')
    expect(screen.getByRole('heading', { name: 'Meena' })).toBeTruthy()
    expect(motion().classList.contains('is-arriving')).toBe(true)
    expect(motion().classList.contains('is-leaving')).toBe(false)
  })

  it('accepts a short deliberate flick while a short slow gesture stays on the same worker', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    vi.mocked(performance.now).mockReturnValue(250)
    move(target, -45)
    vi.mocked(performance.now).mockReturnValue(280)
    end(target)
    expect(motion().classList.contains('is-leaving')).toBe(false)
    vi.mocked(performance.now).mockReturnValue(300)
    start(target)
    vi.mocked(performance.now).mockReturnValue(320)
    move(target, -20)
    vi.mocked(performance.now).mockReturnValue(340)
    move(target, -40)
    vi.mocked(performance.now).mockReturnValue(360)
    end(target)
    expect(motion().classList.contains('is-leaving')).toBe(true)
    finishAnimation(motion(), 'labour-card-dismiss')
    expect(screen.getByRole('heading', { name: 'Meena' })).toBeTruthy()
  })

  it('keeps a control tap working after suppressing its compatibility click from a drag', () => {
    const tapped = vi.fn()
    render(<MobileWeeklyPayDeck {...props({ renderWorker: worker => <article><h3>{worker.name}</h3><button onClick={tapped}>Days for {worker.name}</button></article> })} />)
    const control = screen.getByRole('button', { name: 'Days for Ravi' })
    start(control)
    move(control, -40)
    end(control)
    fireEvent.click(control)
    expect(tapped).not.toHaveBeenCalled()
    start(control)
    end(control)
    fireEvent.click(control)
    expect(tapped).toHaveBeenCalledOnce()
  })

  it('cancels pending movement when the week starts saving and when the deck unmounts', () => {
    const options = props()
    const view = render(<MobileWeeklyPayDeck {...options} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -120)
    expect(frames.size).toBe(1)
    view.rerender(<MobileWeeklyPayDeck {...options} busy />)
    expect(frames.size).toBe(0)
    flushFrames()
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    expect(motion().classList.contains('is-leaving')).toBe(false)
    view.rerender(<MobileWeeklyPayDeck {...options} />)
    start(target)
    move(target, -110)
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
    flushFrames()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels a queued drag before opening deduction entry', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    const heading = screen.getByRole('heading', { name: 'Ravi' })
    start(heading)
    move(heading, -20)
    fireEvent.click(screen.getByRole('button', { name: 'Deduction for Ravi' }))
    expect(frames.size).toBe(0)
    flushFrames()
    expect(screen.getByRole('heading', { name: 'Deduction for Ravi' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Meena' })).toBeNull()
  })

  it('cancels an active drag as soon as a second finger joins', () => {
    render(<MobileWeeklyPayDeck {...props()} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -60)
    expect(frames.size).toBe(1)
    fireEvent.touchStart(target, { touches: [touch(-60), { clientX: 100, clientY: 140 }] })
    expect(frames.size).toBe(0)
    expect(motion().style.getPropertyValue('--swipe-y')).toBe('0px')
    end(target)
    expect(motion().classList.contains('is-leaving')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
  })

  it('advances without waiting for animation when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    render(<MobileWeeklyPayDeck {...props()} />)
    const target = screen.getByRole('heading', { name: 'Ravi' })
    start(target)
    move(target, -100)
    end(target)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Meena' })).toBeTruthy())
  })
})
