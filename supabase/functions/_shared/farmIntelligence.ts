// Shared, network-free contracts and conservative matching used by the UI and ingestion.
export type Crop = 'COFFEE' | 'PEPPER' | 'ARECANUT'
export type AreaUnit = 'acre' | 'hectare'
export type VerificationStatus = 'OFFICIAL_CONFIRMED' | 'OFFICIAL_BUT_OLD' | 'SECONDARY_CONFIRMED' | 'UNVERIFIED' | 'EXPIRED'
export type UpdateCategory = 'schemes' | 'insurance' | 'weather' | 'pest' | 'prices' | 'government' | 'news' | 'training' | 'relief'
export const CROPS: Crop[] = ['COFFEE', 'PEPPER', 'ARECANUT']
export const ALERT_KINDS = ['government_schemes', 'subsidy_deadlines', 'insurance_enrollment', 'insurance_updates', 'heavy_rainfall', 'drought', 'weather_warning', 'pest_risk', 'disease_risk', 'spray_weather', 'coffee_prices', 'pepper_prices', 'arecanut_prices', 'coffee_board_updates', 'spices_board_updates', 'local_news', 'training_events', 'disaster_relief'] as const
export type AlertKind = typeof ALERT_KINDS[number]

export interface FarmLocationSource {
  provider: 'KGIS'
  village_code: string
  survey_number: string
  hissa: string | null
  surnoc?: string | null
  level: 'whole_survey' | 'hissa'
  coordinate_method: 'point_inside_polygon'
  source_url: string
  retrieved_at: string
}

export interface EstateInput {
  id?: string
  estate_name: string | null
  state: string
  district: string
  taluk: string
  hobli: string | null
  gram_panchayat: string | null
  village: string | null
  pincode: string | null
  latitude: number | null
  longitude: number | null
  total_area: number | null
  area_unit: AreaUnit
  cultivated_area: number | null
  survey_numbers: string[]
  elevation_m: number | null
  location_source?: FarmLocationSource | null
}
export interface BlockCropInput {
  id?: string
  crop: Crop
  coffee_type: 'Arabica' | 'Robusta' | null
  variety: string | null
  area: number | null
  area_unit: AreaUnit
  planting_year: number | null
  age_years: number | null
  number_of_plants: number | null
  bearing_area: number | null
  non_bearing_area: number | null
  bearing_plants: number | null
  non_bearing_plants: number | null
  processing_type: 'cherry' | 'parchment' | 'both' | null
  support_tree_type: string | null
  estimated_annual_production: number | null
  production_unit: string | null
  is_intercrop: boolean | null
}
export interface FarmBlockInput {
  id?: string
  name: string
  area: number | null
  area_unit: AreaUnit
  latitude: number | null
  longitude: number | null
  irrigation_type: string | null
  water_source: string | null
  notes: string | null
  crops: BlockCropInput[]
}
export interface FarmInfrastructureInput {
  water_sources: string[]
  irrigation: string[]
  irrigated_area: number | null
  rainfed_area: number | null
  area_unit: AreaUnit
  water_storage_capacity_l: number | null
  pump_hp: number | null
  summer_water_shortage: boolean | null
  equipment: string[]
}
export interface FarmerProfileInput {
  farmer_type: 'individual' | 'partnership' | 'company' | 'FPO' | 'cooperative' | 'other' | null
  total_agricultural_landholding: number | null
  area_unit: AreaUnit
  coffee_board_grower_id_available: boolean | null
  fpo_member: boolean | null
  cooperative_member: boolean | null
  government_registration_status: string | null
}
export interface InsuranceProfileInput {
  crop: Crop
  currently_insured: boolean | null
  scheme_name: string | null
  insurer: string | null
  policy_year: string | null
  season: string | null
  sum_insured: number | null
  premium_paid: number | null
  weather_station_name: string | null
  weather_station_id: string | null
}
export interface AlertPreferenceInput { kind: AlertKind; enabled: boolean; crops: Crop[] }
export interface FarmProfile {
  estate: EstateInput
  blocks: FarmBlockInput[]
  infrastructure: FarmInfrastructureInput
  farmer: FarmerProfileInput
  insurance: InsuranceProfileInput[]
  preferences: AlertPreferenceInput[]
}

