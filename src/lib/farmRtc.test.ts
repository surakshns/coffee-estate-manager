import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupRtcRecord, parseRtcRecord, RtcLookupError, RTC_SOURCE_URL, validateRtcLookupRequest, type RtcLookupRequest } from '../../supabase/functions/_shared/farmRtc'

// Entirely synthetic identifiers and names. No retrieved RTC owner data is kept.
const request: RtcLookupRequest = { villageCode: '2301110012', surveyNumber: '41', surnoc: '*', hissaNumber: '1' }
function record(input = request) {
  const identity = { hobli_code: 11, village_code: input.villageCode === '2301110012' ? 12 : 38,
    land_code: 999999, survey_no: input.surveyNumber, surnoc: input.surnoc, hissa_no: input.hissaNumber }
  return {
    Table: [{ ...identity, distcode: 23, talukcode: 1, ext_acre: '2', ext_gunta: '10', ext_fgunta: '0.25', ULPIN: 'SYNTHETIC1234', vlgname: 'Synthetic village' }],
    Table1: [{ ...identity, owner_no: 1, owner: 'Synthetic owner', owner_sex: 'excluded', owner_cat: 2,
      father: 'Synthetic parent', main_owner_no: 1, ext_acre: '2', ext_gunta: '10', ext_fgunta: '0.25',
      govt_restrict: 0, govt_rest_own_cat: 0, court_stay: '0', unknown: '<script>never returned</script>' }],
    Table2: [{ geometry: 'not included' }]
  }
}
const json = (data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(JSON.stringify(data)), { headers: { 'content-type': 'application/json', ...headers } })
function successfulFetcher(input = request) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(json([{ survey_no: input.surveyNumber, surnoc: input.surnoc }], { 'set-cookie': 'ASP.NET_SessionId=synthetic_session; Path=/; HttpOnly' }))
    .mockResolvedValueOnce(json([{ hissa_no: '*' }, { hissa_no: 'XX' }, { hissa_no: input.hissaNumber }]))
    .mockResolvedValueOnce(json(record(input)))
}
afterEach(() => vi.useRealTimers())

describe('strict RTC request and identity validation', () => {
  it('allows only the two reviewed villages and canonical positive survey/hissa strings', () => {
    expect(validateRtcLookupRequest({ ...request, surveyNumber: '000041', hissaNumber: '001' })).toEqual(request)
    expect(validateRtcLookupRequest({ ...request, villageCode: '2301110038', surnoc: 'A/2' }).villageCode).toBe('2301110038')
  })
  it.each([
    null, [], { ...request, villageCode: '2301119999' }, { ...request, surveyNumber: '0' },
    { ...request, surveyNumber: '1234567' }, { ...request, surveyNumber: '4.1' },
    { ...request, hissaNumber: '*' }, { ...request, hissaNumber: '12345678901' },
    { ...request, surnoc: '<script>' }, { ...request, surnoc: 'a'.repeat(21) },
    { ...request, sourceUrl: 'https://attacker.invalid/' }, { ...request, surveyNumber: 41 }
  ])('rejects invalid or caller-controlled request fields', input => {
    expect(() => validateRtcLookupRequest(input)).toThrow(RtcLookupError)
    try { validateRtcLookupRequest(input) } catch (error) { expect((error as RtcLookupError).kind).toBe('invalid_request') }
  })
  it('parses double-encoded responses, preserves exact source extents and strips unneeded fields', () => {
    const output = parseRtcRecord(JSON.stringify(JSON.stringify(record())), request, '2026-10-08T00:00:00.000Z')
    expect(output).toMatchObject({ identity: request, landCode: '999999', extent: { acres: '2', guntas: '10', fractionalGuntas: '0.25' },
      owners: [{ name: 'Synthetic owner', fatherName: 'Synthetic parent', category: '2', governmentRestriction: '0', courtStay: '0' }],
      sourceUrl: RTC_SOURCE_URL, retrievedAt: '2026-10-08T00:00:00.000Z' })
    expect(output.owners[0]).not.toHaveProperty('owner_sex')
    expect(output.owners[0]).not.toHaveProperty('unknown')
    expect(output).not.toHaveProperty('Table2')
  })
  it('accepts numeric and leading-zero official identifiers without changing extent strings', () => {
    const data = record()
    data.Table[0].survey_no = '000041'; data.Table[0].hissa_no = '001'
    data.Table1[0].hissa_no = '0001'
    data.Table[0].ext_acre = '02.00'
    expect(parseRtcRecord(data, request).extent.acres).toBe('02.00')
  })
  it.each(['distcode', 'talukcode', 'hobli_code', 'village_code', 'survey_no', 'surnoc', 'hissa_no'])('rejects a different parcel header %s', field => {
    const data = record()
    ;(data.Table[0] as Record<string, unknown>)[field] = field === 'surnoc' ? 'B' : 99
    expect(() => parseRtcRecord(data, request)).toThrow(RtcLookupError)
  })
  it.each(['hobli_code', 'village_code', 'land_code', 'survey_no', 'surnoc', 'hissa_no'])('rejects a different owner parcel %s', field => {
    const data = record()
    ;(data.Table1[0] as Record<string, unknown>)[field] = field === 'surnoc' ? 'B' : 99
    expect(() => parseRtcRecord(data, request)).toThrow(RtcLookupError)
  })
  it('rejects HTML in returned fields and invalid numeric extents', () => {
    const html = record(); html.Table1[0].owner = '<img src=x onerror=alert(1)>'
    expect(() => parseRtcRecord(html, request)).toThrow(RtcLookupError)
    const invalidExtent = record(); invalidExtent.Table[0].ext_gunta = '-1'
    expect(() => parseRtcRecord(invalidExtent, request)).toThrow(RtcLookupError)
  })
  it('never invents missing owner details, codes, ULPIN or extents', () => {
    const data = record() as unknown as { Table: Record<string, unknown>[]; Table1: Record<string, unknown>[] }
    data.Table[0].ULPIN = null; data.Table[0].ext_fgunta = null
    data.Table1[0].father = null; data.Table1[0].owner_cat = null
    expect(parseRtcRecord(data, request)).toMatchObject({ ulpin: null, extent: { fractionalGuntas: null }, owners: [{ fatherName: null, category: null }] })
  })
  it.each(['Nodata', '<html>service failure</html>', { status: 'Failure', message: 'do not expose server details' }, { Table: [], Table1: [] }, { Table: [{}, {}], Table1: [] }])('rejects no-data, changed layouts and service errors', data => {
    expect(() => parseRtcRecord(data, request)).toThrow(RtcLookupError)
  })
  it('rejects owner lists beyond the response limit', () => {
    const data = record(); data.Table1 = Array.from({ length: 101 }, () => data.Table1[0])
    expect(() => parseRtcRecord(data, request)).toThrow(RtcLookupError)
  })
})

