import type { EstateInput } from './farmIntelligence'
import { parcelDetails } from './farmParcelDetails'
import type { RtcRecord } from './farmRtcClient'

import { supabase } from './supabase'
import { SURVEY_VILLAGES, surveyQuery, hissaQuery, parseSurveyParcels, type SurveyVillage, type SurveyParcel, type Position, type Polygon, type FarmSurveyMapLayer } from '../../supabase/functions/_shared/farmSurveyMap'
export { SURVEY_VILLAGES, SURVEY_LAYER, HISSA_LAYER, surveyQuery, parseSurveyParcels } from '../../supabase/functions/_shared/farmSurveyMap'
export type { SurveyVillage, SurveyParcel, Position, Polygon } from '../../supabase/functions/_shared/farmSurveyMap'

export interface SurveySelection { village: SurveyVillage; parcel: SurveyParcel; latitude: number; longitude: number; sourceUrl: string; retrievedAt: string; level: 'whole_survey' | 'hissa'; rtcRecord?: RtcRecord | null }
export interface SurveyLocationSource { provider: 'KGIS'; village_code: string; survey_number: string; hissa: string | null; level: 'whole_survey' | 'hissa'; coordinate_method: 'point_inside_polygon'; source_url: string; retrieved_at: string }

type CacheReader = (village: SurveyVillage, layer: FarmSurveyMapLayer, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>
const readCache: CacheReader = async (village, layer, signal) => supabase.from('farm_survey_maps')
  .select('village_code,layer,geojson,source_url,retrieved_at')
  .eq('village_code', village.bhoomi).eq('layer', layer).abortSignal(signal).single()

// Only public reference geometry is retained in memory. No estate, owner or
// document data is cached here. Still authenticate every new database request.
const maps = new Map<string, { parcels: SurveyParcel[]; sourceUrl: string; retrievedAt: string; expires: number }>()
export function clearSurveyMapCache() { maps.clear() }
export async function loadSurveyParcels(village: SurveyVillage, signal: AbortSignal, survey?: string, reader: CacheReader = readCache) {
  surveyQuery(village, survey) // Validate whitelist and the optional survey number.
  const result = await loadVillageMap(village, signal, survey === undefined ? 'whole_survey' : 'hissa', reader)
  return { parcels: survey === undefined ? result.parcels : result.parcels.filter(parcel => parcel.survey === String(Number(survey))), sourceUrl: result.sourceUrl, retrievedAt: result.retrievedAt }
}

// Our Estate displays both villages without issuing a publisher request for
// each survey. Use the same validated, authenticated, public-geometry cache.
export async function loadVillageHissaParcels(village: SurveyVillage, signal: AbortSignal, reader: CacheReader = readCache) {
  hissaQuery(village)
  const result = await loadVillageMap(village, signal, 'hissa', reader)
  return { parcels: result.parcels, sourceUrl: result.sourceUrl, retrievedAt: result.retrievedAt }
}

async function loadVillageMap(village: SurveyVillage, signal: AbortSignal, layer: FarmSurveyMapLayer, reader: CacheReader) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const key = `${village.bhoomi}:${layer}`
  let result = reader === readCache ? maps.get(key) : undefined
  if (!result || result.expires <= Date.now()) {
    const { data, error } = await reader(village, layer, signal)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error || !data) throw new Error('The saved survey map could not be loaded. Please retry.')
    const row = data as { village_code?: string; layer?: string; geojson?: unknown; source_url?: string; retrieved_at?: string }
    const sourceUrl = layer === 'whole_survey' ? surveyQuery(village) : hissaQuery(village)
    if (row.village_code !== village.bhoomi || row.layer !== layer || row.source_url !== sourceUrl || typeof row.retrieved_at !== 'string' || !Number.isFinite(Date.parse(row.retrieved_at)) || Date.parse(row.retrieved_at) > Date.now() + 300000) throw new Error('The saved map source could not be verified.')
    const parcels = parseSurveyParcels(row.geojson, village, layer === 'hissa')
    if (layer === 'whole_survey' && !parcels.length) throw new Error('No verified survey outlines are available for this village.')
    result = { parcels, sourceUrl, retrievedAt: row.retrieved_at, expires: Date.now() + 300000 }
    if (reader === readCache) maps.set(key, result)
  }
  return result
}

export function pointInRing(point: Position, ring: Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const insidePolygon = (point: Position, polygon: Polygon) => pointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(point, ring))
export function parcelPoint(parcel: SurveyParcel): Position {
  // Scan each polygon across its middle and vertex intervals; choose an interior
  // interval, rather than a bounding-box center that may be outside the property.
  let chosen: Position | null = null, width = 0
  for (const polygon of parcel.polygons) {
    const levels = [...new Set(polygon.flat().map(point => point[1]))].sort((a, b) => a - b)
    const candidates = [(levels[0] + levels.at(-1)!) / 2]
    const step = Math.max(1, Math.ceil((levels.length - 1) / 32))
    for (let i = 1; i < levels.length; i += step) candidates.push((levels[i] + levels[i - 1]) / 2)
    for (const y of candidates) {
      const crosses: number[] = []
      for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i]
        if ((a[1] > y) !== (b[1] > y)) crosses.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
      }
      crosses.sort((a, b) => a - b)
      for (let i = 0; i + 1 < crosses.length; i += 2) {
        const point: Position = [(crosses[i] + crosses[i + 1]) / 2, y], span = crosses[i + 1] - crosses[i]
        if (span > width && insidePolygon(point, polygon)) { chosen = point; width = span }
      }
    }
  }
  if (!chosen) throw new Error('A reliable point inside this parcel could not be calculated. Enter your coordinates manually.')
  return chosen
}

export function selectionPatch(selection: SurveySelection): Partial<EstateInput> {
  const { village, parcel } = selection
  const record = selection.rtcRecord
  const matches = selection.level === 'hissa' && record?.identity.villageCode === village.bhoomi && record.identity.surveyNumber === parcel.survey && record.identity.surnoc === parcel.surnoc && record.identity.hissaNumber === parcel.hissa
  const rtc_reference = matches ? { provider: 'Bhoomi' as const, land_code: record.landCode, ulpin: record.ulpin, recorded_extent: { acres: record.extent.acres, guntas: record.extent.guntas, fractional_guntas: record.extent.fractionalGuntas }, source_url: record.sourceUrl, retrieved_at: record.retrievedAt } : undefined
  return { state: 'Karnataka', district: 'Hassan', taluk: 'Sakleshpur', hobli: 'Kasaba', village: village.name, latitude: selection.latitude, longitude: selection.longitude, survey_numbers: [parcel.hissa ? `${parcel.survey}/${parcel.hissa}` : parcel.survey], elevation_m: null, location_source: { provider: 'KGIS', village_code: village.bhoomi, survey_number: parcel.survey, hissa: parcel.hissa, surnoc: parcel.surnoc, level: selection.level, coordinate_method: 'point_inside_polygon', source_url: selection.sourceUrl, retrieved_at: selection.retrievedAt, parcel_details: { ...parcelDetails(parcel), lgd_village_code: village.lgd, record_match: selection.level === 'hissa' ? 'matching_hissa' : 'not_checked' }, ...(rtc_reference ? { rtc_reference } : {}) } }
}