export interface DataSourceStatus {
  id: string
  source_name: string
  source_url: string
  source_type: 'official' | 'authoritative' | 'verified_media' | 'other' | 'model'
  source_authority_level: number
  enabled: boolean
  status: 'ready' | 'manual_review' | 'unavailable' | 'credentials_required' | 'permission_required'
  status_message: string
  min_interval_minutes: number
  last_success_at: string | null
  last_checked_at: string | null
}
export interface OfficialUpdate {
  id?: string
  source_id: string
  source_name: string
  source_url: string
  source_type: DataSourceStatus['source_type']
  source_authority_level: number
  retrieved_at: string
  source_published_at: string | null
  source_updated_at: string | null
  effective_from: string | null
  effective_until: string | null
  financial_year: string | null
  season: string | null
  raw_source_reference: string
  verification_status: VerificationStatus
  title: string
  summary: string
  category: UpdateCategory
  crops: Crop[]
  state: string | null
  district: string | null
  taluk: string | null
  village: string | null
  application_deadline: string | null
  application_url: string | null
  dedupe_key: string
  details: Record<string, unknown>
}
export interface MarketPrice {
  id?: string
  update_id?: string
  source_id: string
  crop: Crop
  variety: string | null
  grade: string | null
  market: string
  district: string | null
  state: string | null
  min_price: number | null
  max_price: number | null
  modal_price: number | null
  average_price: number | null
  unit: string
  price_date: string
  price_kind: 'indicative' | 'international_indicator' | 'futures' | 'mandi'
  source_url: string
  retrieved_at: string
}
export interface VerifiedStation {
  id: string
  provider: string
  station_id: string
  station_name: string
  latitude: number
  longitude: number
  district: string | null
  taluk: string | null
  active_status: boolean
  verified: boolean
}
export interface RainfallObservation { id:string;station_id:string;observed_at:string;period_start:string;period_end:string;rainfall_mm:number|null;source_url:string;retrieved_at:string;quality_status:'verified'|'provisional'|'missing'|'revised'|'invalid' }
export interface EstateAlert { update_id:string;read_at:string|null }
export interface FarmSnapshot { profile: FarmProfile | null; updates: OfficialUpdate[]; prices: MarketPrice[]; sources: DataSourceStatus[]; stations: VerifiedStation[]; observations:RainfallObservation[]; alerts:EstateAlert[] }

export function emptyFarmProfile(): FarmProfile {
  return {
    estate: { estate_name: null, state: 'Karnataka', district: 'Hassan', taluk: 'Sakleshpur', hobli: null, gram_panchayat: null, village: null, pincode: null, latitude: null, longitude: null, total_area: null, cultivated_area: null, area_unit: 'acre', survey_numbers: [], elevation_m: null },
    blocks: [],
    infrastructure: { water_sources: [], irrigation: [], irrigated_area: null, rainfed_area: null, area_unit: 'acre', water_storage_capacity_l: null, pump_hp: null, summer_water_shortage: null, equipment: [] },
    farmer: { farmer_type: null, total_agricultural_landholding: null, area_unit: 'acre', coffee_board_grower_id_available: null, fpo_member: null, cooperative_member: null, government_registration_status: null },
    insurance: CROPS.map(crop => ({ crop, currently_insured: null, scheme_name: null, insurer: null, policy_year: null, season: null, sum_insured: null, premium_paid: null, weather_station_name: null, weather_station_id: null })),
    preferences: ALERT_KINDS.map(kind => ({ kind, enabled: true, crops: [...CROPS] }))
  }
}
export function emptyBlockCrop(crop: Crop): BlockCropInput {
  return { crop, coffee_type: null, variety: null, area: null, area_unit: 'acre', planting_year: null, age_years: null, number_of_plants: null, bearing_area: null, non_bearing_area: null, bearing_plants: null, non_bearing_plants: null, processing_type: null, support_tree_type: null, estimated_annual_production: null, production_unit: null, is_intercrop: null }
}
export function estateCrops(profile: FarmProfile) { return [...new Set(profile.blocks.flatMap(block => block.crops.map(crop => crop.crop)))] }
export function hectares(area: number, unit: AreaUnit) { return unit === 'acre' ? area * 0.40468564224 : area }
export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  if (![a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite) || Math.abs(a.latitude) > 90 || Math.abs(b.latitude) > 90 || Math.abs(a.longitude) > 180 || Math.abs(b.longitude) > 180) return null
  const rad = (n: number) => n * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
