import { afterEach, describe, expect, it, vi } from 'vitest'
const api=vi.hoisted(()=>({from:vi.fn()}))
vi.mock('./supabase',()=>({supabase:api}))
import { clearSurveyMapCache, loadSurveyParcels, parcelPoint, parseSurveyParcels, pointInRing, selectionPatch, surveyQuery, SURVEY_VILLAGES, type Position, type SurveyParcel } from './farmSurveyMap'
import { hissaQuery } from '../../supabase/functions/_shared/farmSurveyMap'
const village = SURVEY_VILLAGES[0]
const ring: Position[] = [[75,13],[75.01,13],[75.01,13.01],[75,13.01],[75,13]]
const feature = (patch:Record<string,unknown>={}, coords=ring) => ({ type:'Feature', properties:{ KGISVillageCode:village.bhoomi,LGD_VillageCode:village.lgd,surveynumberi:12,Surnoc:'*',HissaNo:null,...patch }, geometry:{type:'Polygon',coordinates:[coords]} })
const collection = (features:unknown[]) => ({ type:'FeatureCollection',features })
afterEach(()=>{clearSurveyMapCache();vi.clearAllMocks()})

describe('official survey map integrity',()=>{
  it('retains multipart surveys, excludes zero labels and preserves unknown Surnoc',()=>{
    const parcels=parseSurveyParcels(collection([feature(),feature(),feature({surveynumberi:0})]),village)
    expect(parcels).toHaveLength(1);expect(parcels[0].polygons).toHaveLength(2);expect(parcels[0].surnoc).toBe('*')
  })
  it('rejects foreign villages, truncated data, wrong CRS and malformed geometry',()=>{
    expect(()=>parseSurveyParcels(collection([feature({KGISVillageCode:'wrong'})]),village)).toThrow('another village')
    expect(()=>parseSurveyParcels({...collection([]),exceededTransferLimit:true},village)).toThrow('incomplete')
    expect(()=>parseSurveyParcels(collection([feature({},[[400000,1400000],[1,2],[1,3],[400000,1400000]])]),village)).toThrow('coordinates')
    expect(()=>parseSurveyParcels(collection([feature({},ring.slice(0,4))]),village)).toThrow('not closed')
  })
  it('offers only positively numbered subdivisions explicitly matching Bhoomi',()=>{
    const rows=parseSurveyParcels(collection(['Valid-Matching to Bhoomi Records\n','Valid-Kharab Lands','Invalid-Not Matching to Bhoomi',null].map((status,i)=>feature({HissaNo:String(i+1),HissaCategory:status}))),village,true)
    expect(rows.map(row=>row.hissa)).toEqual(['1'])
    expect(parseSurveyParcels(collection([feature({HissaNo:'0',HissaCategory:'Valid-Matching to Bhoomi Records'})]),village,true)).toEqual([])
  })
  it('finds a point inside a concave parcel without placing it inside a hole',()=>{
    const outer:Position[]=[[75,13],[75.02,13],[75.02,13.02],[75.015,13.02],[75.015,13.005],[75.005,13.005],[75.005,13.02],[75,13.02],[75,13]]
    const hole:Position[]=[[75.001,13.001],[75.004,13.001],[75.004,13.004],[75.001,13.004],[75.001,13.001]]
    const parcel:SurveyParcel={key:'1',survey:'1',surnoc:null,hissa:null,polygons:[[outer,hole]]}
    const point=parcelPoint(parcel)
    expect(pointInRing(point,outer)).toBe(true);expect(pointInRing(point,hole)).toBe(false)
  })
  it('fills only known administrative and map details, keeping elevation and estate acreage unknown',()=>{
    const parcel=parseSurveyParcels(collection([feature()]),village)[0],point=parcelPoint(parcel)
    const patch=selectionPatch({village,parcel,longitude:point[0],latitude:point[1],sourceUrl:surveyQuery(village),retrievedAt:'2026-10-07T00:00:00Z',level:'whole_survey'})
    expect(patch).toMatchObject({state:'Karnataka',district:'Hassan',taluk:'Sakleshpur',hobli:'Kasaba',village:'Hebbasale',survey_numbers:['12'],elevation_m:null,location_source:{provider:'KGIS',surnoc:'*',coordinate_method:'point_inside_polygon'}})
    expect(patch.total_area).toBeUndefined()
  })
  it('uses only fixed official endpoints and protects query values from injection',()=>{
    expect(surveyQuery(village)).toContain('https://kgis.ksrsac.in/')
    expect(()=>surveyQuery(village,'1 OR 1=1')).toThrow()
    expect(()=>surveyQuery({...village,bhoomi:'bad'} as unknown as typeof village)).toThrow()
  })
  it('loads saved reference geometry without fetching the publisher and preserves its actual date',async()=>{
    const retrievedAt='2026-10-06T12:00:00Z'
    const reader=vi.fn().mockResolvedValue({data:{village_code:village.bhoomi,layer:'whole_survey',geojson:collection([feature()]),source_url:surveyQuery(village),retrieved_at:retrievedAt},error:null})
    const result=await loadSurveyParcels(village,new AbortController().signal,undefined,reader)
    expect(reader).toHaveBeenCalledWith(village,'whole_survey',expect.any(AbortSignal))
    expect(result.parcels).toHaveLength(1);expect(result.retrievedAt).toBe(retrievedAt)
  })
  it('filters the saved subdivision map to the selected survey',async()=>{
    const geojson=collection([feature({HissaNo:'1',HissaCategory:'Valid-Matching to Bhoomi Records'}),feature({HissaNo:'2',HissaCategory:'Valid-Matching to Bhoomi Records',surveynumberi:13})])
    const reader=vi.fn().mockResolvedValue({data:{village_code:village.bhoomi,layer:'hissa',geojson,source_url:hissaQuery(village),retrieved_at:'2026-10-06T12:00:00Z'},error:null})
    const result=await loadSurveyParcels(village,new AbortController().signal,'12',reader)
    expect(result.parcels.map(p=>[p.survey,p.hissa])).toEqual([['12','1']])
    expect(result.sourceUrl).toBe(hissaQuery(village))
  })
  it('reads through the authenticated database client and reuses public geometry for other Hissa selections',async()=>{
    const data={village_code:village.bhoomi,layer:'hissa',geojson:collection([feature({HissaNo:'1',HissaCategory:'Valid-Matching to Bhoomi Records'}),feature({HissaNo:'2',HissaCategory:'Valid-Matching to Bhoomi Records',surveynumberi:13})]),source_url:hissaQuery(village),retrieved_at:'2026-10-06T12:00:00Z'}
    const query={select:vi.fn(),eq:vi.fn(),abortSignal:vi.fn(),single:vi.fn().mockResolvedValue({data,error:null})}
    for(const method of ['select','eq','abortSignal'] as const) query[method].mockReturnValue(query)
    api.from.mockReturnValue(query)
    const signal=new AbortController().signal
    expect((await loadSurveyParcels(village,signal,'12')).parcels[0].survey).toBe('12')
    expect((await loadSurveyParcels(village,signal,'13')).parcels[0].survey).toBe('13')
    expect(api.from).toHaveBeenCalledExactlyOnceWith('farm_survey_maps')
    expect(query.eq).toHaveBeenCalledWith('village_code',village.bhoomi)
    expect(query.eq).toHaveBeenCalledWith('layer','hissa')
    expect(query.abortSignal).toHaveBeenCalledExactlyOnceWith(signal)
    clearSurveyMapCache();await loadSurveyParcels(village,signal,'12')
    expect(query.single).toHaveBeenCalledTimes(2)
  })
  it('rejects cache failures, source spoofing and cancelled requests',async()=>{
    await expect(loadSurveyParcels(village,new AbortController().signal,undefined,vi.fn().mockResolvedValue({data:null,error:{message:'offline'}}))).rejects.toThrow('could not be loaded')
    const row={village_code:village.bhoomi,layer:'whole_survey',geojson:collection([feature()]),source_url:surveyQuery(village),retrieved_at:'2026-10-06T12:00:00Z'}
    for(const patch of [{village_code:'wrong'},{source_url:'https://evil.invalid/'},{retrieved_at:'invalid'},{layer:'hissa'}]) {
      await expect(loadSurveyParcels(village,new AbortController().signal,undefined,vi.fn().mockResolvedValue({data:{...row,...patch},error:null}))).rejects.toThrow('source could not be verified')
    }
    const controller=new AbortController();controller.abort();const reader=vi.fn()
    await expect(loadSurveyParcels(village,controller.signal,undefined,reader)).rejects.toMatchObject({name:'AbortError'})
    expect(reader).not.toHaveBeenCalled()
  })
})
