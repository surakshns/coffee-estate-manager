/** Private owner matching. No helper returns or persists holder names or other holder fields. */
import { isWholeRtcHissa, lookupRtcRecord, type RtcLookupRequest, type RtcOwner, type RtcRecord } from './farmRtc.ts'
import { parseSurveyParcels, SURVEY_VILLAGES } from './farmSurveyMap.ts'

export interface SurveyInventorySource { villageCode: string; geojson: unknown }
export interface SurveyIdentity { villageCode: RtcLookupRequest['villageCode']; surveyNumber: string }
export interface OwnedRtcMatch {
  identity: RtcLookupRequest
  matchedAcres: number | null
  lastCheckedAt: string
  landCode: string
  ulpin: string | null
}

/** Formatting-only comparison: no transliteration, substring, initials expansion or fuzzy matching. */
export function normalizeHolderName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('kn-IN').replace(/[\p{White_Space}\p{P}\p{Cf}]+/gu, '')
}

function decimal(value: string | null): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null
}

function extentAcres(extent: RtcRecord['extent']): number | null {
  const acres = decimal(extent.acres), guntas = decimal(extent.guntas), fraction = decimal(extent.fractionalGuntas)
  // The RTC API's third field is not documented as decimal guntas or annas.
  // Preserve an unknown result unless the field explicitly states zero.
  if (acres === null || guntas === null || fraction !== 0) return null
  const total = acres + guntas / 40
  return Number.isFinite(total) && total <= 1_000_000_000 ? total : null
}

const identifier = (value: string | null): string | null => {
  if (!value || value === '0') return null
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : value
}

function holderSignature(owner: RtcOwner): string {
  return JSON.stringify([identifier(owner.ownerNumber), identifier(owner.mainOwnerNumber), normalizeHolderName(owner.name ?? ''),
    owner.fatherName, owner.category, owner.extent.acres, owner.extent.guntas, owner.extent.fractionalGuntas,
    owner.governmentRestriction, owner.governmentRestrictionOwnerCategory, owner.courtStay])
}

/** Sum only the matching holders' recorded shares, never the parcel's overall extent or map area. */
export function matchingHolderExtent(record: RtcRecord, target: string | readonly string[]): { matches: boolean; acres: number | null } {
  const names = new Set((typeof target === 'string' ? [target] : target).map(normalizeHolderName).filter(Boolean))
  if (!names.size) return { matches: false, acres: null }
  const owners = record.owners.filter(owner => names.has(normalizeHolderName(owner.name ?? '')))
  if (!owners.length) return { matches: false, acres: null }
  const seenRows = new Set<string>(), seenIds = new Map<string, string>()
  let sum = 0
  for (const owner of owners) {
    const signature = holderSignature(owner)
    if (seenRows.has(signature)) continue
    const ids = [identifier(owner.ownerNumber), identifier(owner.mainOwnerNumber)].map((id, i) => id ? `${i}:${id}` : null).filter((id): id is string => id !== null)
    if (ids.some(id => seenIds.has(id) && seenIds.get(id) !== signature)) return { matches: true, acres: null }
    const area = extentAcres(owner.extent)
    if (area === null) return { matches: true, acres: null }
    seenRows.add(signature)
    for (const id of ids) seenIds.set(id, signature)
    sum += area
    if (!Number.isFinite(sum) || sum > 1_000_000_000) return { matches: true, acres: null }
  }
  const overall = extentAcres(record.extent)
  if (overall !== null && sum > overall + 1e-8) return { matches: true, acres: null }
  return { matches: true, acres: Math.round(sum * 1e8) / 1e8 }
}

/** Public map inventory contains only exact supported village/survey identities. */
export function buildSurveyInventory(sources: readonly SurveyInventorySource[]): SurveyIdentity[] {
  const inventory = new Map<string, SurveyIdentity>()
  for (const source of sources) {
    const village = SURVEY_VILLAGES.find(item => item.bhoomi === source.villageCode)
    if (!village) throw new Error('Unsupported survey inventory village.')
    for (const parcel of parseSurveyParcels(source.geojson, village)) {
      const identity = { villageCode: village.bhoomi, surveyNumber: parcel.survey }
      inventory.set(`${identity.villageCode}:${identity.surveyNumber}`, identity)
    }
  }
  return [...inventory.values()].sort((a, b) => a.villageCode.localeCompare(b.villageCode) || Number(a.surveyNumber) - Number(b.surveyNumber))
}

export async function lookupOwnedRtc(request: RtcLookupRequest, target: string,
  lookup: (request: RtcLookupRequest) => Promise<RtcRecord> = lookupRtcRecord): Promise<OwnedRtcMatch | null> {
  const record = await lookup(request)
  // Keep injection boundaries strict too; a different source parcel can never become a match.
  if (Object.entries(request).some(([key, value]) => record.identity[key as keyof RtcLookupRequest] !== value)) throw new Error('RTC identity does not match the requested record.')
  const result = matchingHolderExtent(record, target)
  return result.matches ? { identity: { villageCode: record.identity.villageCode, surveyNumber: record.identity.surveyNumber, surnoc: record.identity.surnoc, hissaNumber: record.identity.hissaNumber }, matchedAcres: result.acres, lastCheckedAt: record.retrievedAt, landCode: record.landCode, ulpin: record.ulpin } : null
}

export interface HoldingsAggregate {
  knownAcres: number
  unknownCount: number
  overlapCount: number
  uniqueRecords: number
  totalAcres: number | null
  coverageComplete: boolean
}

/** A subtotal remains useful during scanning; a final total requires complete, unambiguous coverage. */
export function aggregateMatches(matches: readonly Pick<OwnedRtcMatch, 'identity' | 'landCode' | 'matchedAcres'>[], coverageComplete = false): HoldingsAggregate {
  const parcels = new Map<string, { identities: RtcLookupRequest[]; values: Set<number | null> }>()
  for (const match of matches) {
    const key = `${match.identity.villageCode}:${match.landCode}`
    const area = typeof match.matchedAcres === 'number' && Number.isFinite(match.matchedAcres) && match.matchedAcres >= 0 && match.matchedAcres <= 1_000_000_000 ? match.matchedAcres : null
    const previous = parcels.get(key)
    if (previous) { previous.values.add(area); previous.identities.push(match.identity) }
    else parcels.set(key, { identities: [match.identity], values: new Set([area]) })
  }
  const numberedGroups = new Set<string>()
  const group = (identity: RtcLookupRequest) => `${identity.villageCode}:${identity.surveyNumber}:${identity.surnoc}`
  for (const parcel of parcels.values()) for (const identity of parcel.identities) if (!isWholeRtcHissa(identity.hissaNumber)) numberedGroups.add(group(identity))
  let knownAcres = 0, unknownCount = 0, overlapCount = 0
  for (const parcel of parcels.values()) {
    const hasSpecificRecord = parcel.identities.some(identity => !isWholeRtcHissa(identity.hissaNumber))
    const overlap = !hasSpecificRecord && parcel.identities.some(identity => isWholeRtcHissa(identity.hissaNumber) && numberedGroups.has(group(identity)))
    if (overlap) { overlapCount++; unknownCount++; continue }
    const value = parcel.values.size === 1 ? [...parcel.values][0] : null
    if (value === null) unknownCount++
    else knownAcres += value
  }
  knownAcres = Math.round(knownAcres * 1e8) / 1e8
  return { knownAcres, unknownCount, overlapCount, uniqueRecords: parcels.size, totalAcres: coverageComplete && unknownCount === 0 && Number.isFinite(knownAcres) ? knownAcres : null, coverageComplete }
}