export function nearestStation(profile: FarmProfile, stations: VerifiedStation[]) {
  const { latitude, longitude } = profile.estate
  if (latitude === null || longitude === null) return null
  return stations.filter(station => station.verified && station.active_status).map(station => ({ ...station, distance_km: haversineKm({ latitude, longitude }, station) })).filter(station => station.distance_km !== null).sort((a,b) => a.distance_km! - b.distance_km!)[0] ?? null
}
export function indiaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
export function validSourceUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port } catch { return false }
}
export function isExpired(update: OfficialUpdate, today = indiaDate()) {
  return update.verification_status === 'EXPIRED' || !!(update.effective_until && update.effective_until.slice(0,10) < today)
    || !!(update.application_deadline && update.application_deadline.length === 10 && update.application_deadline < today)
    || !!(update.application_deadline && update.application_deadline.length > 10 && Date.parse(update.application_deadline) < Date.now())
}
export function updateStale(update: OfficialUpdate, now = Date.now()) {
  const reference = update.category === 'prices' ? String(update.details.price_date ?? update.source_published_at ?? '') : update.retrieved_at
  const time = Date.parse(reference)
  const maxAge = update.category === 'weather' ? 6 * 3600000 : update.category === 'prices' ? 4 * 86400000 : 3 * 86400000
  return !Number.isFinite(time) || now - time > maxAge
}
const place = (value: string | null | undefined) => (value ?? '').toLowerCase().trim().replace(/sakaleshpura|sakleshpura/g, 'sakleshpur')
export interface EstateMatch { relevant: boolean; score: number; reasons: string[]; missing: string[] }
export function matchUpdate(update: OfficialUpdate, profile: FarmProfile, today = indiaDate()): EstateMatch {
  const reasons: string[] = [], missing: string[] = []
  let score = 0
  if (isExpired(update, today) || update.verification_status === 'OFFICIAL_BUT_OLD') return { relevant: false, score, reasons: ['The source is expired or from an older period.'], missing }
  const fiscalStart=Number(today.slice(0,4))-(Number(today.slice(5,7))<4?1:0)
  if(update.category==='schemes'&&update.financial_year&&/^\d{4}/.test(update.financial_year)&&Number(update.financial_year.slice(0,4))<fiscalStart) return {relevant:false,score:0,reasons:['The scheme belongs to an older financial year.'],missing}
  const crops = estateCrops(profile)
  const locationWeather=update.category==='weather'&&!crops.length&&!!update.district
  if (update.crops.length && !update.crops.some(crop => crops.includes(crop))&&!locationWeather) return { relevant: false, score, reasons: ['This update concerns crops outside your saved blocks.'], missing }
  if(locationWeather)missing.push('Record crop presence before using crop-specific weather advice.')
  if(Array.isArray(update.details.coffee_types)&&update.details.coffee_types.length&&update.crops.includes('COFFEE')) {
    const coffee=profile.blocks.flatMap(block=>block.crops).filter(crop=>crop.crop==='COFFEE')
    if(!coffee.some(crop=>update.details.coffee_types instanceof Array&&update.details.coffee_types.includes(crop.coffee_type))) {
      if(coffee.every(crop=>crop.coffee_type!==null))return {relevant:false,score:0,reasons:['The release concerns a different coffee type from your saved blocks.'],missing}
      missing.push('Confirm your coffee type to assess this release’s suitability.')
    }
  }
  for (const [key, weight] of [['state',30],['district',40],['taluk',50],['village',60]] as const) {
    const expected = update[key], actual = profile.estate[key]
    if (!expected || place(expected) === 'india') continue
    if (!actual) { missing.push(`Your ${key.replace('_',' ')} is needed to confirm local applicability.`); continue }
    if (place(expected) !== place(actual)) return { relevant: false, score: 0, reasons: [`The source applies to another ${key}.`], missing }
    score += weight; reasons.push(`Matches ${actual}.`)
  }
  if (update.crops.some(crop=>crops.includes(crop))) { score += 30; reasons.push(`Relevant to ${update.crops.filter(crop => crops.includes(crop)).map(crop => crop.toLowerCase()).join(' and ')} in your blocks.`) }
  if (update.category === 'schemes') score += 30
  if (update.category === 'insurance') score += 25
  if (update.category === 'pest') score += 20
  if (update.category === 'prices') score += 20
  if (update.source_authority_level === 1) score += 10
  if (/coffee recipes|cafe lifestyle|latte art|celebrity/i.test(`${update.title} ${update.summary}`)) score -= 100
  if (update.details.scope === 'non_traditional_area' && ['karnataka','kerala','tamil nadu'].includes(place(profile.estate.state))) return { relevant: false, score: 0, reasons: ['This programme targets non-traditional coffee regions.'], missing }
  if (update.verification_status === 'UNVERIFIED') missing.push('Current applicability has not been verified against the official rules.')
  if (!reasons.length) reasons.push('Broad agricultural information; local applicability needs checking.')
  return { relevant: score >= 20, score, reasons, missing }
}

