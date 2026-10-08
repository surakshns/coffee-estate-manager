import { describe, expect, it, vi } from 'vitest'
import { aggregateMatches, buildSurveyInventory, lookupOwnedRtc, matchingHolderExtent, normalizeHolderName, type OwnedRtcMatch } from '../../supabase/functions/_shared/farmEstateHoldings'
import type { RtcLookupRequest, RtcOwner, RtcRecord } from '../../supabase/functions/_shared/farmRtc'
import { SURVEY_VILLAGES } from '../../supabase/functions/_shared/farmSurveyMap'

// All record identifiers, extents and holder rows here are synthetic.
const target = 'ಎನ್ ಸಿ ಸ್ವಾಮಿ'
const identity: RtcLookupRequest = { villageCode: '2301110038', surveyNumber: '72', surnoc: '*', hissaNumber: '4' }
function owner(patch: Partial<RtcOwner> = {}): RtcOwner {
  return { ownerNumber: '1', mainOwnerNumber: null, name: target, fatherName: 'Synthetic parent', category: null,
    extent: { acres: '2', guntas: '10', fractionalGuntas: '0' }, governmentRestriction: null, governmentRestrictionOwnerCategory: null, courtStay: null, ...patch }
}
function record(owners: RtcOwner[] = [owner()]): RtcRecord {
  return { identity: { ...identity }, villageName: 'Synthetic village', landCode: 'synthetic-land', ulpin: null,
    extent: { acres: '50', guntas: '0', fractionalGuntas: '0' }, owners,
    sourceUrl: 'https://rdservices.karnataka.gov.in/BhoomiMaps/', retrievedAt: '2026-10-10T00:00:00.000Z' }
}
function match(patch: Partial<OwnedRtcMatch> = {}): OwnedRtcMatch {
  return { identity, landCode: 'synthetic-land', matchedAcres: 2.25, lastCheckedAt: '2026-10-10T00:00:00.000Z', ulpin: null, ...patch }
}

describe('exact holder formatting normalization', () => {
  it('matches Kannada spacing, punctuation and zero-width format differences', () => {
    expect(normalizeHolderName(' ಎನ್. ಸಿ. ಸ್ವಾಮಿ ')).toBe(normalizeHolderName(target))
    expect(normalizeHolderName('ಎನ್\u200c.ಸಿ\u200d.ಸ್ವಾಮಿ')).toBe(normalizeHolderName(target))
    expect(normalizeHolderName('Ｎ Ｃ ＳＷＡＭＹ')).toBe(normalizeHolderName('N.C. Swamy'))
  })
  it('keeps different letters, surnames, expanded initials and scripts distinct', () => {
    for (const different of ['ಎನ್ ಸಿ ಸ್ವಾಮಿನಾಥ', 'ಎಂ ಸಿ ಸ್ವಾಮಿ', 'ಎನ್ ಡಿ ಸ್ವಾಮಿ', 'N C Swamy', 'ಸ್ವಾಮಿ']) expect(normalizeHolderName(different)).not.toBe(normalizeHolderName(target))
    expect(normalizeHolderName('Narasimha C Swamy')).not.toBe(normalizeHolderName('N C Swamy'))
  })
})

