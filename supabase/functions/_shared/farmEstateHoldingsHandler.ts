import { lookupRtcOptions, lookupRtcRecord, RtcLookupError, validateRtcLookupRequest, validateRtcOptionsRequest, type RtcLookupRequest, type RtcOptions, type RtcOption, type RtcRecord } from './farmRtc.ts'
import { matchingHolderExtent, normalizeHolderName } from './farmEstateHoldings.ts'
import { constantTimeSecret } from './farmSync.ts'
import { readJsonBody, RequestBodyError } from './requestBody.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-farm-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const WORKER_BUDGET_MS = 42_000
const LOOKUP_BUDGET_MS = 40_000
const NEXT_JOB_BEFORE_MS = 22_000
const UNAVAILABLE = 'Estate record matching is temporarily unavailable. Please try again.'
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } })
}
export interface EstateHoldingMatch {
  identity: RtcLookupRequest
  matchedAcres: number | null
  landCode: string
  lastCheckedAt: string
}
export interface EstateHoldingsStatus {
  holderName: string
  holderAliases?: string[]
  configuredAt: string
  matches: EstateHoldingMatch[]
  surveysTotal: number
  surveysChecked: number
  recordsChecked: number
  pending: number
  unavailable: number
  lastCheckedAt: string | null
}
export interface EstateHolderJob {
  id: number
  token: string
  userId: string
  holderName: string
  holderAliases?: string[]
  kind: 'options' | 'record'
  identity: { villageCode: RtcLookupRequest['villageCode']; surveyNumber: string; surnoc: string; hissaNumber: string }
}
export type EstateHolderJobResult = RtcOption[] | { matches: boolean; acres: number | null; landCode: string }
export interface EstateHoldingsDependencies {
  authenticate: (token: string) => Promise<string | null>
  claimUserLookup: (userId: string) => Promise<boolean>
  getStatus: (userId: string) => Promise<EstateHoldingsStatus | null>
  setProfile: (userId: string, holderName: string, identity: RtcLookupRequest, record: RtcRecord) => Promise<void>
  claimJob: (signal?: AbortSignal) => Promise<EstateHolderJob | null>
  finishJob: (job: EstateHolderJob, result: EstateHolderJobResult | null, signal?: AbortSignal) => Promise<boolean>
  lookup?: (request: RtcLookupRequest, signal?: AbortSignal) => Promise<RtcRecord>
  options?: (request: { mode: 'options'; villageCode: RtcLookupRequest['villageCode']; surveyNumber: string }, signal?: AbortSignal) => Promise<RtcOptions>
  now?: () => number
}
function checkedName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || /[<>\u0000-\u001f\u007f]/.test(value) || !normalizeHolderName(value)) {
    throw new RequestBodyError('Choose a valid holder name from the selected RTC record.', 400)
  }
  return value.trim()
}
function onlyKeys(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new RequestBodyError('Invalid estate matching request.', 400)
}
function requireRecordIdentity(record: RtcRecord, identity: RtcLookupRequest) {
  if (Object.entries(identity).some(([key, value]) => record.identity[key as keyof RtcLookupRequest] !== value)) throw new Error(UNAVAILABLE)
}
function beforeDeadline<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(UNAVAILABLE))
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error(UNAVAILABLE))
    signal.addEventListener('abort', aborted, { once: true })
    try {
      operation().then(value => { signal.removeEventListener('abort', aborted); resolve(value) }, error => { signal.removeEventListener('abort', aborted); reject(error) })
    } catch (error) { signal.removeEventListener('abort', aborted); reject(error) }
  })
}
// Retain the RTC service's own 20-second timeout while applying the worker's
// overall deadline. URLs remain fixed inside the official lookup implementation.
function deadlineFetcher(signal?: AbortSignal): typeof fetch {
  if (!signal) return fetch
  return (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal })
}
export function createEstateHoldingsHandler(dependencies: EstateHoldingsDependencies, syncSecret: string) {
  const lookup = dependencies.lookup ?? ((input, signal) => lookupRtcRecord(input, deadlineFetcher(signal)))
  const options = dependencies.options ?? ((input, signal) => lookupRtcOptions(input, deadlineFetcher(signal)))
  const now = dependencies.now ?? Date.now
  async function work() {
    const started = now(), controller = new AbortController(), lookupController = new AbortController()
    const timer = setTimeout(() => controller.abort(), WORKER_BUDGET_MS)
    // Reserve two seconds for a failed-lookup completion RPC. If that also
    // stalls, the global deadline wins and the SQL lease expires for retry.
    const lookupTimer = setTimeout(() => lookupController.abort(), LOOKUP_BUDGET_MS)
    const lookupSignal = AbortSignal.any([controller.signal, lookupController.signal])
    const counts = { claimed: 0, completed: 0, failed: 0, leaseRejected: 0 }
    try {
      // The SQL claim also enforces one global lease and four actions/minute.
      // Stop starting lookups before 22s; each official lookup is bounded to 20s.
      while (counts.claimed < 4 && now() - started < NEXT_JOB_BEFORE_MS && !lookupSignal.aborted) {
        const job = await beforeDeadline(() => dependencies.claimJob(controller.signal), controller.signal)
        if (!job) break
        counts.claimed++
        let result: EstateHolderJobResult | null = null
        try {
          if (lookupSignal.aborted) throw new Error(UNAVAILABLE)
          const holderName = checkedName(job.holderName)
          if (job.holderAliases !== undefined && (!Array.isArray(job.holderAliases) || job.holderAliases.length > 10)) throw new Error(UNAVAILABLE)
          const holderNames = [holderName, ...(job.holderAliases ?? []).map(checkedName)]
          if (job.kind === 'options') {
            const input = validateRtcOptionsRequest({ mode: 'options', villageCode: job.identity.villageCode, surveyNumber: job.identity.surveyNumber })
            const record = await beforeDeadline(() => options(input, lookupSignal), lookupSignal)
            if (record.identity.villageCode !== input.villageCode || record.identity.surveyNumber !== input.surveyNumber) throw new Error(UNAVAILABLE)
            result = record.entries.map(entry => ({ surnoc: entry.surnoc, hissaNumber: entry.hissaNumber }))
          } else if (job.kind === 'record') {
            const input = validateRtcLookupRequest(job.identity)
            const record = await beforeDeadline(() => lookup(input, lookupSignal), lookupSignal)
            requireRecordIdentity(record, input)
            const match = matchingHolderExtent(record, holderNames)
            result = { matches: match.matches, acres: match.acres, landCode: record.landCode }
          } else throw new Error(UNAVAILABLE)
          if (lookupSignal.aborted) throw new Error(UNAVAILABLE)
        } catch { result = null }
        const accepted = await beforeDeadline(() => dependencies.finishJob(job, result, controller.signal), controller.signal)
        if (!accepted) counts.leaseRejected++
        else if (result === null) counts.failed++
        else counts.completed++
      }
      // Counts alone leave private identities, target names and RTC rows out of
      // cron responses and platform request logs.
      return json(counts, counts.failed || counts.leaseRejected ? 207 : 200)
    } catch { return json({ error: UNAVAILABLE }, 503) }
    finally { clearTimeout(timer); clearTimeout(lookupTimer) }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'Cache-Control': 'no-store' } })
    if (request.method !== 'POST') return json({ error: 'Use POST for estate matching.' }, 405)
    const suppliedSecret = request.headers.get('x-farm-sync-secret')
    if (suppliedSecret !== null && await constantTimeSecret(suppliedSecret, syncSecret)) {
      try {
        const input = await readJsonBody(request, 4096)
        onlyKeys(input, ['mode'])
        if (input.mode !== undefined && input.mode !== 'sync') return json({ error: 'Invalid estate matching request.' }, 400)
        return work()
      } catch (error) {
        return json({ error: 'Invalid or oversized estate matching request.' }, error instanceof RequestBodyError ? error.status : 400)
      }
    }
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ') || authorization.length > 4096 || authorization.length === 7) return json({ error: 'Please sign in again.' }, 401)
    let userId: string | null
    try { userId = await dependencies.authenticate(authorization.slice(7)) } catch { userId = null }
    if (!userId) return json({ error: 'Please sign in again.' }, 401)
    try {
      const input = await readJsonBody(request, 4096)
      // An invalid cron credential never gains worker privileges. Authenticated
      // browser status remains available even if a stale secret header is sent.
      if (suppliedSecret !== null && input.mode !== 'status') return json({ error: 'Unauthorized.' }, 401)
      if (input.mode === 'status') {
        onlyKeys(input, ['mode'])
        return json(await dependencies.getStatus(userId))
      }
      if (input.mode !== 'choose') return json({ error: 'Unknown estate matching action.' }, 400)
      onlyKeys(input, ['mode', 'identity', 'holderName'])
      const identity = validateRtcLookupRequest(input.identity), holderName = checkedName(input.holderName)
      if (!await dependencies.claimUserLookup(userId)) return json({ error: 'Too many RTC lookups. Wait a minute and retry.' }, 429)
      const record = await lookup(identity)
      requireRecordIdentity(record, identity)
      const officialName = record.owners.find(owner => owner.name && normalizeHolderName(owner.name) === normalizeHolderName(holderName))?.name
      if (!officialName) return json({ error: 'The chosen holder name could not be verified in this RTC record. Load the record again and choose a listed holder.' }, 409)
      // Store only the one name explicitly selected by this account, verified
      // against this exact official record. Never persist the other owner rows.
      await dependencies.setProfile(userId, checkedName(officialName), identity, record)
      return json(await dependencies.getStatus(userId))
    } catch (error) {
      if (error instanceof RequestBodyError) return json({ error: 'Invalid or oversized estate matching request.' }, error.status)
      if (error instanceof RtcLookupError && error.kind === 'invalid_request') return json({ error: 'Choose a supported village and valid RTC identifiers.' }, 400)
      return json({ error: UNAVAILABLE }, 503)
    }
  }
}
