import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function harness() {
  const handlers: Record<string, (event: any) => void> = {}
  const entries = new Map<string, Response>()
  const urlOf = (request: string | Request) => typeof request === 'string' ? request : request.url
  const cache = { put: vi.fn(async (request: string | Request, response: Response) => { entries.set(urlOf(request), response) }), match: vi.fn(async (request: string | Request) => entries.get(urlOf(request))), addAll: vi.fn(async () => {}) }
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['other-app-v1', 'coffee-estate-manager-v1', 'coffee-estate-manager:/estate/:v1', 'coffee-estate-manager:/estate/:v2']), delete: vi.fn(async (_key: string) => true) }
  const fetch = vi.fn(async () => new Response('public file'))
  const claim = vi.fn(async () => {})
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { URL, Date, Response, fetch, caches, self: { registration: { scope: 'https://estate.example/estate/' }, addEventListener: (name: string, handler: any) => { handlers[name] = handler }, clients: { claim }, skipWaiting: vi.fn() } })
  async function emit(name: string, properties: Record<string, unknown> = {}) {
    const work: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    handlers[name]({ ...properties, waitUntil: (promise: Promise<unknown>) => work.push(promise), respondWith: (promise: Promise<Response>) => { response = promise } })
    const result = response ? await response : undefined
    await Promise.all(work)
    return result
  }
  const request = (path: string, options?: RequestInit) => new Request(new URL(path, 'https://estate.example/estate/'), options)
  return { emit, request, cache, caches, fetch, entries, claim }
}
describe('public offline caching', () => {
  it('caches only app assets and never intercepts another origin, API or unrelated path', async () => {
    const worker = harness()
    await worker.emit('fetch', { request: worker.request('assets/index-123.js') })
    expect(worker.cache.put).toHaveBeenCalledOnce()
    for (const path of ['api/private-records', '/other-app/index.html', 'https://project.supabase.co/rest/v1/workers', 'https://api.open-meteo.com/v1/forecast']) {
      expect(await worker.emit('fetch', { request: worker.request(path) })).toBeUndefined()
    }
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect(await worker.emit('fetch', { request: worker.request('assets/index-123.js', { method: 'POST' }) })).toBeUndefined()
  })
  it('does not persist reset or notification URLs, authorized requests, or private responses', async () => {
    const worker = harness()
    for (const path of ['?code=private-reset-token', '?advanceWeek=2026-10-07', 'index.html?token=secret']) await worker.emit('fetch', { request: worker.request(path) })
    await worker.emit('fetch', { request: worker.request('assets/private.js', { headers: { Authorization: 'Bearer example-test-token' } }) })
    await worker.emit('fetch', { request: worker.request('assets/index.js', { cache: 'no-store' }) })
    worker.fetch.mockResolvedValueOnce(new Response('private', { headers: { 'Cache-Control': 'private, no-store' } }))
    await worker.emit('fetch', { request: worker.request('assets/index.js') })
    expect(worker.cache.put).not.toHaveBeenCalled()
  })
  it('falls back to cached public assets and to the generic shell for navigation', async () => {
    const worker = harness()
    worker.entries.set('https://estate.example/estate/index.html', new Response('generic shell'))
    worker.entries.set('https://estate.example/estate/assets/main.js', new Response('cached JS'))
    worker.fetch.mockRejectedValue(new Error('Offline'))
    expect(await (await worker.emit('fetch', { request: worker.request('assets/main.js') }))?.text()).toBe('cached JS')
    const resetRequest = { url: 'https://estate.example/estate/?code=private', method: 'GET', mode: 'navigate', headers: new Headers() }
    expect(await (await worker.emit('fetch', { request: resetRequest }))?.text()).toBe('generic shell')
    expect(worker.cache.put).not.toHaveBeenCalled()
  })
  it('still returns network files when browser cache storage is unavailable', async () => {
    const worker = harness()
    worker.caches.open.mockRejectedValue(new Error('Storage disabled'))
    expect(await (await worker.emit('fetch', { request: worker.request('assets/main.js') }))?.text()).toBe('public file')
  })
  it('installs the correct subpath shell and removes stale app caches only', async () => {
    const worker = harness()
    await worker.emit('install')
    expect(worker.cache.addAll).toHaveBeenCalledWith(['https://estate.example/estate/', 'https://estate.example/estate/index.html'])
    await worker.emit('activate')
    expect(worker.caches.delete.mock.calls.map(([key]) => key)).toEqual(['coffee-estate-manager-v1', 'coffee-estate-manager:/estate/:v1'])
    expect(worker.claim).toHaveBeenCalledOnce()
  })
})
