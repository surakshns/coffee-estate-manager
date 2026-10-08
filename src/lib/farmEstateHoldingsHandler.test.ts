import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEstateHoldingsHandler, type EstateHolderJob, type EstateHoldingsStatus } from '../../supabase/functions/_shared/farmEstateHoldingsHandler'
import { RtcLookupError, type RtcOwner, type RtcRecord } from '../../supabase/functions/_shared/farmRtc'

const secret = 'test-estate-sync-secret-at-least-thirty-two-characters'
const identity = { villageCode: '2301110012' as const, surveyNumber: '92', surnoc: '*', hissaNumber: '1' }
const holderName = 'N. C. Swami'
const owner: RtcOwner = { name: holderName, ownerNumber: '1', mainOwnerNumber: '1', fatherName: 'Private related name', category: null,
  extent: { acres: '2', guntas: '20', fractionalGuntas: '0' }, governmentRestriction: null, governmentRestrictionOwnerCategory: null, courtStay: null }
const record: RtcRecord = { identity, owners: [owner], villageName: 'Hebbasale', landCode: '1234', ulpin: null,
  extent: { acres: '4', guntas: '0', fractionalGuntas: '0' }, sourceUrl: 'https://rdservices.karnataka.gov.in/BhoomiMaps/', retrievedAt: '2026-10-08T10:00:00Z' }
const status: EstateHoldingsStatus = { holderName, configuredAt: '2026-10-08T10:00:00Z', matches: [], surveysTotal: 518,
  surveysChecked: 0, recordsChecked: 0, pending: 519, unavailable: 0, lastCheckedAt: null }
const browserRequest = (input: unknown = { mode: 'status' }, headers: Record<string, string> = {}) => new Request('https://example.test/estate', {
  method: 'POST', headers: { Authorization: 'Bearer valid-user-token', ...headers }, body: JSON.stringify(input)
})
const cronRequest = (input: unknown = { mode: 'sync' }, key = secret) => new Request('https://example.test/estate', {
  method: 'POST', headers: { 'x-farm-sync-secret': key }, body: JSON.stringify(input)
})
const job = (id = 1, kind: EstateHolderJob['kind'] = 'record'): EstateHolderJob => ({ id, kind, token: 'a-lease-token', userId: 'private-account-id', holderName,
  identity: kind === 'options' ? { ...identity, surnoc: '', hissaNumber: '' } : identity })
function setup() {
  const authenticate = vi.fn().mockResolvedValue('verified-user-id'), claimUserLookup = vi.fn().mockResolvedValue(true)
  const getStatus = vi.fn().mockResolvedValue(status), setProfile = vi.fn().mockResolvedValue(undefined)
  const claimJob = vi.fn().mockResolvedValue(null), finishJob = vi.fn().mockResolvedValue(true)
  const lookup = vi.fn().mockResolvedValue(record), options = vi.fn().mockResolvedValue({ identity: { villageCode: identity.villageCode, surveyNumber: identity.surveyNumber },
    entries: [{ surnoc: '*', hissaNumber: '1' }], sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt })
  const deps = { authenticate, claimUserLookup, getStatus, setProfile, claimJob, finishJob, lookup, options }
  return { ...deps, handler: createEstateHoldingsHandler(deps, secret), deps }
}
afterEach(() => { vi.useRealTimers() })

