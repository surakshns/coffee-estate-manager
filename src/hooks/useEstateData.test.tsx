// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEstateData } from './useEstateData'

type Request = { table: string; owner: string; from: number; to: number; signal: AbortSignal }
const api = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { from(table: string) {
    const request = { table } as Request
    const builder = {
      select: () => builder, eq: (_column: string, owner: string) => { request.owner = owner; return builder },
      order: () => builder, range: (from: number, to: number) => { request.from = from; request.to = to; return builder },
      abortSignal: (signal: AbortSignal) => { request.signal = signal; return builder },
      returns: () => api.read(request)
    }
    return builder
  } }
}))
const worker = (name: string) => ({ id: name, name, active: true, default_weekly_amount: 0 })
function pending() {
  let resolve!: (value: { data: unknown[]; error: unknown }) => void
  const promise = new Promise<{ data: unknown[]; error: unknown }>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => { vi.resetAllMocks(); api.read.mockResolvedValue({ data: [], error: null }) })
afterEach(cleanup)

describe('account record loading', () => {
  it('does not query before sign-in and scopes every read to the signed-in owner', async () => {
    const hook = renderHook(({ owner }) => useEstateData(owner), { initialProps: { owner: null as string | null } })
    expect(api.read).not.toHaveBeenCalled()
    hook.rerender({ owner: 'owner-a' })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(api.read).toHaveBeenCalledTimes(11)
    expect(api.read.mock.calls.every(([request]) => request.owner === 'owner-a')).toBe(true)
  })
  it('loads more than 1,000 rows using separate pages and normalizes joined categories', async () => {
    const records = Array.from({ length: 1203 }, (_, index) => worker(String(index)))
    api.read.mockImplementation((request: Request) => Promise.resolve({ data: request.table === 'workers' ? records.slice(request.from, request.to + 1) : request.table === 'expenses' ? [{ id: 'e', expense_categories: [{ name: 'Repairs' }] }] : [], error: null }))
    const hook = renderHook(() => useEstateData('owner-a'))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.data.workers).toHaveLength(1203)
    expect(api.read.mock.calls.filter(([request]) => request.table === 'workers').map(([request]) => request.from)).toEqual([0, 500, 1000])
    expect(hook.result.current.data.expenses[0].expense_categories).toEqual({ name: 'Repairs' })
  })
  it('clears the previous account while loading the next owner', async () => {
    const delayed = pending()
    api.read.mockImplementation((request: Request) => request.table === 'workers' ? request.owner === 'owner-a' ? Promise.resolve({ data: [worker('Asha')], error: null }) : delayed.promise : Promise.resolve({ data: [], error: null }))
    const hook = renderHook(({ owner }) => useEstateData(owner), { initialProps: { owner: 'owner-a' } })
    await waitFor(() => expect(hook.result.current.data.workers[0]?.name).toBe('Asha'))
    hook.rerender({ owner: 'owner-b' })
    expect(hook.result.current.data.workers).toEqual([])
    expect(hook.result.current.loadedAt).toBeNull()
    await act(async () => delayed.resolve({ data: [worker('Bala')], error: null }))
    expect(hook.result.current.data.workers[0].name).toBe('Bala')
  })
  it('ignores a superseded response even if the server completes it after cancellation', async () => {
    const delayed = pending()
    let reads = 0
    api.read.mockImplementation((request: Request) => request.table === 'workers' && ++reads === 1 ? delayed.promise : Promise.resolve({ data: request.table === 'workers' ? [worker('Latest')] : [], error: null }))
    const hook = renderHook(() => useEstateData('owner-a'))
    await act(async () => { await hook.result.current.refresh() })
    expect(hook.result.current.data.workers[0].name).toBe('Latest')
    await act(async () => delayed.resolve({ data: [worker('Stale')], error: null }))
    expect(hook.result.current.data.workers[0].name).toBe('Latest')
    expect(api.read.mock.calls[0][0].signal.aborted).toBe(true)
  })
  it('keeps loaded records during refresh and retains them when a refresh fails', async () => {
    api.read.mockImplementation((request: Request) => Promise.resolve({ data: request.table === 'workers' ? [worker('Asha')] : [], error: null }))
    const hook = renderHook(() => useEstateData('owner-a'))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    const delayed = pending()
    api.read.mockImplementation((request: Request) => request.table === 'workers' ? delayed.promise : Promise.resolve({ data: [], error: null }))
    let refreshing!: Promise<void>
    act(() => { refreshing = hook.result.current.refresh() })
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.refreshing).toBe(true)
    expect(hook.result.current.data.workers[0].name).toBe('Asha')
    await act(async () => { delayed.resolve({ data: [], error: { message: 'Connection unavailable' } }); await refreshing })
    expect(hook.result.current.error).toBe('Connection unavailable')
    expect(hook.result.current.data.workers[0].name).toBe('Asha')
    expect(hook.result.current.loadedAt).not.toBeNull()
    api.read.mockResolvedValue({ data: [], error: null })
    await act(async () => { await hook.result.current.refresh() })
    expect(hook.result.current.error).toBe('')
  })
  it('cannot restore records after logout from an outstanding request', async () => {
    const delayed = pending()
    api.read.mockImplementation((request: Request) => request.table === 'workers' ? delayed.promise : Promise.resolve({ data: [], error: null }))
    const hook = renderHook(({ owner }) => useEstateData(owner), { initialProps: { owner: 'owner-a' as string | null } })
    hook.rerender({ owner: null })
    await act(async () => delayed.resolve({ data: [worker('Private')], error: null }))
    expect(hook.result.current.data.workers).toEqual([])
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.error).toBe('')
  })
})
