import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ admin: { rpc: vi.fn(), from: vi.fn() }, config: vi.fn(), send: vi.fn(), authorized: vi.fn() }))
vi.mock('../_shared/reminderRuntime.ts', () => ({
  adminClient: () => runtime.admin,
  pushConfiguration: runtime.config,
  sendPush: runtime.send,
  validCronSecret: runtime.authorized,
  json: (body: unknown, status = 200) => Response.json(body, { status })
}))

let handler: (request: Request) => Promise<Response>
const now = Date.parse('2026-10-08T14:31:00Z')
const endpoint = 'https://web.push.apple.com/phone-one'
const claimed = { delivery_id: 'delivery-one', owner_id: 'owner', week_start: '2026-09-30', subscription_id: 'phone-one', endpoint, p256dh: 'key', auth: 'auth' }
const fixtures: Record<string, unknown> = {}

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: (callback: typeof handler) => { handler = callback } })
  await import('./index')
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  runtime.authorized.mockResolvedValue(true)
  runtime.config.mockResolvedValue({ ready: true, appUrl: 'https://estate.example/coffee-estate-manager/' })
  runtime.send.mockResolvedValue({ status: 201 })
  runtime.admin.rpc.mockImplementation(async name => ({ data: name === 'claim_due_advance_reminders' ? [claimed] : null, error: null }))
  fixtures.advance_reminder_settings = { enabled: true, revision: 2, updated_at: '2026-10-07T12:00:00Z', weekday: 4, reminder_time: '20:00:00' }
  fixtures.weekly_pay_runs = null
  fixtures.advance_push_subscriptions = { id: 'phone-one', user_id: 'owner', endpoint, p256dh: 'key', auth: 'auth', expiration_time: null, connected_at: '2026-10-07T12:00:00Z' }
  fixtures.workers = [{ id: 'worker', active: true }]
  fixtures.weekly_payments = []
  fixtures.advance_reminder_deliveries = { status: 'sending', kind: 'payment', scheduled_at: '2026-10-08T14:30:00Z', settings_revision: 2 }
  runtime.admin.from.mockImplementation(table => {
    const result = () => ({ data: fixtures[table], error: null })
    const query = {
      select: () => query, eq: () => query, delete: () => query,
      maybeSingle: async () => result(),
      then: (accept: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(accept, reject)
    }
    return query
  })
})

const request = () => new Request('https://server.example/send-estate-reminders', { method: 'POST' })

describe('scheduled reminder sender', () => {
  it('delivers a pending older week with the exact payment link and records success', async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ claimed: 1, sent: 1, cancelled: 0 })
    expect(runtime.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ endpoint }), expect.objectContaining({
      title: 'Weekly advance reminder',
      data: { weekStart: '2026-09-30', url: 'https://estate.example/coffee-estate-manager/?advanceWeek=2026-09-30' }
    }), 'advance-2026-09-30')
    expect(runtime.admin.rpc).toHaveBeenLastCalledWith('finish_advance_reminder', { p_id: 'delivery-one', p_status: 'sent', p_http_status: 201 })
  })

  it('delivers a reschedule confirmation even after payment is saved and there are no workers', async () => {
    fixtures.weekly_pay_runs = { week_start: '2026-09-30' }
    fixtures.workers = []
    fixtures.advance_reminder_deliveries = { status: 'sending', kind: 'rescheduled', scheduled_at: '2026-10-08T14:30:00Z', settings_revision: 2 }
    const response = await handler(request())
    expect(await response.json()).toMatchObject({ sent: 1, cancelled: 0 })
    expect(runtime.send).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      title: 'Weekly reminder rescheduled',
      body: 'Reminder moved to Thursday at 8:00 PM IST. Repeats daily until the weekly payment is saved.',
      data: expect.objectContaining({ kind: 'rescheduled', weekday: 4, time: '20:00' })
    }), 'advance-schedule')
  })

  it('stops the remaining phones if the weekly payment is saved after the first push', async () => {
    runtime.admin.rpc.mockImplementation(async name => ({ data: name === 'claim_due_advance_reminders' ? [claimed, { ...claimed, delivery_id: 'delivery-two' }] : null, error: null }))
    runtime.send.mockImplementation(async () => {
      fixtures.weekly_pay_runs = { week_start: '2026-09-30' }
      return { status: 201 }
    })
    const response = await handler(request())
    expect(await response.json()).toMatchObject({ claimed: 2, sent: 1, cancelled: 1 })
    expect(runtime.send).toHaveBeenCalledOnce()
    expect(runtime.admin.rpc).toHaveBeenLastCalledWith('finish_advance_reminder', { p_id: 'delivery-two', p_status: 'cancelled', p_http_status: null })
  })

  it('cancels stale schedule revisions without sending their previous confirmation', async () => {
    fixtures.advance_reminder_settings = { enabled: true, revision: 3, updated_at: '2026-10-08T14:30:30Z', weekday: 5, reminder_time: '21:00:00' }
    fixtures.advance_reminder_deliveries = { status: 'sending', kind: 'rescheduled', scheduled_at: '2026-10-08T14:30:00Z', settings_revision: 2 }
    const response = await handler(request())
    expect(await response.json()).toMatchObject({ sent: 0, cancelled: 1 })
    expect(runtime.send).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated scheduler requests before reading records', async () => {
    runtime.authorized.mockResolvedValue(false)
    expect((await handler(request())).status).toBe(401)
    expect(runtime.admin.rpc).not.toHaveBeenCalled()
    expect(runtime.send).not.toHaveBeenCalled()
  })
})