export interface SchemeRules {
  verified: boolean
  financial_year: string | null
  farmer_types?: string[]
  min_land_ha?: number | null
  max_land_ha?: number | null
  land_basis?: 'total_agricultural' | 'crop_area'
  land_crop?: Crop
  grower_registration_required?: boolean
  equipment?: string[]
  equipment_requirement?: 'existing' | 'proposed_purchase'
  further_checks?: string[]
}
export function schemeEligibility(update: OfficialUpdate, profile: FarmProfile, rules: SchemeRules, today = indiaDate()) {
  const match = matchUpdate(update, profile, today)
  const missing = [...match.missing], reasons = [...match.reasons]
  const result = (status: 'NOT_ELIGIBLE' | 'POSSIBLY_ELIGIBLE' | 'LIKELY_ELIGIBLE' | 'NEEDS_INFORMATION') => ({ status, reasons, missing })
  if (!estateCrops(profile).length && update.crops.length) { missing.push('Add the crops present in your blocks before assessing eligibility.'); return result('NEEDS_INFORMATION') }
  if (!match.relevant) return result('NOT_ELIGIBLE')
  if (!rules.verified || update.verification_status !== 'OFFICIAL_CONFIRMED' || update.source_type !== 'official' || update.source_authority_level !== 1) { missing.push('Verified official component rules and the current financial year are required.'); return result('NEEDS_INFORMATION') }
  const year = Number(today.slice(0,4)) - (Number(today.slice(5,7)) < 4 ? 1 : 0)
  if (rules.financial_year !== `${year}-${String(year+1).slice(2)}` && rules.financial_year !== `${year}-${year+1}`) { missing.push('An applicable current financial-year guideline is needed.'); return result('NEEDS_INFORMATION') }
  if (rules.farmer_types?.length) {
    if (!profile.farmer.farmer_type) missing.push('Farmer type is unknown.')
    else if (!rules.farmer_types.includes(profile.farmer.farmer_type)) { reasons.push('The official component targets a different farmer type.'); return result('NOT_ELIGIBLE') }
    else reasons.push('Farmer type matches the official component.')
  }
  if (rules.min_land_ha != null || rules.max_land_ha != null) {
    let ha:number|null=null
    if(rules.land_basis==='total_agricultural') {
      const land=profile.farmer.total_agricultural_landholding
      if(land===null)missing.push('Total agricultural landholding is unknown.');else ha=hectares(land,profile.farmer.area_unit)
    } else if(rules.land_basis==='crop_area'&&rules.land_crop) {
      const records=profile.blocks.flatMap(block=>block.crops).filter(crop=>crop.crop===rules.land_crop)
      // Pepper/coffee overlap is not counted together; only this specified crop.
      if(!records.length||records.some(crop=>crop.area===null))missing.push('Complete area for the specified crop is unknown.')
      else ha=records.reduce((sum,crop)=>sum+hectares(crop.area!,crop.area_unit),0)
    } else missing.push('The official landholding basis (total land or specified crop area) needs verification.')
    if(ha!==null){if((rules.min_land_ha!=null&&ha<rules.min_land_ha)||(rules.max_land_ha!=null&&ha>rules.max_land_ha)){reasons.push('Landholding falls outside the verified limits.');return result('NOT_ELIGIBLE')}reasons.push('Landholding falls within the verified limits.')}
  }
  if (rules.grower_registration_required && profile.farmer.coffee_board_grower_id_available !== true) missing.push('Confirm the required Coffee Board registration; do not enter its identifier.')
  if (rules.equipment?.length && (rules.equipment_requirement!=='existing' || !rules.equipment.some(item => profile.infrastructure.equipment.includes(item)))) missing.push('Confirm the proposed equipment/component and its official ownership or purchase conditions.')
  missing.push(...(rules.further_checks ?? []))
  return result(missing.length ? 'POSSIBLY_ELIGIBLE' : 'LIKELY_ELIGIBLE')
}

