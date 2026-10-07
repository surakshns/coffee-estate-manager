import { describe, expect, it } from 'vitest'
import { parcelDetails, parcelLookupText } from './farmParcelDetails'
import { selectionPatch, SURVEY_VILLAGES, type Position, type SurveyParcel } from './farmSurveyMap'
const ring: Position[] = [[75,13],[75.01,13],[75.01,13.01],[75,13.01],[75,13]]
const parcel: SurveyParcel = { key: '12:*:', survey: '12', surnoc: '*', hissa: null, polygons: [[ring]] }

describe('reusable parcel reference details', () => {
  it('returns a plausible metric area and geographic bounds, independently of ring direction', () => {
    const details = parcelDetails(parcel)
    expect(details.mapped_area_m2).toBeGreaterThan(1190000)
    expect(details.mapped_area_m2).toBeLessThan(1220000)
    expect(details.bounds).toEqual([75,13,75.01,13.01])
    expect(parcelDetails({ ...parcel, polygons: [[[...ring].reverse()]] }).mapped_area_m2).toBe(details.mapped_area_m2)
  })
  it('subtracts holes and includes disjoint geometry parts', () => {
    const hole: Position[] = [[75.0025,13.0025],[75.0075,13.0025],[75.0075,13.0075],[75.0025,13.0075],[75.0025,13.0025]]
    const outer = parcelDetails(parcel).mapped_area_m2
    expect(parcelDetails({ ...parcel, polygons: [[ring,hole]] }).mapped_area_m2 / outer).toBeCloseTo(.75, 5)
    const next = ring.map(([lon,lat]) => [lon + .02,lat] as Position)
    const multi = parcelDetails({ ...parcel, polygons: [[ring],[next]] })
    expect(multi.geometry_parts).toBe(2);expect(multi.mapped_area_m2 / outer).toBeCloseTo(2,5)
  })
  it('saves reference measurements without converting them into owned estate or crop area', () => {
    const patch = selectionPatch({ village: SURVEY_VILLAGES[0], parcel, latitude:13.005,longitude:75.005,sourceUrl:'https://kgis.ksrsac.in/source',retrievedAt:'2026-10-07T13:00:00Z',level:'whole_survey' })
    expect(patch.location_source?.parcel_details).toMatchObject({ lgd_village_code:614874, geometry_parts:1, area_method:'local_projection', record_match:'not_checked' })
    expect(patch.total_area).toBeUndefined();expect(patch.cultivated_area).toBeUndefined()
    expect(patch.location_source).not.toHaveProperty('owner')
  })
  it('creates complete official lookup identifiers without inventing a Hissa or owner', () => {
    const text = parcelLookupText({ village:SURVEY_VILLAGES[0],parcel })
    expect(text).toContain('Surnoc: *');expect(text).toContain('Village code: 2301110012')
    expect(text).toContain('Select the correct Hissa');expect(text).not.toContain('Owner:')
  })
  it('keeps only a matching non-personal RTC reference without copying holders or replacing area', () => {
    const selection = { village:SURVEY_VILLAGES[0],parcel:{...parcel,hissa:'1'},latitude:13.005,longitude:75.005,sourceUrl:'https://kgis.ksrsac.in/source',retrievedAt:'2026-10-07T13:00:00Z',level:'hissa' as const,rtcRecord:{identity:{villageCode:'2301110012' as const,surveyNumber:'12',surnoc:'*',hissaNumber:'1'},villageName:'Hebbasale',landCode:'123',ulpin:null,extent:{acres:'2',guntas:'3',fractionalGuntas:'4'},owners:[{ownerNumber:null,mainOwnerNumber:null,name:'Synthetic holder',fatherName:null,category:null,extent:{acres:'2',guntas:'3',fractionalGuntas:'4'},governmentRestriction:null,governmentRestrictionOwnerCategory:null,courtStay:null}],sourceUrl:'https://rdservices.karnataka.gov.in/BhoomiMaps/',retrievedAt:'2026-10-07T13:00:00Z'} }
    const patch=selectionPatch(selection)
    expect(patch.location_source?.rtc_reference).toMatchObject({land_code:'123',recorded_extent:{acres:'2',guntas:'3',fractional_guntas:'4'}})
    expect(JSON.stringify(patch)).not.toContain('Synthetic holder');expect(patch.total_area).toBeUndefined()
    expect(selectionPatch({...selection,parcel:{...parcel,hissa:'2'}}).location_source?.rtc_reference).toBeUndefined()
  })
})
