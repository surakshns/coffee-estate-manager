import { lookupRtcRecord, RtcLookupError, validateRtcLookupRequest, type RtcRecord, type RtcLookupRequest } from './farmRtc.ts'
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
      const input = validateRtcLookupRequest(await readJsonBody(request, 2048))
      if (!await dependencies.claim(userId)) return json({ error: 'Too many RTC lookups. Wait a minute and retry.' }, 429)
      return json(await (dependencies.lookup ?? lookupRtcRecord)(input))
    } catch (error) {
      if (error instanceof RequestBodyError) return json({ error: 'Invalid or oversized RTC request.' }, error.status)
      if (error instanceof RtcLookupError) return json({ error: error.message }, error.kind === 'invalid_request' ? 400 : 503)
      // No upstream content, credentials or owner values enter logs/errors.
      return json({ error: 'RTC lookup is temporarily unavailable. Try again or use the official Bhoomi service.' }, 503)
    }
  }
}