describe('holder share extent, separate from the full survey extent', () => {
  it('matches only the explicitly approved exact aliases and counts each source share once', () => {
    const alias = 'Synthetic full recorded name'
    const source = record([owner(), owner({ ownerNumber: '2', name: alias, extent: { acres: '1', guntas: '20', fractionalGuntas: '0' } }), owner({ ownerNumber: '3', name: `${alias} someone else` })])
    expect(matchingHolderExtent(source, [target, alias, alias])).toEqual({ matches: true, acres: 3.75 })
    expect(matchingHolderExtent(source, target)).toEqual({ matches: true, acres: 2.25 })
    expect(matchingHolderExtent(source, [])).toEqual({ matches: false, acres: null })
  })
  it('keeps conflicting holder IDs across approved spellings unknown rather than counting twice', () => {
    const alias = 'Synthetic alias'
    expect(matchingHolderExtent(record([owner(), owner({ name: alias })]), [target, alias])).toEqual({ matches: true, acres: null })
  })
  it('uses only an exact matching holder share and converts forty guntas to one acre', () => {
    const output = matchingHolderExtent(record([owner(), owner({ ownerNumber: '2', name: 'Synthetic other holder', extent: { acres: '47', guntas: '30', fractionalGuntas: '0' } })]), 'ಎನ್.ಸಿ.ಸ್ವಾಮಿ')
    expect(output).toEqual({ matches: true, acres: 2.25 })
    expect(output.acres).not.toBe(50)
  })
  it('sums distinct matching shares and deduplicates identical repeated source rows', () => {
    const first = owner(), second = owner({ ownerNumber: '2', extent: { acres: '0', guntas: '30', fractionalGuntas: '0' } })
    expect(matchingHolderExtent(record([first, { ...first }, second]), target)).toEqual({ matches: true, acres: 3 })
  })
  it('deduplicates repeated rows when only main holder numbers or no holder numbers are supplied', () => {
    for (const first of [owner({ ownerNumber: null, mainOwnerNumber: '3' }), owner({ ownerNumber: null, mainOwnerNumber: null })]) expect(matchingHolderExtent(record([first, { ...first }]), target)).toEqual({ matches: true, acres: 2.25 })
  })
  it('keeps conflicting owner or main-owner identities as unknown instead of double counting', () => {
    for (const owners of [
      [owner(), owner({ extent: { acres: '3', guntas: '0', fractionalGuntas: '0' } })],
      [owner({ mainOwnerNumber: '3' }), owner({ ownerNumber: '2', mainOwnerNumber: '3' })],
      [owner({ ownerNumber: null, mainOwnerNumber: '3' }), owner({ ownerNumber: null, mainOwnerNumber: '3', fatherName: 'Conflicting parent' })]
    ]) expect(matchingHolderExtent(record(owners), target)).toEqual({ matches: true, acres: null })
  })
  it.each(['4', '0.25', null, '-1', 'invalid'])('does not guess the API encoding of fractional field %s', fractionalGuntas => {
    expect(matchingHolderExtent(record([owner({ extent: { acres: '2', guntas: '10', fractionalGuntas } })]), target)).toEqual({ matches: true, acres: null })
  })
  it('retains exact zero fractions, recognizes decimal fields and rejects malformed or missing shares', () => {
    expect(matchingHolderExtent(record([owner({ extent: { acres: '02.00', guntas: '10.00', fractionalGuntas: '00.00' } })]), target).acres).toBe(2.25)
    for (const extent of [{ acres: null, guntas: '0', fractionalGuntas: '0' }, { acres: '-2', guntas: '0', fractionalGuntas: '0' }, { acres: '1000000001', guntas: '0', fractionalGuntas: '0' }]) expect(matchingHolderExtent(record([owner({ extent })]), target).acres).toBeNull()
  })
  it('flags an impossible sum larger than the source parcel instead of inventing an owned area', () => {
    const source = record(); source.extent = { acres: '1', guntas: '0', fractionalGuntas: '0' }
    expect(matchingHolderExtent(source, target)).toEqual({ matches: true, acres: null })
  })
  it('reports nonmatches without interpreting other holders or an empty target', () => {
    expect(matchingHolderExtent(record(), 'Synthetic other holder')).toEqual({ matches: false, acres: null })
    expect(matchingHolderExtent(record([owner({ name: null })]), '')).toEqual({ matches: false, acres: null })
  })
})

describe('public whole-survey inventory', () => {
  const ring = [[75, 13], [75.01, 13], [75.01, 13.01], [75, 13.01], [75, 13]]
  const collection = (village: typeof SURVEY_VILLAGES[number], surveys: number[]) => ({ type: 'FeatureCollection', features: surveys.map(survey => ({ type: 'Feature', properties: { KGISVillageCode: village.bhoomi, LGD_VillageCode: village.lgd, surveynumberi: survey, Owner: 'Excluded' }, geometry: { type: 'Polygon', coordinates: [ring] } })) })
  it('deduplicates survey identities and sorts them numerically per exact supported village', () => {
    const [hebbasale, devihalli] = SURVEY_VILLAGES
    const output = buildSurveyInventory([{ villageCode: devihalli.bhoomi, geojson: collection(devihalli, [72, 1]) }, { villageCode: hebbasale.bhoomi, geojson: collection(hebbasale, [41, 2, 2]) }])
    expect(output).toEqual([{ villageCode: hebbasale.bhoomi, surveyNumber: '2' }, { villageCode: hebbasale.bhoomi, surveyNumber: '41' }, { villageCode: devihalli.bhoomi, surveyNumber: '1' }, { villageCode: devihalli.bhoomi, surveyNumber: '72' }])
    expect(JSON.stringify(output)).not.toContain('Owner')
  })
  it('fails closed for an unsupported village or a foreign-village geometry snapshot', () => {
    expect(() => buildSurveyInventory([{ villageCode: 'foreign', geojson: {} }])).toThrow('Unsupported')
    expect(() => buildSurveyInventory([{ villageCode: SURVEY_VILLAGES[0].bhoomi, geojson: collection(SURVEY_VILLAGES[1], [1]) }])).toThrow('another village')
  })
})

