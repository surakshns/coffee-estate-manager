import type { SurveyParcel, SurveySelection } from './farmSurveyMap'

const EARTH_RADIUS_M = 6371008.8
export const SQUARE_METRES_PER_ACRE = 4046.8564224

export function parcelDetails(parcel: SurveyParcel) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const polygon of parcel.polygons) for (const ring of polygon) for (const [lon, lat] of ring) {
    west = Math.min(west, lon); east = Math.max(east, lon)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  if (![west, south, east, north].every(Number.isFinite)) throw new Error('Parcel geometry is missing.')
  const radians = Math.PI / 180, cosine = Math.cos((south + north) / 2 * radians)
  function ringArea(ring: [number, number][]) {
    // Local metric projection is suitable for these small village parcels.
    // Subtract the origin to avoid cancellation with large projected values.
    let sum = 0
    for (let i = 1; i < ring.length; i++) {
      const [aLon, aLat] = ring[i - 1], [bLon, bLat] = ring[i]
      const ax = (aLon - west) * radians * EARTH_RADIUS_M * cosine, ay = (aLat - south) * radians * EARTH_RADIUS_M
      const bx = (bLon - west) * radians * EARTH_RADIUS_M * cosine, by = (bLat - south) * radians * EARTH_RADIUS_M
      sum += ax * by - bx * ay
    }
    return Math.abs(sum) / 2
  }
  const mappedArea = parcel.polygons.reduce((sum, polygon) => sum + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0)
  if (!Number.isFinite(mappedArea) || mappedArea <= 0) throw new Error('Parcel area could not be calculated.')
  return { mapped_area_m2: Math.round(mappedArea * 100) / 100, area_method: 'local_projection' as const, bounds: [west, south, east, north] as [number, number, number, number], geometry_parts: parcel.polygons.length }
}

export function parcelLookupText(selection: Pick<SurveySelection, 'village' | 'parcel'>) {
  const { village, parcel } = selection
  return `Karnataka · Hassan · Sakleshpur · Kasaba\nVillage: ${village.name}\nSurvey: ${parcel.survey}\nSurnoc: ${parcel.surnoc ?? 'Not supplied'}\nHissa: ${parcel.hissa ?? 'Select the correct Hissa in Bhoomi'}\nVillage code: ${village.bhoomi}\nLGD village code: ${village.lgd}`
}
