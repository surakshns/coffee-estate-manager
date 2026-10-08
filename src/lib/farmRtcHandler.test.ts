import { describe, expect, it, vi } from 'vitest'
import { createRtcLookupHandler } from '../../supabase/functions/_shared/farmRtcHandler'
import { RtcLookupError } from '../../supabase/functions/_shared/farmRtc'
const body = { villageCode: '2301110012', surveyNumber: '92', surnoc: '*', hissaNumber: '1' }
const request = (value: unknown = body, token = 'valid') => new Request('https://example.test/rtc', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(value) })
function setup() {
  const authenticate = vi.fn().mockResolvedValue('user-id'), claim = vi.fn().mockResolvedValue(true), lookup = vi.fn().mockResolvedValue({ identity: body, owners: [] }), options = vi.fn().mockResolvedValue({ identity: { villageCode: body.villageCode, surveyNumber: body.surveyNumber }, entries: [{ surnoc: '*', hissaNumber: '1A' }] })
  return { authenticate, claim, lookup, options, handler: createRtcLookupHandler({ authenticate, claim, lookup, options }) }
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
  it('refreshes private markers for the authenticated account without blocking verified RTC display',async()=>{
    const deps=setup(),onRecord=vi.fn().mockResolvedValue(undefined)
    const handler=createRtcLookupHandler({...deps,onRecord})
    expect((await handler(request())).status).toBe(200)
    expect(onRecord).toHaveBeenCalledWith('user-id',{identity:body,owners:[]})
    onRecord.mockRejectedValue(new Error('private saved-name metadata'))
    const response=await handler(request())
    expect(response.status).toBe(200);expect(await response.text()).not.toContain('private saved-name')
  })
  it('authenticates and rate limits options with the same protections, without fetching owners', async () => {
    const deps = setup(), input = { mode: 'options', villageCode: body.villageCode, surveyNumber: body.surveyNumber }
    const response = await deps.handler(request(input))
    expect(response.status).toBe(200); expect(deps.options).toHaveBeenCalledWith(input); expect(deps.lookup).not.toHaveBeenCalled()
    expect(deps.claim).toHaveBeenCalledWith('user-id'); expect(response.headers.get('Cache-Control')).toBe('no-store')
    deps.claim.mockResolvedValue(false)
    expect((await deps.handler(request(input))).status).toBe(429)
    expect(deps.options).toHaveBeenCalledTimes(1)
  })
  it('rejects extra options fields and unknown modes before a claim', async () => {
    const deps = setup()
    expect((await deps.handler(request({ mode: 'options', villageCode: body.villageCode, surveyNumber: body.surveyNumber, owner: 'someone' }))).status).toBe(400)
    expect((await deps.handler(request({ ...body, mode: 'owner-search' }))).status).toBe(400)
    expect(deps.options).not.toHaveBeenCalled(); expect(deps.claim).not.toHaveBeenCalled()
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
