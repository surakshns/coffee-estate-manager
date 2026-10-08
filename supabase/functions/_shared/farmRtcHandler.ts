import { lookupRtcRecord, lookupRtcOptions, RtcLookupError, validateRtcLookupRequest, validateRtcOptionsRequest, type RtcRecord, type RtcLookupRequest, type RtcOptions, type RtcOptionsRequest } from './farmRtc.ts'
import { readJsonBody, RequestBodyError } from './requestBody.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } })
}
export function createRtcLookupHandler(dependencies: {
  authenticate: (token: string) => Promise<string | null>
  claim: (userId: string) => Promise<boolean>
  lookup?: (request: RtcLookupRequest) => Promise<RtcRecord>
  options?: (request: RtcOptionsRequest) => Promise<RtcOptions>
  onRecord?: (userId: string, record: RtcRecord) => Promise<void>
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'Cache-Control': 'no-store' } })
    if (request.method !== 'POST') return json({ error: 'Use POST for this lookup.' }, 405)
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ') || authorization.length > 4096) return json({ error: 'Please sign in again.' }, 401)
    let userId: string | null
    try { userId = await dependencies.authenticate(authorization.slice(7)) } catch { userId = null }
    if (!userId) return json({ error: 'Please sign in again.' }, 401)
    try {
      const raw = await readJsonBody(request, 2048)
      const wantsOptions = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).mode === 'options'
      const input = wantsOptions ? validateRtcOptionsRequest(raw) : validateRtcLookupRequest(raw)
      if (!await dependencies.claim(userId)) return json({ error: 'Too many RTC lookups. Wait a minute and retry.' }, 429)
      if (wantsOptions) return json(await (dependencies.options ?? lookupRtcOptions)(input as RtcOptionsRequest))
      const record = await (dependencies.lookup ?? lookupRtcRecord)(input as RtcLookupRequest)
      // A private marker refresh must not block displaying a verified RTC.
      try { await dependencies.onRecord?.(userId, record) } catch { /* No owner content is logged. The background queue can retry. */ }
      return json(record)
    } catch (error) {
      if (error instanceof RequestBodyError) return json({ error: 'Invalid or oversized RTC request.' }, error.status)
      if (error instanceof RtcLookupError) return json({ error: error.message }, error.kind === 'invalid_request' ? 400 : 503)
      // No upstream content, credentials or owner values enter logs/errors.
      return json({ error: 'RTC lookup is temporarily unavailable. Try again or use the official Bhoomi service.' }, 503)
    }
  }
}
