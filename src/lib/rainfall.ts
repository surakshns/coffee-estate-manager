export type RainfallUnit = 'mm' | 'inches' | 'cents'

export interface LocationPreset {
  id: string
  name: string
  region: string
  latitude: number
  longitude: number
  elevation?: number
}

export interface DailyRainRecord {
  date: string // YYYY-MM-DD
  precipitationMm: number
}

export interface YearRainfall {
  year: number
  totalMm: number
  rainyDays: number // days with >= 1mm
  wettestMonth: { month: number; totalMm: number }
  blossomRainMm: number // March + April total
  monsoonRainMm: number // June + July + August total
  monthlyBreakdown: Array<{ month: number; monthName: string; shortName: string; totalMm: number; rainyDays: number }>
  prevYearTotalMm?: number
  yoyDifferenceMm?: number
  yoyDifferencePercent?: number
}

export interface MonthRainfall {
  month: number // 1 to 12
  monthName: string
  shortName: string
  totalMm: number
  rainyDays: number
  maxDailyMm: number
  maxDailyDate: string
  season: 'blossom' | 'backing' | 'monsoon' | 'post-monsoon' | 'dry'
  seasonLabel: string
  // Comparative fields vs previous / comparison year
  prevYear?: number
  prevYearTotalMm?: number
  differenceMm?: number
  differencePercent?: number
  prevRainyDays?: number
}

export interface WeekRainfall {
  weekNumber: number
  label: string
  startDate: string
  endDate: string
  totalMm: number
  rainyDays: number
  maxDailyMm: number
  prevYearTotalMm?: number
  differenceMm?: number
}

export interface DayRainfall {
  date: string
  dayOfWeek: string
  dayOfMonth: number
  precipitationMm: number
  intensity: 'none' | 'light' | 'moderate' | 'heavy' | 'torrential'
  prevYearDate?: string
  prevYearDayOfWeek?: string
  prevYearPrecipitationMm?: number
  differenceMm?: number
}

// 1 inch = 25.4 mm = 100 cents (standard South Indian coffee estate gauge unit)
export function convertRainfall(mm: number, unit: RainfallUnit): number {
  if (unit === 'inches') return Math.round((mm / 25.4) * 100) / 100
  if (unit === 'cents') return Math.round((mm / 0.254) * 10) / 10
  return Math.round(mm * 10) / 10
}

export function formatRainfall(mm: number, unit: RainfallUnit): string {
  const value = convertRainfall(mm, unit)
  if (unit === 'inches') return `${value.toFixed(2)}″`
  if (unit === 'cents') return `${value.toFixed(1)} cents`
  return `${value.toFixed(1)} mm`
}

export function unitLabel(unit: RainfallUnit): string {
  switch (unit) {
    case 'inches': return 'Inches (″)'
    case 'cents': return 'Cents (1″ = 100 cents)'
    default: return 'Millimetres (mm)'
  }
}

export const COFFEE_PRESETS: LocationPreset[] = [
  { id: 'sakleshpur', name: 'Sakleshpur', region: 'Hassan, Karnataka', latitude: 12.9439, longitude: 75.7876, elevation: 949 },
  { id: 'chikmagalur', name: 'Chikmagalur', region: 'Chikmagalur, Karnataka', latitude: 13.3153, longitude: 75.7754, elevation: 1090 },
  { id: 'mudigere', name: 'Mudigere', region: 'Chikmagalur, Karnataka', latitude: 13.1364, longitude: 75.6421, elevation: 970 },
  { id: 'madikeri', name: 'Madikeri (Coorg)', region: 'Kodagu, Karnataka', latitude: 12.4244, longitude: 75.7382, elevation: 1150 },
  { id: 'somwarpet', name: 'Somwarpet', region: 'Kodagu, Karnataka', latitude: 12.5996, longitude: 75.8569, elevation: 1027 },
  { id: 'virajpet', name: 'Virajpet', region: 'Kodagu, Karnataka', latitude: 12.1969, longitude: 75.8037, elevation: 920 },
  { id: 'kalasa', name: 'Kalasa', region: 'Chikmagalur, Karnataka', latitude: 13.2325, longitude: 75.3683, elevation: 810 },
  { id: 'balehonnur', name: 'Balehonnur (CCRI)', region: 'Chikmagalur, Karnataka', latitude: 13.3551, longitude: 75.4674, elevation: 670 },
  { id: 'wayanad', name: 'Kalpetta (Wayanad)', region: 'Wayanad, Kerala', latitude: 11.6080, longitude: 76.0827, elevation: 780 },
  { id: 'yercaud', name: 'Yercaud', region: 'Shevaroys, Tamil Nadu', latitude: 11.7753, longitude: 78.2093, elevation: 1515 },
  { id: 'araku', name: 'Araku Valley', region: 'Visakhapatnam, Andhra Pradesh', latitude: 18.3273, longitude: 82.8775, elevation: 911 },
]