export function alertKindFor(update: OfficialUpdate): AlertKind {
  if (update.category === 'prices') return update.crops.includes('PEPPER') ? 'pepper_prices' : update.crops.includes('ARECANUT') ? 'arecanut_prices' : 'coffee_prices'
  if (update.category === 'schemes') return update.application_deadline ? 'subsidy_deadlines' : 'government_schemes'
  if (update.category === 'insurance') return update.application_deadline ? 'insurance_enrollment' : 'insurance_updates'
  if (update.category === 'weather') return /heavy.?rain/i.test(`${update.title} ${update.summary}`) ? 'heavy_rainfall' : /drought|low rainfall/i.test(update.title) ? 'drought' : 'weather_warning'
  if (update.category === 'pest') return update.details.risk_type === 'disease' ? 'disease_risk' : 'pest_risk'
  if (update.category === 'training') return 'training_events'
  if (update.category === 'relief') return 'disaster_relief'
  if (update.source_id.startsWith('coffee-board')) return 'coffee_board_updates'
  if (update.source_id.startsWith('spices-board')) return 'spices_board_updates'
  return 'local_news'
}
export function wantsAlert(update: OfficialUpdate, profile: FarmProfile) {
  const preference = profile.preferences.find(item=>item.kind===alertKindFor(update))
  if(update.category==='weather'&&!estateCrops(profile).length&&update.district)return !!preference?.enabled&&preference.crops.length>0
  return !!preference?.enabled && (!update.crops.length || update.crops.some(crop=>preference.crops.includes(crop) && estateCrops(profile).includes(crop)))
}