describe('private fixed-origin RTC lookup', () => {
  it('uses the exact three POST steps and carries the isolated session cookie', async () => {
    const fetcher = successfulFetcher()
    const output = await lookupRtcRecord(request, fetcher)
    expect(output.owners[0].name).toBe('Synthetic owner')
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['GetSurnoc', 'GetHissaNo', 'GetRTCDataforSearch'].map(step => `${RTC_SOURCE_URL}Default/${step}`))
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit' })
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Cookie')).toBe(false)
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Cookie')).toBe('ASP.NET_SessionId=synthetic_session')
    expect(Object.fromEntries((fetcher.mock.calls[1][1]?.body as FormData).entries())).toEqual({ surnoc: '*' })
    expect(Object.fromEntries((fetcher.mock.calls[2][1]?.body as FormData).entries())).toEqual({ Dist: '23', Taluk: '1', Hobli: '11', Village: '12', Surveyno: '41', Surnoc: '*', Hissano: '1' })
  })
  it('does not continue without a verified survey/surnoc and issued session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([{ survey_no: '42', surnoc: '*' }], { 'set-cookie': 'ASP.NET_SessionId=synthetic_session; Path=/' }))
    await expect(lookupRtcRecord(request, fetcher)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const noSession = vi.fn<typeof fetch>().mockResolvedValue(json([{ survey_no: '41', surnoc: '*' }]))
    await expect(lookupRtcRecord(request, noSession)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(noSession).toHaveBeenCalledTimes(1)
  })
  it('rejects a hissa missing from the official options before requesting owners', async () => {
    const fetcher = successfulFetcher()
    fetcher.mockReset().mockResolvedValueOnce(json([{ survey_no: '41', surnoc: '*' }], { 'set-cookie': 'ASP.NET_SessionId=synthetic_session; Path=/' }))
      .mockResolvedValueOnce(json([{ hissa_no: '2' }]))
    await expect(lookupRtcRecord(request, fetcher)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('keeps separate cookies for simultaneous lookups', async () => {
    const second: RtcLookupRequest = { ...request, surveyNumber: '42', villageCode: '2301110038' }
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      const form = options?.body as FormData
      if (String(url).endsWith('GetSurnoc')) {
        const survey = String(form.get('Surveyno'))
        return json([{ survey_no: survey, surnoc: '*' }], { 'set-cookie': `ASP.NET_SessionId=session_${survey}; Path=/` })
      }
      const cookie = new Headers(options?.headers).get('Cookie')
      const selected = cookie === 'ASP.NET_SessionId=session_41' ? request : second
      expect(['ASP.NET_SessionId=session_41', 'ASP.NET_SessionId=session_42']).toContain(cookie)
      return String(url).endsWith('GetHissaNo') ? json([{ hissa_no: '1' }]) : json(record(selected))
    })
    const [one, two] = await Promise.all([lookupRtcRecord(request, fetcher), lookupRtcRecord(second, fetcher)])
    expect(one.identity).toEqual(request); expect(two.identity).toEqual(second)
  })
  it('rejects oversized declared and streamed responses', async () => {
    const declared = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { headers: { 'content-length': '262145' } }))
    await expect(lookupRtcRecord(request, declared)).rejects.toMatchObject({ kind: 'unavailable' })
    const streamed = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(262145)); controller.close() } })))
    await expect(lookupRtcRecord(request, streamed)).rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('rejects redirects and source errors without exposing their response content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream error', { status: 302, headers: { location: 'https://attacker.invalid/' } }))
    await expect(lookupRtcRecord(request, fetcher)).rejects.toThrow('The official RTC record is unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('uses one total timeout across the workflow and never retries', async () => {
    vi.useFakeTimers()
    const fetcher = successfulFetcher()
    fetcher.mockReset().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const result = lookupRtcRecord(request, fetcher)
    const check = expect(result).rejects.toMatchObject({ kind: 'unavailable' })
    await vi.advanceTimersByTimeAsync(20_000)
    await check
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not make a request for unsupported input', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(lookupRtcRecord({ ...request, villageCode: 'invalid' } as unknown as RtcLookupRequest, fetcher)).rejects.toMatchObject({ kind: 'invalid_request' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
