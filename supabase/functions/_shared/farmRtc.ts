/** Official Bhoomi lookup. Session cookies and owner data live only in this call. */
export const RTC_SOURCE_URL = 'https://rdservices.karnataka.gov.in/BhoomiMaps/'
const RTC_BASE_URL = `${RTC_SOURCE_URL}Default/`
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_OWNERS = 100
const LOOKUP_TIMEOUT_MS = 20_000
const VILLAGES: Record<string, string> = { '2301110012': '12', '2301110038': '38' }

export interface RtcLookupRequest {
  villageCode: '2301110012' | '2301110038'
  surveyNumber: string
  surnoc: string
  hissaNumber: string
}
export interface RtcExtent {
  acres: string | null
  guntas: string | null
  fractionalGuntas: string | null
}
export interface RtcOwner {
  ownerNumber: string | null
  mainOwnerNumber: string | null
  name: string | null
  fatherName: string | null
  category: string | null
  extent: RtcExtent
  governmentRestriction: string | null
  governmentRestrictionOwnerCategory: string | null
  courtStay: string | null
}
export interface RtcRecord {
  identity: RtcLookupRequest
  villageName: string | null
  landCode: string
  ulpin: string | null
  extent: RtcExtent
  owners: RtcOwner[]
  sourceUrl: string
  retrievedAt: string
}
export class RtcLookupError extends Error {
  readonly kind: 'invalid_request' | 'unavailable'
  constructor(kind: 'invalid_request' | 'unavailable', message: string) {
    super(message)
    this.name = 'RtcLookupError'
    this.kind = kind
  }
}
const unavailable = () => new RtcLookupError('unavailable', 'The official RTC record is unavailable or could not be verified for this parcel. Try the official Bhoomi service.')
const invalid = () => new RtcLookupError('invalid_request', 'Choose a supported village and a valid survey, surnoc and numeric hissa.')
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable()
  return value as Record<string, unknown>
}
function positiveInteger(value: unknown, maxDigits: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw unavailable()
  const text = String(value).trim()
  if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(text)) throw unavailable()
  const canonical = text.replace(/^0+/, '')
  if (!canonical) throw unavailable()
  return canonical
}
function boundedText(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw unavailable()
  const text = String(value).trim()
  if (text.length > maxLength || /[<>\u0000-\u001f\u007f]/.test(text)) throw unavailable()
  return text || null
}
function extent(row: Record<string, unknown>): RtcExtent {
  const component = (key: string) => {
    const text = boundedText(row[key], 40)
    if (text !== null && !/^\d+(?:\.\d+)?$/.test(text)) throw unavailable()
    return text
  }
  return { acres: component('ext_acre'), guntas: component('ext_gunta'), fractionalGuntas: component('ext_fgunta') }
}
export function validateRtcLookupRequest(raw: unknown): RtcLookupRequest {
  try {
    const input = object(raw)
    if (Object.keys(input).some(key => !['villageCode', 'surveyNumber', 'surnoc', 'hissaNumber'].includes(key))) throw invalid()
    if (typeof input.villageCode !== 'string' || !Object.hasOwn(VILLAGES, input.villageCode)
      || typeof input.surveyNumber !== 'string' || typeof input.hissaNumber !== 'string'
      || typeof input.surnoc !== 'string' || !/^[A-Za-z0-9*./_-]{1,20}$/.test(input.surnoc)) throw invalid()
    return {
      villageCode: input.villageCode as RtcLookupRequest['villageCode'],
      surveyNumber: positiveInteger(input.surveyNumber, 6),
      surnoc: input.surnoc,
      hissaNumber: positiveInteger(input.hissaNumber, 10)
    }
  } catch { throw invalid() }
}
function decode(raw: unknown): unknown {
  let value = raw
  try {
    for (let depth = 0; depth < 2 && typeof value === 'string'; depth++) {
      if (new TextEncoder().encode(value).byteLength > MAX_RESPONSE_BYTES) throw unavailable()
      value = JSON.parse(value)
    }
  } catch { throw unavailable() }
  if (typeof value === 'string') throw unavailable()
  return value
}
function requireIdentity(row: Record<string, unknown>, request: RtcLookupRequest, landCode?: string) {
  if (positiveInteger(row.hobli_code, 3) !== '11'
    || positiveInteger(row.village_code, 3) !== VILLAGES[request.villageCode]
    || positiveInteger(row.survey_no, 6) !== request.surveyNumber
    || boundedText(row.surnoc, 20) !== request.surnoc
    || positiveInteger(row.hissa_no, 10) !== request.hissaNumber) throw unavailable()
  if (landCode !== undefined && boundedText(row.land_code, 40) !== landCode) throw unavailable()
}
/** Accepts JSON or the service's double-encoded JSON; returns a strict whitelist. */
export function parseRtcRecord(raw: unknown, input: RtcLookupRequest, retrievedAt = new Date().toISOString()): RtcRecord {
  const request = validateRtcLookupRequest(input)
  const data = object(decode(raw))
  if (!Array.isArray(data.Table) || data.Table.length !== 1 || !Array.isArray(data.Table1) || data.Table1.length > MAX_OWNERS
    || !Number.isFinite(Date.parse(retrievedAt))) throw unavailable()
  const parcel = object(data.Table[0])
  if (positiveInteger(parcel.distcode, 3) !== '23' || positiveInteger(parcel.talukcode, 3) !== '1') throw unavailable()
  requireIdentity(parcel, request)
  const landCode = boundedText(parcel.land_code, 40)
  if (!landCode) throw unavailable()
  const owners = data.Table1.map(rawOwner => {
    const row = object(rawOwner)
    requireIdentity(row, request, landCode)
    return {
      ownerNumber: boundedText(row.owner_no, 40), mainOwnerNumber: boundedText(row.main_owner_no, 40),
      name: boundedText(row.owner), fatherName: boundedText(row.father), category: boundedText(row.owner_cat, 40),
      extent: extent(row), governmentRestriction: boundedText(row.govt_restrict, 40),
      governmentRestrictionOwnerCategory: boundedText(row.govt_rest_own_cat, 40), courtStay: boundedText(row.court_stay, 40)
    }
  })
  return { identity: request, villageName: boundedText(parcel.vlgname, 160), landCode,
    ulpin: boundedText(parcel.ULPIN, 80), extent: extent(parcel), owners,
    sourceUrl: RTC_SOURCE_URL, retrievedAt }
}
async function boundedBody(response: Response): Promise<string> {
  if (!response.ok || response.status >= 300 || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw unavailable()
  }
  const reader = response.body?.getReader()
  if (!reader) throw unavailable()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw unavailable() }
    chunks.push(value)
  }
  const buffer = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(buffer)
}
function sessionCookie(headers: Headers): string | null {
  const extended = headers as Headers & { getSetCookie?: () => string[] }
  const values = typeof extended.getSetCookie === 'function'
    ? extended.getSetCookie() : [headers.get('set-cookie') ?? '']
  // The fallback also handles combined Set-Cookie headers with Expires commas.
  const cookies = values.flatMap(value => value.split(/,(?=\s*[^;,\s]+=)/))
  for (const value of cookies) {
    const match = /^\s*ASP\.NET_SessionId=([A-Za-z0-9_-]{1,128})(?:;|$)/.exec(value)
    if (match) return `ASP.NET_SessionId=${match[1]}`
  }
  return null
}
/** Fixed-origin three-step workflow, with an isolated transient ASP.NET session. */
export async function lookupRtcRecord(input: RtcLookupRequest, fetcher: typeof fetch = fetch): Promise<RtcRecord> {
  const request = validateRtcLookupRequest(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  let cookie: string | null = null
  const base = { Dist: '23', Taluk: '1', Hobli: '11', Village: VILLAGES[request.villageCode], Surveyno: request.surveyNumber }
  const post = async (step: 'GetSurnoc' | 'GetHissaNo' | 'GetRTCDataforSearch', values: Record<string, string>) => {
    const body = new FormData()
    for (const [key, value] of Object.entries(values)) body.set(key, value)
    const response = await fetcher(`${RTC_BASE_URL}${step}`, { method: 'POST', body,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'error', signal: controller.signal, cache: 'no-store', credentials: 'omit' })
    cookie = sessionCookie(response.headers) ?? cookie
    return decode(await boundedBody(response))
  }
  try {
    const surnocs = await post('GetSurnoc', base)
    if (!cookie || !Array.isArray(surnocs) || surnocs.length > 1000 || !surnocs.some(value => {
      try {
        const row = object(value)
        return positiveInteger(row.survey_no, 6) === request.surveyNumber && boundedText(row.surnoc, 20) === request.surnoc
      } catch { return false }
    })) throw unavailable()
    const hissas = await post('GetHissaNo', { surnoc: request.surnoc })
    if (!Array.isArray(hissas) || hissas.length > 1000 || !hissas.some(value => {
      try { return positiveInteger(object(value).hissa_no, 10) === request.hissaNumber } catch { return false }
    })) throw unavailable()
    const raw = await post('GetRTCDataforSearch', { ...base, Surnoc: request.surnoc, Hissano: request.hissaNumber })
    return parseRtcRecord(raw, request)
  } catch (error) {
    if (error instanceof RtcLookupError) throw error
    throw unavailable()
  } finally {
    clearTimeout(timer)
    cookie = null
  }
}
