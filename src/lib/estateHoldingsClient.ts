import { supabase } from './supabase'
import type { RtcLookupRequest } from './farmRtcClient'

export type EstateHolderMatch = { identity: RtcLookupRequest; matchedAcres: number | null; landCode: string; lastCheckedAt: string }
export type EstateHolderStatus = {
  holderName: string; holderAliases?: string[]; configuredAt: string; matches: EstateHolderMatch[]
  surveysTotal: number; surveysChecked: number; recordsChecked: number
  pending: number; unavailable: number; lastCheckedAt: string | null
}
type Request = { mode: 'status' } | { mode: 'choose'; identity: RtcLookupRequest; holderName: string }
type Invoker = (request: Request, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>
const invoke: Invoker = (body, signal) => supabase.functions.invoke('farm-estate-holdings', { body, signal, timeout: 25000 })
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300000
const safeText = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[<>\u0000-\u001f\u007f]/.test(value)
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000

export async function loadEstateHolderStatus(signal: AbortSignal, request: Request = { mode: 'status' }, invoker: Invoker = invoke): Promise<EstateHolderStatus | null> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const { data, error } = await invoker(request, signal)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (error) {
    const context = (error as { context?: unknown }).context
    const status = context instanceof Response ? context.status : null
    throw new Error(status === 401 ? 'Sign in again to open your private estate markers.' : status === 429 ? 'Wait a minute before checking another RTC holder.' : request.mode === 'choose' ? 'This holder could not be verified in the selected RTC. Retry the record and choose its recorded name.' : 'Your private holder markers could not be loaded. Retry to restore your acreage and matches.')
  }
  if (data === null) return null
  const value = data as EstateHolderStatus
  if (!value || !safeText(value.holderName, 100) || !timestamp(value.configuredAt)
    || (value.holderAliases !== undefined && (!Array.isArray(value.holderAliases) || value.holderAliases.length > 10 || !value.holderAliases.every(name => safeText(name, 100))))
    || ![value.surveysTotal, value.surveysChecked, value.recordsChecked, value.pending, value.unavailable].every(count)
    || value.surveysChecked > value.surveysTotal || !(value.lastCheckedAt === null || timestamp(value.lastCheckedAt))
    || !Array.isArray(value.matches) || value.matches.length > 10000
    || value.matches.some(match => {
      const identity = match?.identity
      return !identity || !['2301110012', '2301110038'].includes(identity.villageCode)
        || typeof identity.surveyNumber !== 'string' || !/^[1-9]\d{0,5}$/.test(identity.surveyNumber)
        || ![identity.surnoc, identity.hissaNumber].every(part => typeof part === 'string' && /^[A-Za-z0-9*./_-]{1,20}$/.test(part))
        || !safeText(match.landCode, 40) || !timestamp(match.lastCheckedAt)
        || !(match.matchedAcres === null || (typeof match.matchedAcres === 'number' && Number.isFinite(match.matchedAcres) && match.matchedAcres >= 0 && match.matchedAcres <= 10000000))
    })) throw new Error('The private estate matching response could not be verified. Retry your markers.')
  // Retain a strict whitelist; no incidental owner or account fields enter UI state.
  return {
    holderName: value.holderName, ...(value.holderAliases === undefined ? {} : { holderAliases: [...value.holderAliases] }), configuredAt: value.configuredAt,
    matches: value.matches.map(match => ({ identity: { villageCode: match.identity.villageCode, surveyNumber: match.identity.surveyNumber, surnoc: match.identity.surnoc, hissaNumber: match.identity.hissaNumber }, matchedAcres: match.matchedAcres, landCode: match.landCode, lastCheckedAt: match.lastCheckedAt })),
    surveysTotal: value.surveysTotal, surveysChecked: value.surveysChecked, recordsChecked: value.recordsChecked,
    pending: value.pending, unavailable: value.unavailable, lastCheckedAt: value.lastCheckedAt
  }
}