describe('private estate holdings endpoint', () => {
  it('authenticates status before reading private data and uses the verified account only', async () => {
    const deps = setup(), response = await deps.handler(browserRequest())
    expect(response.status).toBe(200); expect(await response.json()).toEqual(status)
    expect(deps.authenticate).toHaveBeenCalledWith('valid-user-token'); expect(deps.getStatus).toHaveBeenCalledWith('verified-user-id')
    expect(deps.lookup).not.toHaveBeenCalled(); expect(deps.claimJob).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    deps.getStatus.mockResolvedValue(null)
    expect(await (await deps.handler(browserRequest())).json()).toBeNull()
  })
  it('rejects missing, invalid and excessively long bearer tokens without reads or jobs', async () => {
    const deps = setup()
    expect((await deps.handler(new Request('https://example.test/estate', { method: 'POST', body: '{}' }))).status).toBe(401)
    expect((await deps.handler(browserRequest({}, { Authorization: `Bearer ${'x'.repeat(4096)}` }))).status).toBe(401)
    deps.authenticate.mockRejectedValue(new Error('private details'))
    expect((await deps.handler(browserRequest())).status).toBe(401)
    expect(deps.getStatus).not.toHaveBeenCalled(); expect(deps.claimJob).not.toHaveBeenCalled()
  })
  it('does not accept caller user IDs, URLs, holder searches or unknown modes', async () => {
    const deps = setup()
    for (const input of [{ mode: 'status', userId: 'another-user' }, { mode: 'status', url: 'https://evil.test' }, { mode: 'sync' }, { mode: 'search', holderName }, {}]) {
      expect((await deps.handler(browserRequest(input))).status).toBe(400)
    }
    expect(deps.getStatus).not.toHaveBeenCalled(); expect(deps.claimUserLookup).not.toHaveBeenCalled(); expect(deps.claimJob).not.toHaveBeenCalled()
  })
  it('checks the exact official RTC name before configuring, preserving its display spelling', async () => {
    const deps = setup(), response = await deps.handler(browserRequest({ mode: 'choose', identity, holderName: ' n c SWAMI ' }))
    expect(response.status).toBe(200); expect(deps.claimUserLookup).toHaveBeenCalledWith('verified-user-id')
    expect(deps.lookup).toHaveBeenCalledWith(identity)
    expect(deps.setProfile).toHaveBeenCalledWith('verified-user-id', holderName, identity, record)
    expect(deps.getStatus).toHaveBeenCalledWith('verified-user-id')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).not.toContain('Private related name')
  })
  it('rejects a name absent from the official record without modifying a profile', async () => {
    const deps = setup(), response = await deps.handler(browserRequest({ mode: 'choose', identity, holderName: 'Someone else' }))
    expect(response.status).toBe(409); expect(deps.setProfile).not.toHaveBeenCalled(); expect(deps.getStatus).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('Someone else')
  })
  it('rejects invalid identities, names and extra fields before official requests', async () => {
    const deps = setup()
    for (const input of [
      { mode: 'choose', identity: { ...identity, userId: 'someone' }, holderName },
      { mode: 'choose', identity: { ...identity, villageCode: 'foreign-village' }, holderName },
      { mode: 'choose', identity, holderName: '<b>Private name</b>' },
      { mode: 'choose', identity, holderName: 'x'.repeat(101) },
      { mode: 'choose', identity, holderName: '\u0000secret' },
      { mode: 'choose', identity, holderName: ' . ' },
      { mode: 'choose', identity, holderName, userId: 'other-user' }
    ]) expect((await deps.handler(browserRequest(input))).status).toBe(400)
    expect(deps.claimUserLookup).not.toHaveBeenCalled(); expect(deps.lookup).not.toHaveBeenCalled(); expect(deps.setProfile).not.toHaveBeenCalled()
  })
  it('limits choose calls and fails closed if the rate claim fails', async () => {
    const deps = setup(), input = { mode: 'choose', identity, holderName }
    deps.claimUserLookup.mockResolvedValue(false)
    const response = await deps.handler(browserRequest(input))
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60'); expect(deps.lookup).not.toHaveBeenCalled()
    deps.claimUserLookup.mockRejectedValue(new Error('internal account information'))
    expect((await deps.handler(browserRequest(input))).status).toBe(503); expect(deps.setProfile).not.toHaveBeenCalled()
  })
  it('returns generic failure when upstream is unavailable or returns another identity', async () => {
    const deps = setup(), input = { mode: 'choose', identity, holderName }
    deps.lookup.mockRejectedValue(new RtcLookupError('unavailable', 'private owner records and cookie'))
    const response = await deps.handler(browserRequest(input))
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private owner')
    deps.lookup.mockResolvedValue({ ...record, identity: { ...identity, hissaNumber: '2' } })
    expect((await deps.handler(browserRequest(input))).status).toBe(503); expect(deps.setProfile).not.toHaveBeenCalled()
  })
  it('bounds actual bytes and rejects malformed JSON without database mutation', async () => {
    const deps = setup()
    expect((await deps.handler(browserRequest({ mode: 'choose', identity, holderName: 'ಕ'.repeat(2000) }))).status).toBe(413)
    const malformed = new Request('https://example.test/estate', { method: 'POST', headers: { Authorization: 'Bearer valid' }, body: '{bad' })
    expect((await deps.handler(malformed)).status).toBe(400)
    expect(deps.claimUserLookup).not.toHaveBeenCalled(); expect(deps.getStatus).not.toHaveBeenCalled()
  })
  it('never exposes internal database errors', async () => {
    const deps = setup(); deps.getStatus.mockRejectedValue(new Error('secret key and holder name'))
    const response = await deps.handler(browserRequest())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret key')
  })
  it('supports CORS and rejects unsupported methods without authentication', async () => {
    const deps = setup()
    const preflight = await deps.handler(new Request('https://example.test/estate', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(200); expect(preflight.headers.get('Cache-Control')).toBe('no-store')
    expect((await deps.handler(new Request('https://example.test/estate'))).status).toBe(405)
    expect(deps.authenticate).not.toHaveBeenCalled()
  })
})

describe('bounded private estate matching worker', () => {
  it('checks an approved alias while keeping the primary name and private names out of worker responses', async () => {
    const deps = setup(), alias = 'Synthetic long recorded holder name'
    deps.claimJob.mockResolvedValueOnce({ ...job(), holderAliases: [alias] })
    deps.lookup.mockResolvedValue({ ...record, owners: [{ ...owner, name: alias }] })
    const response = await deps.handler(cronRequest())
    expect(response.status).toBe(200)
    expect(deps.finishJob).toHaveBeenCalledWith({ ...job(), holderAliases: [alias] }, { matches: true, acres: 2.5, landCode: '1234' }, expect.any(AbortSignal))
    const body = await response.text()
    expect(body).not.toContain(alias); expect(body).not.toContain(holderName)
  })
  it('rejects malformed or unbounded alias snapshots before official retrieval', async () => {
    const deps = setup()
    for (const aliases of [['<invalid>'], Array(11).fill('Synthetic alias')]) {
      deps.claimJob.mockResolvedValueOnce({ ...job(), holderAliases: aliases })
      expect((await deps.handler(cronRequest())).status).toBe(207)
    }
    expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('requires the configured secret and never treats a user token as a worker credential', async () => {
    const deps = setup()
    expect((await deps.handler(cronRequest(undefined, 'wrong-secret'))).status).toBe(401)
    expect((await deps.handler(browserRequest({ mode: 'sync' }, { 'x-farm-sync-secret': 'wrong-secret' }))).status).toBe(401)
    expect(deps.claimJob).not.toHaveBeenCalled()
    const unconfigured = createEstateHoldingsHandler(deps.deps, '')
    expect((await unconfigured(cronRequest({}, ''))).status).toBe(401)
  })
  it('allows only valid authenticated status when a stale cron secret is supplied', async () => {
    const deps = setup()
    expect((await deps.handler(browserRequest({ mode: 'status' }, { 'x-farm-sync-secret': 'wrong-secret' }))).status).toBe(200)
    expect((await deps.handler(browserRequest({ mode: 'choose', identity, holderName }, { 'x-farm-sync-secret': 'wrong-secret' }))).status).toBe(401)
    expect(deps.claimJob).not.toHaveBeenCalled(); expect(deps.setProfile).not.toHaveBeenCalled()
  })
  it('accepts no arbitrary jobs, owners or source URLs even with the valid cron secret', async () => {
    const deps = setup()
    for (const input of [{ mode: 'sync', userId: 'another-account' }, { mode: 'sync', url: 'https://evil.test' }, { mode: 'choose', holderName }]) {
      expect((await deps.handler(cronRequest(input))).status).toBe(400)
    }
    expect(deps.claimJob).not.toHaveBeenCalled(); expect(deps.authenticate).not.toHaveBeenCalled()
  })
  it('processes at most four sequential actions and returns counts without private records', async () => {
    const deps = setup(); let count = 0
    deps.claimJob.mockImplementation(async () => job(++count))
    const response = await deps.handler(cronRequest()), body = await response.text()
    expect(response.status).toBe(200); expect(JSON.parse(body)).toEqual({ claimed: 4, completed: 4, failed: 0, leaseRejected: 0 })
    expect(deps.claimJob).toHaveBeenCalledTimes(4); expect(deps.lookup).toHaveBeenCalledTimes(4)
    expect(deps.finishJob).toHaveBeenCalledWith(job(1), { matches: true, acres: 2.5, landCode: '1234' }, expect.any(AbortSignal))
    for (const privateValue of [holderName, owner.fatherName!, job().userId, record.landCode]) expect(body).not.toContain(privateValue)
    expect(deps.authenticate).not.toHaveBeenCalled(); expect(deps.getStatus).not.toHaveBeenCalled()
  })
  it('enumerates exact record identifiers without fetching or retaining owners', async () => {
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job(1, 'options'))
    const response = await deps.handler(cronRequest())
    expect(response.status).toBe(200)
    expect(deps.options).toHaveBeenCalledWith({ mode: 'options', villageCode: identity.villageCode, surveyNumber: identity.surveyNumber }, expect.any(AbortSignal))
    expect(deps.finishJob).toHaveBeenCalledWith(job(1, 'options'), [{ surnoc: '*', hissaNumber: '1' }], expect.any(AbortSignal)); expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('persists only a nonmatch and land reference when the target holder is absent', async () => {
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job())
    deps.lookup.mockResolvedValue({ ...record, owners: [{ ...owner, name: 'Different private holder' }] })
    expect((await deps.handler(cronRequest())).status).toBe(200)
    expect(deps.finishJob).toHaveBeenCalledWith(job(), { matches: false, acres: null, landCode: '1234' }, expect.any(AbortSignal))
  })
  it('marks unavailable lookups retryable without saving upstream exception text', async () => {
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job())
    deps.lookup.mockRejectedValue(new Error('private data with upstream session-cookie'))
    const response = await deps.handler(cronRequest())
    expect(response.status).toBe(207); expect(await response.json()).toEqual({ claimed: 1, completed: 0, failed: 1, leaseRejected: 0 })
    expect(deps.finishJob).toHaveBeenCalledWith(job(), null, expect.any(AbortSignal))
  })
  it('rejects results from a different parcel and stale job leases', async () => {
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job())
    deps.lookup.mockResolvedValue({ ...record, identity: { ...identity, surveyNumber: '93' } }); deps.finishJob.mockResolvedValue(false)
    const response = await deps.handler(cronRequest())
    expect(response.status).toBe(207); expect((await response.json()).leaseRejected).toBe(1)
    expect(deps.finishJob).toHaveBeenCalledWith(job(), null, expect.any(AbortSignal))
  })
  it('does not start another 20-second lookup after 22 seconds have elapsed', async () => {
    const deps = setup(); let elapsed = 0, count = 0
    deps.claimJob.mockImplementation(async () => job(++count))
    deps.lookup.mockImplementation(async () => { elapsed += 11_000; return record })
    const handler = createEstateHoldingsHandler({ ...deps.deps, now: () => elapsed }, secret)
    expect((await handler(cronRequest())).status).toBe(200)
    expect(deps.claimJob).toHaveBeenCalledTimes(2); expect(deps.lookup).toHaveBeenCalledTimes(2)
  })
  it('aborts outstanding official retrieval when the whole worker budget expires', async () => {
    vi.useFakeTimers()
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job())
    deps.lookup.mockImplementation((_input, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('Timed out')), { once: true })
    }))
    const running = deps.handler(cronRequest())
    await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(42_001)
    const response = await running
    expect(response.status).toBe(207); expect(deps.finishJob).toHaveBeenCalledWith(job(), null, expect.any(AbortSignal))
    expect(deps.claimJob).toHaveBeenCalledTimes(1)
  })
  it('bounds a stalled database claim and never starts a late upstream lookup', async () => {
    vi.useFakeTimers()
    const deps = setup(); deps.claimJob.mockImplementation(() => new Promise(() => {}))
    const running = deps.handler(cronRequest())
    await vi.waitFor(() => expect(deps.claimJob).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(42_001)
    expect((await running).status).toBe(503)
    expect(deps.claimJob.mock.calls[0][0].aborted).toBe(true); expect(deps.lookup).not.toHaveBeenCalled()
  })
  it('bounds a stalled completion RPC and leaves the interrupted lease for SQL retry', async () => {
    vi.useFakeTimers()
    const deps = setup(); deps.claimJob.mockResolvedValueOnce(job())
    deps.finishJob.mockImplementation(() => new Promise(() => {}))
    const running = deps.handler(cronRequest())
    await vi.waitFor(() => expect(deps.finishJob).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(42_001)
    expect((await running).status).toBe(503)
    expect(deps.finishJob.mock.calls[0][2].aborted).toBe(true); expect(deps.claimJob).toHaveBeenCalledTimes(1)
  })
})
