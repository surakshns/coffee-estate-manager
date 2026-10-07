import { describe, expect, it, vi, afterEach } from 'vitest'
import { emptyFarmProfile, emptyBlockCrop, matchUpdate, nearestStation, insuranceAvailability, schemeEligibility, updateStale, updateDedupeKey, cropRisk, wantsAlert, type OfficialUpdate, type Crop } from './farmIntelligence'
const profile=()=>{const p=emptyFarmProfile();p.estate.latitude=12.94;p.estate.longitude=75.79;p.blocks=[{name:'Test mixed block',area:6,area_unit:'acre',latitude:null,longitude:null,irrigation_type:null,water_source:null,notes:null,crops:[emptyBlockCrop('COFFEE'),emptyBlockCrop('PEPPER')]}];return p}
const update=(patch:Partial<OfficialUpdate>={}):OfficialUpdate=>({source_id:'test-official',source_name:'Test official source',source_url:'https://coffeeboard.gov.in/',source_type:'official',source_authority_level:1,retrieved_at:'2026-10-07T01:00:00Z',source_published_at:'2026-10-06',source_updated_at:null,effective_from:null,effective_until:null,financial_year:'2026-27',season:null,raw_source_reference:'SYNTHETIC test fixture',verification_status:'OFFICIAL_CONFIRMED',title:'Test agricultural update',summary:'Test only',category:'schemes',crops:['COFFEE'],state:'Karnataka',district:'Hassan',taluk:'Sakleshpur',village:null,application_deadline:null,application_url:null,dedupe_key:'a'.repeat(64),details:{},...patch})
afterEach(()=>vi.useRealTimers())
describe('estate matching and freshness',()=>{
  it('matches Sakleshpur location and intercropped crops with reasons',()=>{
    const match=matchUpdate(update({crops:['PEPPER'],taluk:'Sakaleshpura'}),profile(),'2026-10-07')
    expect(match.relevant).toBe(true);expect(match.score).toBeGreaterThan(100)
    expect(match.reasons.join(' ')).toContain('pepper')
  })
  it('retains district weather for a location-only profile without claiming crop-specific advice',()=>{
    const p=emptyFarmProfile(),row=update({category:'weather',crops:['COFFEE','PEPPER','ARECANUT']})
    expect(matchUpdate(row,p,'2026-10-07')).toMatchObject({relevant:true,missing:['Record crop presence before using crop-specific weather advice.']})
    expect(wantsAlert(row,p)).toBe(true)
  })
  it('does not apply an Arabica-specific release to known Robusta-only blocks',()=>{
    const p=profile();p.blocks[0].crops[0].coffee_type='Robusta'
    expect(matchUpdate(update({category:'government',details:{coffee_types:['Arabica']}}),p,'2026-10-07').relevant).toBe(false)
    p.blocks[0].crops[0].coffee_type=null
    expect(matchUpdate(update({category:'government',details:{coffee_types:['Arabica']}}),p,'2026-10-07').missing.join(' ')).toContain('coffee type')
  })
  it('excludes other districts, absent crops, old periods and lifestyle content',()=>{
    for(const patch of [{district:'Kodagu'},{crops:['ARECANUT'] as Crop[]},{effective_until:'2026-09-30'},{verification_status:'OFFICIAL_BUT_OLD' as const},{title:'Celebrity latte art coffee recipes',state:null,district:null,taluk:null}]) expect(matchUpdate(update(patch),profile(),'2026-10-07').relevant).toBe(false)
    expect(matchUpdate(update({details:{scope:'non_traditional_area'}}),profile(),'2026-10-07').relevant).toBe(false)
  })
  it('expires date-only deadlines after their Indian calendar day, not before',()=>{
    expect(matchUpdate(update({application_deadline:'2026-10-07'}),profile(),'2026-10-07').relevant).toBe(true)
    expect(matchUpdate(update({application_deadline:'2026-10-07'}),profile(),'2026-10-08').relevant).toBe(false)
  })
  it('uses price date for stale status even if an old quote was retrieved today',()=>{
    expect(updateStale(update({category:'prices',details:{price_date:'2026-06-05'}}),Date.parse('2026-10-07'))).toBe(true)
    expect(updateStale(update({category:'weather'}),Date.parse('2026-10-07T08:00:00Z'))).toBe(true)
  })
  it('respects per-crop and disabled alert preferences',()=>{
    const p=profile(),row=update({category:'prices',crops:['PEPPER']})
    expect(wantsAlert(row,p)).toBe(true)
    p.preferences.find(i=>i.kind==='pepper_prices')!.crops=['COFFEE']
    expect(wantsAlert(row,p)).toBe(false)
    p.preferences.find(i=>i.kind==='pepper_prices')!.enabled=false
    expect(wantsAlert(row,p)).toBe(false)
  })
  it('deduplicates normalized URLs without merging publishers or dated occurrences',async()=>{
    const key=await updateDedupeKey('official','https://coffeeboard.gov.in/?a=1','  Training notice  ','2026-10-07')
    expect(await updateDedupeKey('official','https://coffeeboard.gov.in/?utm_source=test&a=1#notice','training notice','2026-10-07')).toBe(key)
    expect(await updateDedupeKey('media','https://coffeeboard.gov.in/?a=1','training notice','2026-10-07')).not.toBe(key)
  })
})
describe('conservative eligibility and insurance',()=>{
  it('requires missing crop/financial-year/component evidence before eligibility',()=>{
    expect(schemeEligibility(update(),emptyFarmProfile(),{verified:true,financial_year:'2026-27'},'2026-10-07').status).toBe('NEEDS_INFORMATION')
    expect(schemeEligibility(update(),profile(),{verified:false,financial_year:'2026-27'},'2026-10-07').status).toBe('NEEDS_INFORMATION')
    expect(schemeEligibility(update(),profile(),{verified:true,financial_year:'2024-25'},'2026-10-07').status).toBe('NEEDS_INFORMATION')
  })
  it('converts acres to hectares and explains outstanding eligibility conditions',()=>{
    const p=profile();p.farmer.farmer_type='individual';p.farmer.total_agricultural_landholding=10
    const rules={verified:true,financial_year:'2026-27',farmer_types:['individual'],max_land_ha:5,land_basis:'total_agricultural' as const}
    expect(schemeEligibility(update(),p,rules,'2026-10-07').status).toBe('LIKELY_ELIGIBLE')
    expect(schemeEligibility(update(),p,{...rules,max_land_ha:2},'2026-10-07').status).toBe('NOT_ELIGIBLE')
    expect(schemeEligibility(update(),p,{...rules,further_checks:['Check prior subsidy exclusion period.']},'2026-10-07').status).toBe('POSSIBLY_ELIGIBLE')
    expect(schemeEligibility(update({source_type:'verified_media',source_authority_level:3}),p,rules,'2026-10-07').status).toBe('NEEDS_INFORMATION')
    expect(schemeEligibility(update(),p,{...rules,land_basis:undefined},'2026-10-07').missing.join(' ')).toContain('landholding basis')
  })
  it.each(['COFFEE','PEPPER','ARECANUT'] as Crop[])('does not calculate %s from user-reported policy fields',crop=>{
    const policy={...emptyFarmProfile().insurance.find(p=>p.crop===crop)!,currently_insured:true,policy_year:'2026-27',season:'Kharif',sum_insured:100000,premium_paid:5000}
    const result=insuranceAvailability(policy)
    expect(result.available).toBe(false);expect(result.estimated_claim).toBeNull();expect(result.missing).toContain('official crop coverage')
  })
  it('rejects substitute station data even when every other evidence flag is true',()=>{
    const policy={...emptyFarmProfile().insurance[0],policy_year:'2026-27',season:'Kharif'}
    const evidence={crop:'COFFEE' as const,policy_year:'2026-27',season:'Kharif',insurance_unit_verified:true,coverage_verified:true,insurer_verified:true,terms_verified:true,sum_insured_verified:true,premium_verified:true,trigger_verified:true,reference_station_id:'notified',mapping_verified:true,observation_station_id:'nearest',observations_verified:true,formula_verified:true}
    const result=insuranceAvailability(policy,evidence)
    expect(result.missing).toContain('official observations from the notified station');expect(result.estimated_claim).toBeNull()
    expect(insuranceAvailability(policy,{...evidence,observation_station_id:'notified'}).available).toBe(false) // still no reviewed formula implementation/example
  })
})
describe('station selection and advisory-backed risks',()=>{
  it('chooses only active verified stations using saved coordinates',()=>{
    const p=profile(),station={id:'verified',provider:'Test official',station_id:'1',station_name:'Test station',latitude:12.95,longitude:75.79,district:'Hassan',taluk:'Sakleshpur',verified:true,active_status:true}
    const result=nearestStation(p,[{...station,id:'closer-unverified',latitude:12.94,verified:false},station])
    expect(result?.id).toBe('verified');expect(result?.distance_km).toBeCloseTo(1.112,2)
    p.estate.latitude=null;p.estate.longitude=null;expect(nearestStation(p,[station])).toBeNull()
  })
  it('requires reviewed official advisory, local crop and fresh matching weather',()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
    const input={advisory:update({category:'pest',effective_from:'2026-10-06',effective_until:'2026-10-10'}),advisory_reviewed:true,source_page:2,crop:'COFFEE' as const,forecast:update({category:'weather',effective_from:'2026-10-07',effective_until:'2026-10-07'}),conditions_verified:true,conditions_match:true,risk_name:'a test risk'}
    expect(cropRisk(profile(),input)).toMatchObject({diagnosis:false,title:'Conditions may favour a test risk.'})
    expect(cropRisk(profile(),{...input,advisory_reviewed:false})).toBeNull()
    expect(cropRisk(profile(),{...input,source_page:null})).toBeNull()
    expect(cropRisk(profile(),{...input,forecast:update({category:'weather',district:'Kodagu'})})).toBeNull()
    expect(cropRisk(profile(),{...input,conditions_match:false})).toBeNull()
    expect(cropRisk(profile(),{...input,advisory:update({category:'prices'})})).toBeNull()
    expect(cropRisk(profile(),{...input,advisory:{...input.advisory,effective_until:'2026-10-06'}})).toBeNull()
    expect(cropRisk(profile(),{...input,advisory:{...input.advisory,village:'Unrecorded test village'}})).toBeNull()
  })
})
