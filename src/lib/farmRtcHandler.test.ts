import { describe, expect, it, vi } from 'vitest'
import { createRtcLookupHandler } from '../../supabase/functions/_shared/farmRtcHandler'
import { RtcLookupError } from '../../supabase/functions/_shared/farmRtc'
const body = { villageCode: '2301110012', surveyNumber: '92', surnoc: '*', hissaNumber: '1' }
const request = (value: unknown = body, token = 'valid') => new Request('https://example.test/rtc', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(value) })
function setup() {
  const authenticate = vi.fn().mockResolvedValue('user-id'), claim = vi.fn().mockResolvedValue(true), lookup = vi.fn().mockResolvedValue({ identity: body, owners: [] })
  return { authenticate, claim, lookup, handler: createRtcLookupHandler({ authenticate, claim, lookup }) }
}
describe('signed-in RTC endpoint', () => {
  it('requires a valid authenticated identity before touching upstream or limits', async () => {
    const deps = setup(); deps.authenticate.mockResolvedValue(null)
    const result = await deps.handler(request())
    expect(result.status).toBe(401); expect(deps.claim).not.toHaveBeenCalled(); expect(deps.lookup).not.toHaveBeenCalled()
    expect((await deps.handler(new Request('https://example.test/rtc', { method: 'POST' }))).status).toBe(401)
  })
  it('uses only the authenticated user ID for the rate claim', async () => {
    const deps = setup(); const response = await deps.handler(request())
    expect(response.status).toBe(200); expect(deps.claim).toHaveBeenCalledWith('user-id'); expect(deps.lookup).toHaveBeenCalledWith(body)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect((await deps.handler(request({ ...body, userId: 'someone-else' }))).status).toBe(400)
  })
  it('rejects large, malformed or foreign-village requests before a claim', async () => {
    const deps = setup()
    expect((await deps.handler(request({ ...body, villageCode: 'elsewhere' }))).status).toBe(400)
    expect((await deps.handler(request('x'.repeat(3000)))).status).toBe(413)
    expect(deps.claim).not.toHaveBeenCalled(); expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('limits requests and gives a retry hint without upstream calls', async () => {
    const deps = setup(); deps.claim.mockResolvedValue(false)
    const response = await deps.handler(request())
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60'); expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('fails closed when the counter cannot be checked', async () => {
    const deps = setup(); deps.claim.mockRejectedValue(new Error('sensitive internal details'))
    const response = await deps.handler(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive'); expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('returns safe upstream errors without exposing raw records', async () => {
    const deps = setup(); deps.lookup.mockRejectedValue(new Error('owner-data-and-session-cookie'))
    const response = await deps.handler(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('owner-data')
    deps.lookup.mockRejectedValue(new RtcLookupError('unavailable', 'Official record unavailable.'))
    expect((await deps.handler(request())).status).toBe(503)
  })
  it('handles CORS and rejects unsupported methods without authentication', async () => {
    const deps = setup()
    expect((await deps.handler(new Request('https://example.test/rtc', { method: 'OPTIONS' }))).status).toBe(200)
    expect((await deps.handler(new Request('https://example.test/rtc'))).status).toBe(405)
    expect(deps.authenticate).not.toHaveBeenCalled()
  })
})