describe('nonpersonal private lookup result', () => {
  it('returns only a matching record identity, extent and references', async () => {
    const source = record()
    Object.assign(source.identity, { privateHolderField: target })
    const lookup = vi.fn().mockResolvedValue(source)
    const output = await lookupOwnedRtc(identity, target, lookup)
    expect(output).toEqual(match())
    expect(lookup).toHaveBeenCalledWith(identity)
    expect(output).not.toHaveProperty('owners'); expect(output).not.toHaveProperty('name'); expect(JSON.stringify(output)).not.toContain(target)
  })
  it('preserves matched records with an unknown share and returns null for nonmatches', async () => {
    expect(await lookupOwnedRtc(identity, target, async () => record([owner({ extent: { acres: '2', guntas: '0', fractionalGuntas: '4' } })]))).toMatchObject({ matchedAcres: null })
    expect(await lookupOwnedRtc(identity, 'Synthetic other holder', async () => record())).toBeNull()
  })
  it('does not permit an injected lookup to return a different survey record', async () => {
    await expect(lookupOwnedRtc(identity, target, async () => ({ ...record(), identity: { ...identity, surveyNumber: '99' } }))).rejects.toThrow('identity')
  })
})

describe('partial holdings coverage and nonoverlapping recorded shares', () => {
  it('shows a known subtotal while coverage is partial and only gives a total after completion', () => {
    expect(aggregateMatches([match()])).toMatchObject({ knownAcres: 2.25, totalAcres: null, coverageComplete: false })
    expect(aggregateMatches([match()], true)).toEqual({ knownAcres: 2.25, totalAcres: 2.25, coverageComplete: true, unknownCount: 0, overlapCount: 0, uniqueRecords: 1 })
  })
  it('deduplicates exact village/land code and preserves independent villages', () => {
    const otherVillage = match({ identity: { ...identity, villageCode: '2301110012' } })
    expect(aggregateMatches([match(), match(), otherVillage], true)).toMatchObject({ knownAcres: 4.5, uniqueRecords: 2, totalAcres: 4.5 })
  })
  it('retains known acres when another parcel has an unknown share', () => {
    expect(aggregateMatches([match(), match({ landCode: 'other-land', matchedAcres: null })], true)).toMatchObject({ knownAcres: 2.25, unknownCount: 1, totalAcres: null, uniqueRecords: 2 })
  })
  it('marks conflicting amounts for the same land code as unknown', () => {
    expect(aggregateMatches([match(), match({ matchedAcres: 3 })], true)).toMatchObject({ knownAcres: 0, unknownCount: 1, totalAcres: null, uniqueRecords: 1 })
  })
  it('excludes a whole-survey share when numbered records in the same survey may overlap', () => {
    const whole = match({ landCode: 'whole-land', identity: { ...identity, hissaNumber: '*' }, matchedAcres: 10 })
    expect(aggregateMatches([whole, match()], true)).toMatchObject({ knownAcres: 2.25, unknownCount: 1, overlapCount: 1, totalAcres: null, uniqueRecords: 2 })
  })
  it('keeps unrelated whole records and deduplicates whole/specific aliases with the same land code', () => {
    const unrelated = match({ landCode: 'whole-land', identity: { ...identity, surveyNumber: '73', hissaNumber: '*' }, matchedAcres: 10 })
    const alias = match({ identity: { ...identity, hissaNumber: '*' } })
    expect(aggregateMatches([unrelated, match(), alias], true)).toMatchObject({ knownAcres: 12.25, unknownCount: 0, overlapCount: 0, totalAcres: 12.25, uniqueRecords: 2 })
  })
})
