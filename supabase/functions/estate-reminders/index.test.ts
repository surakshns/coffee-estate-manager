import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), configuration: vi.fn(), select: vi.fn(), eq: vi.fn() }))
vi.mock('../_shared/reminderRuntime.ts', () => ({
  adminClient: () => ({ auth: { getUser: api.getUser }, from: api.from }),
  pushConfiguration: api.configuration, corsHeaders: {},
  readBody: async (request: Request) => (await import('../_shared/requestBody')).readJsonBody(request),
  json: (body: unknown, status = 200) => Response.json(body, { status })
}))
let handler: (request: Request) => Promise<Response>
let activeCount = 1, paidCount = 0
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: (callback: typeof handler) => { handler = callback } })
  await import('./index')
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.clearAllMocks(); activeCount = 1; paidCount = 0
  api.getUser.mockResolvedValue({ data: { user: { id: 'verified-owner' } }, error: null })
  api.configuration.mockResolvedValue(null)
  api.from.mockImplementation((table: string) => {
    const result = () => ({ data: table === 'advance_push_subscriptions' ? [] : null, count: table === 'workers' ? activeCount : table === 'weekly_payments' ? paidCount : 0, error: null })
    const query = {
      select: (...args: unknown[]) => { api.select(table, ...args); return query },
      eq: (...args: unknown[]) => { api.eq(table, ...args); return query },
      limit: () => query, maybeSingle: async () => result(),
      then: (accept: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(accept, reject)
    }
    return query
  })
})
const request = () => new Request('https://example.invalid/estate-reminders', { method: 'POST', headers: { Authorization: 'Bearer example-test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', user_id: 'untrusted-owner' }) })
describe('account reminder status', () => {
  it('uses counts rather than row-limited payloads for large teams', async () => {
    activeCount = 1501
    const result = await handler(request())
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ weekStatus: 'not_saved' })
    expect(api.select).toHaveBeenCalledWith('workers', 'id', { count: 'exact', head: true })
    expect(api.select).toHaveBeenCalledWith('weekly_payments', 'id', { count: 'exact', head: true })
  })
  it('recognizes historical payments when every worker is now inactive', async () => {
    activeCount = 0; paidCount = 1501
    expect(await (await handler(request())).json()).toMatchObject({ weekStatus: 'needs_review' })
    paidCount = 0
    expect(await (await handler(request())).json()).toMatchObject({ weekStatus: 'no_workers' })
  })
  it('scopes privileged queries to the verified Auth user, ignoring a caller-supplied owner', async () => {
    await handler(request())
    expect(api.getUser).toHaveBeenCalledWith('example-test-token')
    for (const table of ['advance_reminder_settings', 'advance_push_subscriptions', 'weekly_pay_runs', 'weekly_payments', 'workers']) expect(api.eq).toHaveBeenCalledWith(table, 'user_id', 'verified-owner')
    expect(api.eq).not.toHaveBeenCalledWith(expect.anything(), 'user_id', 'untrusted-owner')
  })
  it('rejects an invalid session before querying private records', async () => {
    api.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Expired' } })
    expect((await handler(request())).status).toBe(401)
    expect(api.from).not.toHaveBeenCalled()
  })
  it('returns a client error for malformed or oversized input before querying records', async () => {
    const headers = { Authorization: 'Bearer example-test-token' }
    expect((await handler(new Request('https://example.invalid', { method: 'POST', headers, body: '[]' }))).status).toBe(400)
    expect((await handler(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify({ note: 'ಕ'.repeat(3000) }) }))).status).toBe(413)
    expect(api.from).not.toHaveBeenCalled()
  })
})
