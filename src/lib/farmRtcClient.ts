import { supabase } from './supabase'
import type { RtcLookupRequest, RtcRecord, RtcExtent } from '../../supabase/functions/_shared/farmRtc'
export type { RtcLookupRequest, RtcRecord, RtcExtent }

type Invoker = (request: RtcLookupRequest, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>
const invoke: Invoker = (body, signal) => supabase.functions.invoke('farm-rtc-lookup', { body, signal, timeout: 25000 })
const safeText = (value: unknown) => value === null || (typeof value === 'string' && value.length <= 500 && !/[<>\u0000-\u001f\u007f]/.test(value))
const safeExtent = (value: unknown): value is RtcExtent => {
  if (!value || typeof value !== 'object') return false
  const extent = value as RtcExtent
  return [extent.acres, extent.guntas, extent.fractionalGuntas].every(part => part === null || (typeof part === 'string' && part.length <= 40 && /^\d+(?:\.\d+)?$/.test(part)))
}
export async function loadRtcRecord(request: RtcLookupRequest, signal: AbortSignal, invoker: Invoker = invoke): Promise<RtcRecord> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const { data, error } = await invoker(request, signal)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (error) {
    const response = (error as { context?: unknown }).context
    const status = response instanceof Response ? response.status : null
    throw new Error(status === 401 ? 'Please sign in again to load RTC details.' : status === 429 ? 'Too many RTC lookups. Wait a minute and retry.' : 'The official RTC record could not be loaded. Retry or use the official Bhoomi service.')
  }
  const record = data as RtcRecord | null
  if (!record || !record.identity || Object.entries(request).some(([key, value]) => record.identity[key as keyof RtcLookupRequest] !== value)
    || typeof record.landCode !== 'string' || !record.landCode || !safeText(record.landCode) || !safeText(record.villageName) || !safeText(record.ulpin)
    || record.sourceUrl !== 'https://rdservices.karnataka.gov.in/BhoomiMaps/' || typeof record.retrievedAt !== 'string'
    || !Number.isFinite(Date.parse(record.retrievedAt)) || Date.parse(record.retrievedAt) > Date.now() + 300000
    || !safeExtent(record.extent) || !Array.isArray(record.owners) || record.owners.length > 100
    || record.owners.some(owner => !owner || !safeExtent(owner.extent) || ![owner.ownerNumber, owner.mainOwnerNumber, owner.name, owner.fatherName, owner.category, owner.governmentRestriction, owner.governmentRestrictionOwnerCategory, owner.courtStay].every(safeText))) throw new Error('The returned RTC record does not match the selected parcel or could not be verified.')
  return record
}

export function rtcExtentText(extent: RtcExtent) {
  return `${extent.acres ?? '—'} acres · ${extent.guntas ?? '—'} guntas · ${extent.fractionalGuntas ?? '—'} fractional guntas`
}