export const DEFAULT_PRESET = COFFEE_PRESETS[0] // Sakleshpur

const cache = new Map<string, DailyRainRecord[]>()

export async function searchLocations(query: string): Promise<LocationPreset[]> {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 2) return []
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=6&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json() as { results?: Array<{ id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number; elevation?: number }> }
    if (!Array.isArray(json.results)) return []
    return json.results.map((r) => ({
      id: `geo-${r.id}`,
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
      elevation: r.elevation
    }))
  } catch {
    return []
  }
}

/**
 * Fetch daily rainfall data for given coordinates and years.
 * Uses Open-Meteo Archive API for historical data + Forecast API for current days.
 */
export async function fetchRainfallData(
  latitude: number,
  longitude: number,
  startYear: number,
  endYear: number
): Promise<DailyRainRecord[]> {
  const latRounded = Math.round(latitude * 100) / 100
  const lonRounded = Math.round(longitude * 100) / 100
  const cacheKey = `${latRounded},${lonRounded}:${startYear}-${endYear}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!
  }

  const today = new Date().toISOString().slice(0, 10)
  const startDate = `${startYear}-01-01`
  const endDate = `${endYear}-12-31` > today ? today : `${endYear}-12-31`

  const records: DailyRainRecord[] = []

  try {
    // 1. Fetch archive data
    // Open-Meteo archive is typically available up to 2-4 days ago.
    const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${latRounded}&longitude=${lonRounded}&start_date=${startDate}&end_date=${endDate}&daily=precipitation_sum&timezone=auto`
    const archiveRes = await fetch(archiveUrl)
    if (archiveRes.ok) {
      const data = await archiveRes.json() as { daily?: { time?: string[]; precipitation_sum?: (number | null)[] } }
      if (data.daily?.time && data.daily.precipitation_sum) {
        for (let i = 0; i < data.daily.time.length; i++) {
          const date = data.daily.time[i]
          const val = data.daily.precipitation_sum[i]
          records.push({ date, precipitationMm: Number.isFinite(val) && val != null ? Math.max(0, val) : 0 })
        }
      }
    }

    // 2. If endYear is current year and archive didn't reach today, top up with forecast past_days
    const lastDate = records.length ? records[records.length - 1].date : ''
    if (endYear >= new Date().getFullYear() && (!lastDate || lastDate < today)) {
      try {
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latRounded}&longitude=${lonRounded}&daily=precipitation_sum&past_days=14&forecast_days=1&timezone=auto`
        const forecastRes = await fetch(forecastUrl)
        if (forecastRes.ok) {
          const fData = await forecastRes.json() as { daily?: { time?: string[]; precipitation_sum?: (number | null)[] } }
          if (fData.daily?.time && fData.daily.precipitation_sum) {
            const existingDates = new Set(records.map((r) => r.date))
            for (let i = 0; i < fData.daily.time.length; i++) {
              const date = fData.daily.time[i]
              if (date <= today && !existingDates.has(date)) {
                const val = fData.daily.precipitation_sum[i]
                records.push({ date, precipitationMm: Number.isFinite(val) && val != null ? Math.max(0, val) : 0 })
              }
            }
          }
        }
      } catch {
        // Forecast top-up is optional; continue with archive
      }
    }
  } catch (err) {
    console.error('Failed to fetch rainfall data:', err)
    throw new Error('Could not fetch meteorological rainfall data for this location. Please check your connection and try again.')
  }

  records.sort((a, b) => a.date.localeCompare(b.date))
  cache.set(cacheKey, records)
  return records
}

// ---------------- Aggregations ---------------- //

export function getCoffeeSeason(month: number): MonthRainfall['season'] {
  if (month === 3 || month === 4) return 'blossom' // Mar-Apr: Blossom
  if (month === 5) return 'backing' // May: Backing showers
  if (month >= 6 && month <= 8) return 'monsoon' // Jun-Aug: SW Monsoon
  if (month >= 9 && month <= 11) return 'post-monsoon' // Sep-Nov: Post-monsoon
  return 'dry' // Dec-Feb: Harvest / Dry
}

export function getSeasonLabel(season: MonthRainfall['season']): string {
  switch (season) {
    case 'blossom': return '🌸 Blossom showers'
    case 'backing': return '🌿 Backing showers'
    case 'monsoon': return '🌧️ South-West monsoon'
    case 'post-monsoon': return '🍂 Post-monsoon ripening'
    case 'dry': return '☀️ Dry harvest season'
  }
}

export function getIntensity(mm: number): DayRainfall['intensity'] {
  if (mm < 0.1) return 'none'
  if (mm <= 7.5) return 'light'
  if (mm <= 35.5) return 'moderate'
  if (mm <= 64.5) return 'heavy'
  return 'torrential'
}

export function aggregateByYear(daily: DailyRainRecord[]): YearRainfall[] {
  const byYear = new Map<number, DailyRainRecord[]>()
  for (const record of daily) {
    const y = Number(record.date.slice(0, 4))
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(record)
  }

  const yearlyMap = new Map<number, {
    year: number
    totalMm: number
    rainyDays: number
    wettestMonth: { month: number; totalMm: number }
    blossomRainMm: number
    monsoonRainMm: number
    monthlyBreakdown: Array<{ month: number; monthName: string; shortName: string; totalMm: number; rainyDays: number }>
  }>()

  for (const [year, records] of byYear.entries()) {
    let totalMm = 0
    let rainyDays = 0
    let blossomRainMm = 0
    let monsoonRainMm = 0
    const monthlyTotals = new Array<number>(12).fill(0)
    const monthlyRainyDays = new Array<number>(12).fill(0)

    for (const r of records) {
      totalMm += r.precipitationMm
      const isRainy = r.precipitationMm >= 1
      if (isRainy) rainyDays++
      const m = Number(r.date.slice(5, 7)) - 1
      monthlyTotals[m] += r.precipitationMm
      if (isRainy) monthlyRainyDays[m]++
      if (m === 2 || m === 3) blossomRainMm += r.precipitationMm // Mar (2) & Apr (3)
      if (m >= 5 && m <= 7) monsoonRainMm += r.precipitationMm // Jun (5) to Aug (7)
    }

    let maxMonthIdx = 0
    for (let i = 1; i < 12; i++) {
      if (monthlyTotals[i] > monthlyTotals[maxMonthIdx]) maxMonthIdx = i
    }

    const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
      const dObj = new Date(year, i, 1)
      return {
        month: i + 1,
        monthName: dObj.toLocaleDateString('en-IN', { month: 'long' }),
        shortName: dObj.toLocaleDateString('en-IN', { month: 'short' }),
        totalMm: Math.round(monthlyTotals[i] * 10) / 10,
        rainyDays: monthlyRainyDays[i]
      }
    })

    yearlyMap.set(year, {
      year,
      totalMm: Math.round(totalMm * 10) / 10,
      rainyDays,
      wettestMonth: { month: maxMonthIdx + 1, totalMm: Math.round(monthlyTotals[maxMonthIdx] * 10) / 10 },
      blossomRainMm: Math.round(blossomRainMm * 10) / 10,
      monsoonRainMm: Math.round(monsoonRainMm * 10) / 10,
      monthlyBreakdown
    })
  }

  const result: YearRainfall[] = []
  for (const item of yearlyMap.values()) {
    const prevYearItem = yearlyMap.get(item.year - 1)
    const prevYearTotalMm = prevYearItem?.totalMm
    const yoyDifferenceMm = prevYearTotalMm != null ? Math.round((item.totalMm - prevYearTotalMm) * 10) / 10 : undefined
    const yoyDifferencePercent = prevYearTotalMm && prevYearTotalMm > 0
      ? Math.round(((item.totalMm - prevYearTotalMm) / prevYearTotalMm) * 1000) / 10
      : undefined

    result.push({
      ...item,
      prevYearTotalMm,
      yoyDifferenceMm,
      yoyDifferencePercent
    })
  }

  return result.sort((a, b) => b.year - a.year)
}

export function aggregateByMonth(
  daily: DailyRainRecord[],
  year: number,
  compareYear?: number
): MonthRainfall[] {
  const yearPrefix = `${year}-`
  const records = daily.filter((r) => r.date.startsWith(yearPrefix))

  const prevYearPrefix = compareYear ? `${compareYear}-` : null
  const prevRecords = prevYearPrefix ? daily.filter((r) => r.date.startsWith(prevYearPrefix)) : []

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const mStr = String(month).padStart(2, '0')
    const prefix = `${year}-${mStr}`
    const mRecords = records.filter((r) => r.date.startsWith(prefix))

    let totalMm = 0
    let rainyDays = 0
    let maxDailyMm = 0
    let maxDailyDate = ''

    for (const r of mRecords) {
      totalMm += r.precipitationMm
      if (r.precipitationMm >= 1) rainyDays++
      if (r.precipitationMm > maxDailyMm) {
        maxDailyMm = r.precipitationMm
        maxDailyDate = r.date
      }
    }

    let prevYearTotalMm: number | undefined
    let prevRainyDays: number | undefined
    let differenceMm: number | undefined
    let differencePercent: number | undefined

    if (compareYear && prevYearPrefix) {
      const pPrefix = `${compareYear}-${mStr}`
      const pRecords = prevRecords.filter((r) => r.date.startsWith(pPrefix))
      let pTotal = 0
      let pRainy = 0
      for (const r of pRecords) {
        pTotal += r.precipitationMm
        if (r.precipitationMm >= 1) pRainy++
      }
      prevYearTotalMm = Math.round(pTotal * 10) / 10
      prevRainyDays = pRainy
      differenceMm = Math.round((totalMm - pTotal) * 10) / 10
      differencePercent = pTotal > 0 ? Math.round(((totalMm - pTotal) / pTotal) * 1000) / 10 : undefined
    }

    const dateObj = new Date(year, index, 1)
    const monthName = dateObj.toLocaleDateString('en-IN', { month: 'long' })
    const shortName = dateObj.toLocaleDateString('en-IN', { month: 'short' })
    const season = getCoffeeSeason(month)

    return {
      month,
      monthName,
      shortName,
      totalMm: Math.round(totalMm * 10) / 10,
      rainyDays,
      maxDailyMm: Math.round(maxDailyMm * 10) / 10,
      maxDailyDate,
      season,
      seasonLabel: getSeasonLabel(season),
      prevYear: compareYear,
      prevYearTotalMm,
      differenceMm,
      differencePercent,
      prevRainyDays
    }
  })
}

export function aggregateByWeek(
  daily: DailyRainRecord[],
  year: number,
  month?: number,
  compareYear?: number
): WeekRainfall[] {
  let records = daily.filter((r) => r.date.startsWith(`${year}-`))
  let prevRecords = compareYear ? daily.filter((r) => r.date.startsWith(`${compareYear}-`)) : []

  if (month != null && month >= 1 && month <= 12) {
    const mPrefix = `${year}-${String(month).padStart(2, '0')}`
    records = records.filter((r) => r.date.startsWith(mPrefix))
    if (compareYear) {
      const pPrefix = `${compareYear}-${String(month).padStart(2, '0')}`
      prevRecords = prevRecords.filter((r) => r.date.startsWith(pPrefix))
    }
  }

  if (!records.length) return []

  const weeks: WeekRainfall[] = []
  // Group into consecutive 7-day buckets
  for (let i = 0; i < records.length; i += 7) {
    const chunk = records.slice(i, i + 7)
    const startDate = chunk[0].date
    const endDate = chunk[chunk.length - 1].date
    const totalMm = chunk.reduce((sum, r) => sum + r.precipitationMm, 0)
    const rainyDays = chunk.filter((r) => r.precipitationMm >= 1).length
    const maxDailyMm = Math.max(0, ...chunk.map((r) => r.precipitationMm))

    const weekNumber = Math.floor(i / 7) + 1
    const sDateObj = new Date(`${startDate}T12:00:00`)
    const eDateObj = new Date(`${endDate}T12:00:00`)
    const label = `${sDateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${eDateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`

    let prevYearTotalMm: number | undefined
    let differenceMm: number | undefined

    if (compareYear && prevRecords.length > i) {
      const prevChunk = prevRecords.slice(i, i + 7)
      const pTotal = prevChunk.reduce((sum, r) => sum + r.precipitationMm, 0)
      prevYearTotalMm = Math.round(pTotal * 10) / 10
      differenceMm = Math.round((totalMm - pTotal) * 10) / 10
    }

    weeks.push({
      weekNumber,
      label,
      startDate,
      endDate,
      totalMm: Math.round(totalMm * 10) / 10,
      rainyDays,
      maxDailyMm: Math.round(maxDailyMm * 10) / 10,
      prevYearTotalMm,
      differenceMm
    })
  }

  return weeks
}

export function aggregateByDay(
  daily: DailyRainRecord[],
  year: number,
  month: number,
  compareYear?: number
): DayRainfall[] {
  const mStr = String(month).padStart(2, '0')
  const prefix = `${year}-${mStr}`
  const curMap = new Map<string, DailyRainRecord>()
  daily.filter((r) => r.date.startsWith(prefix)).forEach((r) => {
    curMap.set(r.date.slice(8, 10), r)
  })

  const prevPrefix = compareYear ? `${compareYear}-${mStr}` : null
  const prevMap = new Map<string, DailyRainRecord>()
  if (prevPrefix) {
    daily.filter((r) => r.date.startsWith(prevPrefix)).forEach((r) => {
      prevMap.set(r.date.slice(8, 10), r)
    })
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const result: DayRainfall[] = []

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0')
    const date = `${year}-${mStr}-${dayStr}`
    const dObj = new Date(`${date}T12:00:00`)
    const curRecord = curMap.get(dayStr)
    const precipitationMm = curRecord ? Math.round(curRecord.precipitationMm * 10) / 10 : 0

    let prevYearDate: string | undefined
    let prevYearDayOfWeek: string | undefined
    let prevYearPrecipitationMm: number | undefined
    let differenceMm: number | undefined

    if (compareYear) {
      prevYearDate = `${compareYear}-${mStr}-${dayStr}`
      const pDObj = new Date(`${prevYearDate}T12:00:00`)
      prevYearDayOfWeek = pDObj.toLocaleDateString('en-IN', { weekday: 'short' })
      const prevRecord = prevMap.get(dayStr)
      prevYearPrecipitationMm = prevRecord ? Math.round(prevRecord.precipitationMm * 10) / 10 : 0
      differenceMm = Math.round((precipitationMm - prevYearPrecipitationMm) * 10) / 10
    }

    result.push({
      date,
      dayOfWeek: dObj.toLocaleDateString('en-IN', { weekday: 'short' }),
      dayOfMonth: day,
      precipitationMm,
      intensity: getIntensity(precipitationMm),
      prevYearDate,
      prevYearDayOfWeek,
      prevYearPrecipitationMm,
      differenceMm
    })
  }

  return result
}
