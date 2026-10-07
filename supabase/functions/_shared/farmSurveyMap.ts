// Public KGIS geometry only. These datasets contain no owner records, RTC
// documents or estate profiles. Fixed queries are shared with the frontend.
export const SURVEY_VILLAGES = [
  { id: 'hebbasale', name: 'Hebbasale', lgd: 614874, bhoomi: '2301110012' },
  { id: 'devihalli', name: 'Devihalli', lgd: 614895, bhoomi: '2301110038' },
] as const
export type SurveyVillage = typeof SURVEY_VILLAGES[number]
export const SURVEY_LAYER = 'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5'
export const HISSA_LAYER = 'https://kgis.ksrsac.in/kgismaps2/rest/services/HissaData/Hissadata_Edgematched/MapServer/1'
export type Position = [number, number]
export type Polygon = Position[][]
export interface SurveyParcel { key: string; survey: string; hissa: string | null; surnoc: string | null; polygons: Polygon[] }
export type FarmSurveyMapLayer = 'whole_survey' | 'hissa'

const MAX_BYTES = 5000000
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 30000

function checkedVillage(village: SurveyVillage) {
  if (!SURVEY_VILLAGES.some(item => item.id === village.id && item.lgd === village.lgd && item.bhoomi === village.bhoomi)) throw new Error('Choose a supported village.')
}
function query(village: SurveyVillage, subdivision: boolean, survey?: string) {
  checkedVillage(village)
  if (survey !== undefined && (!/^\d{1,6}$/.test(survey) || Number(survey) <= 0)) throw new Error('Invalid survey number.')
  const params = new URLSearchParams({
    f: 'geojson', where: `LGD_VillageCode=${village.lgd}${survey ? ` AND surveynumberi=${Number(survey)}` : ''}`,
    outFields: 'OBJECTID,KGISVillageCode,LGD_VillageCode,surveynumberi,Surnoc,HissaNo,Label,HissaCategory',
    outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID ASC',
  })
  return `${subdivision ? HISSA_LAYER : SURVEY_LAYER}/query?${params}`
}
export function surveyQuery(village: SurveyVillage, survey?: string) { return query(village, survey !== undefined, survey) }
export function hissaQuery(village: SurveyVillage) { return query(village, true) }

export function parseSurveyParcels(value: unknown, village: SurveyVillage, subdivision = false): SurveyParcel[] {
  checkedVillage(village)
  const data = value as { type?: string; features?: unknown[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean }; error?: unknown }
  if (!data || data.error || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.exceededTransferLimit || data.properties?.exceededTransferLimit || data.features.length >= 1000) throw new Error('The map response is unavailable or incomplete. Try the official map or enter your location manually.')
  const groups = new Map<string, SurveyParcel>()
  let vertices = 0
  for (const item of data.features) {
    const feature = item as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }
    const props = feature?.properties, geometry = feature?.geometry
    if (!props || Number(props.LGD_VillageCode) !== village.lgd || props.KGISVillageCode !== village.bhoomi) throw new Error('The map response belongs to another village.')
    const survey = Number(props.surveynumberi)
    if (!Number.isInteger(survey) || survey <= 0 || survey > 999999) continue
    const hissa = typeof props.HissaNo === 'string' && props.HissaNo.trim() ? props.HissaNo.trim() : null
    const surnoc = typeof props.Surnoc === 'string' && props.Surnoc.trim() ? props.Surnoc.trim() : null
    if (subdivision && (String(props.HissaCategory ?? '').trim() !== 'Valid-Matching to Bhoomi Records' || !hissa || !/^\d{1,6}$/.test(hissa) || Number(hissa) <= 0)) continue
    if (hissa && (hissa.length > 100 || /[<>]/.test(hissa))) throw new Error('Invalid subdivision label.')
    if (surnoc && (surnoc.length > 50 || /[<>]/.test(surnoc))) throw new Error('Invalid Surnoc label.')
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null
    if (!Array.isArray(polygons) || !polygons.length) throw new Error('Invalid parcel geometry.')
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length || polygon.length > 500) throw new Error('Invalid parcel geometry.')
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid parcel outline.')
        for (const point of ring) {
          // Longitude first in EPSG:4326. An optional z ordinate is not elevation.
          if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 74 || point[0] > 78 || point[1] < 11 || point[1] > 16 || ++vertices > 180000) throw new Error('Parcel coordinates cannot be verified.')
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Parcel outline is not closed.')
      }
    }
    const key = `${survey}:${surnoc ?? ''}:${hissa ?? ''}`
    const previous = groups.get(key)
    const normalized = (polygons as number[][][][]).map(polygon => polygon.map(ring => ring.map(point => [point[0], point[1]] as Position)))
    if (previous) previous.polygons.push(...normalized)
    else groups.set(key, { key, survey: String(survey), hissa, surnoc, polygons: normalized })
  }
  return [...groups.values()].sort((a, b) => Number(a.survey) - Number(b.survey) || (a.hissa ?? '').localeCompare(b.hissa ?? '', 'en', { numeric: true }))
}

