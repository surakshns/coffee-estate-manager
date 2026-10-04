import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function workerHarness() {
  const handlers: Record<string, (event: any) => void> = {}
  const showNotification = vi.fn(async () => {})
  const openWindow = vi.fn(async () => null)
  const matchAll = vi.fn(async () => [] as any[])
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Date,
    self: { addEventListener: (type: string, handler: (event: any) => void) => { handlers[type] = handler }, registration: { scope: 'https://estate.example/coffee-estate-manager/', showNotification }, clients: { openWindow, matchAll } }
  })
  async function emit(type: string, event: Record<string, unknown>) {
    let done: Promise<unknown> = Promise.resolve()
    handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => { done = promise } })
    await done
  }
  return { emit, showNotification, openWindow, matchAll }
}

describe('advance reminder service worker', () => {
  it('shows a generic reminder and builds its link inside the installed app scope', async () => {
    const worker = workerHarness()
    await worker.emit('push', { data: { json: () => ({ title: 'Worker private details', body: '₹50,000', tag: 'advance-2026-10-07', data: { weekStart: '2026-10-07', url: 'https://another.example/' } }) } })
    expect(worker.showNotification).toHaveBeenCalledWith('Weekly advance reminder', expect.objectContaining({
      body: 'This week’s advance still needs saving. Tap to finish it.', tag: 'advance-2026-10-07',
      icon: 'https://estate.example/coffee-estate-manager/icons/coffee-estate-192.png',
      data: { weekStart: '2026-10-07', url: 'https://estate.example/coffee-estate-manager/?advanceWeek=2026-10-07' }
    }))
  })

  it('ignores malformed payloads and non-Wednesday dates', async () => {
    const worker = workerHarness()
    await worker.emit('push', { data: { json: () => { throw new Error('Invalid JSON') } } })
    for (const weekStart of ['2026-10-08', '2026-02-30', 'invalid', null]) await worker.emit('push', { data: { json: () => ({ data: { weekStart } }) } })
    expect(worker.showNotification).not.toHaveBeenCalled()
  })

  it('focuses an existing app and lets it guard unsaved drafts without reloading', async () => {
    const worker = workerHarness()
    const existing = { url: 'https://estate.example/coffee-estate-manager/?other=value', focus: vi.fn(async () => {}), postMessage: vi.fn(), navigate: vi.fn() }
    worker.matchAll.mockResolvedValue([{ url: 'https://estate.example/other/', focus: vi.fn() }, existing])
    const close = vi.fn()
    await worker.emit('notificationclick', { notification: { close, data: { weekStart: '2026-10-07', url: 'https://another.example/' } } })
    expect(close).toHaveBeenCalledOnce()
    expect(existing.postMessage).toHaveBeenCalledWith({ type: 'OPEN_ADVANCE', weekStart: '2026-10-07' })
    expect(existing.focus).toHaveBeenCalledOnce()
    expect(existing.navigate).not.toHaveBeenCalled()
    expect(worker.openWindow).not.toHaveBeenCalled()
  })

  it('opens the requested week when the app is closed and ignores an invalid notification click', async () => {
    const worker = workerHarness()
    const close = vi.fn()
    await worker.emit('notificationclick', { notification: { close, data: { weekStart: '2026-10-07' } } })
    expect(worker.openWindow).toHaveBeenCalledWith('https://estate.example/coffee-estate-manager/?advanceWeek=2026-10-07')
    worker.openWindow.mockClear()
    await worker.emit('notificationclick', { notification: { close, data: { weekStart: '2026-10-08' } } })
    expect(worker.openWindow).not.toHaveBeenCalled()
  })
})