// Thresholds must come from a reviewed official advisory. Weather by itself
// cannot create a disease alert or an invented management recommendation.
export function cropRisk(profile: FarmProfile, input: {
  advisory: OfficialUpdate; advisory_reviewed: boolean; source_page: number | null; crop: Crop;
  forecast: OfficialUpdate; conditions_verified: boolean; conditions_match: boolean; risk_name: string
}) {
  const advisoryMatch=matchUpdate(input.advisory,profile),forecastMatch=matchUpdate(input.forecast,profile)
  if (!input.advisory_reviewed || input.source_page === null || input.source_page < 1 || !input.conditions_verified || !input.conditions_match
    || input.advisory.source_authority_level !== 1 || input.advisory.source_type !== 'official' || input.advisory.verification_status !== 'OFFICIAL_CONFIRMED' || !['pest','weather'].includes(input.advisory.category)
    || input.forecast.source_authority_level !== 1 || input.forecast.source_type !== 'official' || input.forecast.verification_status !== 'OFFICIAL_CONFIRMED'
    || input.forecast.category !== 'weather' || updateStale(input.forecast) || !estateCrops(profile).includes(input.crop)
    || !advisoryMatch.relevant || !forecastMatch.relevant || advisoryMatch.missing.length>0 || forecastMatch.missing.length>0
    || !input.advisory.effective_from || !input.advisory.effective_until || !input.forecast.effective_from || !input.forecast.effective_until
    || input.advisory.effective_from.slice(0,10)>input.forecast.effective_from.slice(0,10) || input.advisory.effective_until.slice(0,10)<input.forecast.effective_until.slice(0,10)
    || !validSourceUrl(input.advisory.source_url)) return null
  return { title:`Conditions may favour ${input.risk_name}.`,source_url:input.advisory.source_url,source_page:input.source_page,diagnosis:false }
}

// V1 has no verified current term-sheet formula family. This gate never treats
// user policy fields or a nearby/model station as authoritative claims evidence.
export function insuranceAvailability(policy: InsuranceProfileInput, evidence?: {
  crop: Crop; policy_year: string; season: string; insurance_unit_verified: boolean; coverage_verified: boolean;
  insurer_verified: boolean; terms_verified: boolean; sum_insured_verified: boolean; premium_verified: boolean;
  trigger_verified: boolean; reference_station_id: string | null; mapping_verified: boolean;
  observation_station_id: string | null; observations_verified: boolean; formula_verified: boolean
}) {
  const missing: string[] = []
  if (!policy.policy_year) missing.push('policy year')
  if (!policy.season) missing.push('season')
  if (!evidence || evidence.crop !== policy.crop || evidence.policy_year !== policy.policy_year || evidence.season !== policy.season) missing.push('matching crop/year/season evidence')
  if (!evidence?.insurance_unit_verified) missing.push('notified insurance unit')
  if (!evidence?.coverage_verified) missing.push('official crop coverage')
  if (!evidence?.insurer_verified) missing.push('notified insurer')
  if (!evidence?.terms_verified) missing.push('official term sheet')
  if (!evidence?.sum_insured_verified) missing.push('verified sum insured')
  if (!evidence?.premium_verified) missing.push('premium or rate')
  if (!evidence?.trigger_verified) missing.push('weather trigger and period')
  if (!evidence?.mapping_verified || !evidence.reference_station_id) missing.push('reference weather station mapping')
  if (!evidence?.observations_verified || !evidence.reference_station_id || evidence.observation_station_id !== evidence.reference_station_id) missing.push('official observations from the notified station')
  if (!evidence?.formula_verified) missing.push('official payout formula')
  missing.push('validated formula implementation and official worked example')
  return { available: false as const, estimated_claim: null, missing, message: `Insurance calculation unavailable because ${missing.join(', ')} has not been verified.` }
}

export async function updateDedupeKey(source: string, urlValue: string, title: string, occurrence: string | null) {
  const url = new URL(urlValue); url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  const material = [source,url.href,title.toLowerCase().replace(/\s+/g,' ').trim(),occurrence ?? ''].join('\n')
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)))].map(n => n.toString(16).padStart(2,'0')).join('')
}