export interface SurveyMapGeoJson {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: { KGISVillageCode: string; LGD_VillageCode: number; surveynumberi: number; Surnoc: string | null; HissaNo: string | null; HissaCategory?: string }
    geometry: { type: 'MultiPolygon'; coordinates: Polygon[] }
  }[]
}
export interface SurveyMapCacheRow { village_code: string; layer: FarmSurveyMapLayer; geojson: SurveyMapGeoJson; source_url: string; retrieved_at: string }
export interface SurveyMapCacheStore {
  get(villageCode: string, layer: FarmSurveyMapLayer): Promise<{ retrieved_at: string } | null>
  save(row: SurveyMapCacheRow): Promise<void>
}

export function normalizeSurveyGeoJson(parcels: SurveyParcel[], village: SurveyVillage, layer: FarmSurveyMapLayer): SurveyMapGeoJson {
  return { type: 'FeatureCollection', features: parcels.map(parcel => ({
    type: 'Feature',
    properties: {
      KGISVillageCode: village.bhoomi, LGD_VillageCode: village.lgd, surveynumberi: Number(parcel.survey),
      Surnoc: parcel.surnoc, HissaNo: parcel.hissa,
      ...(layer === 'hissa' ? { HissaCategory: 'Valid-Matching to Bhoomi Records' } : {}),
    },
    geometry: { type: 'MultiPolygon', coordinates: parcel.polygons },
  })) }
}

export async function fetchSurveyMap(village: SurveyVillage, layer: FarmSurveyMapLayer, fetcher: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<SurveyMapCacheRow> {
  if (layer !== 'whole_survey' && layer !== 'hissa') throw new Error('Invalid map layer.')
  const sourceUrl = layer === 'hissa' ? hissaQuery(village) : surveyQuery(village)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetcher(sourceUrl, { signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/geo+json, application/json' } })
    if (!response.ok) throw new Error('The official map is unavailable.')
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel()
      throw new Error('The map response is too large.')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('The map response is empty.')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) throw new Error('The map response is too large.')
        chunks.push(value)
      }
    } catch (error) { await reader.cancel(); throw error }
    if (controller.signal.aborted) throw new Error('The official map request timed out.')
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const parcels = parseSurveyParcels(JSON.parse(new TextDecoder().decode(bytes)), village, layer === 'hissa')
    if (!parcels.length) throw new Error('No validated survey geometry was returned; previous map retained.')
    return { village_code: village.bhoomi, layer, geojson: normalizeSurveyGeoJson(parcels, village, layer), source_url: sourceUrl, retrieved_at: now().toISOString() }
  } finally { clearTimeout(timer) }
}

export async function refreshSurveyMaps(store: SurveyMapCacheStore, options: { fetcher?: typeof fetch; now?: () => Date } = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? (() => new Date())
  const result = { refreshed: 0, skipped: 0, failed: 0 }
  // Four fixed independent public datasets, reusing successful data for 24h.
  // Parallel retrieval avoids multiplying Edge wall time on publisher failure.
  const jobs = SURVEY_VILLAGES.flatMap(village => (['whole_survey', 'hissa'] as const).map(layer => ({ village, layer })))
  const outcomes = await Promise.allSettled(jobs.map(async ({ village, layer }) => {
    const previous = await store.get(village.bhoomi, layer)
    const age = previous ? now().getTime() - Date.parse(previous.retrieved_at) : NaN
    if (Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS) return 'skipped' as const
    const row = await fetchSurveyMap(village, layer, fetcher, now)
    // Write only after complete validation. No failed refresh clears or dates
    // an older valid map, and one publisher failure does not stop other maps.
    await store.save(row)
    return 'refreshed' as const
  }))
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') result[outcome.value]++
    else result.failed++
  }
  return result
}
