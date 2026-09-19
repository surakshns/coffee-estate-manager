import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { downloadCsv } from '../lib/csv'
import {
  COFFEE_PRESETS,
  DEFAULT_PRESET,
  aggregateByDay,
  aggregateByMonth,
  aggregateByWeek,
  aggregateByYear,
  convertRainfall,
  fetchRainfallData,
  formatRainfall,
  searchLocations,
  type DailyRainRecord,
  type LocationPreset,
  type RainfallUnit
} from '../lib/rainfall'

type Granularity = 'year' | 'month' | 'week' | 'day'

interface ChartPoint {
  name: string
  value: number
  compareValue?: number
  rawMm: number
  prevRawMm?: number
  rainyDays?: number
  prevRainyDays?: number
  label?: string
  intensity?: string
}

const STORAGE_KEY = 'coffee_estate_rainfall_location'

function getSavedLocation(): LocationPreset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as LocationPreset
  } catch {
    // ignore
  }
  return DEFAULT_PRESET
}

export function Rainfall({ defaultYear }: { defaultYear?: number }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(defaultYear ?? currentYear)
  const [month, setMonth] = useState(new Date().getMonth() + 1) // 1-12
  const [view, setView] = useState<Granularity>('month')
  const [unit, setUnit] = useState<RainfallUnit>('mm')

  // Previous year comparison controls
  const [compareWithPrev, setCompareWithPrev] = useState(true)
  const [compareYear, setCompareYear] = useState<number>(year - 1)
  const [expandedYear, setExpandedYear] = useState<number | null>(null)

  // Location state
  const [location, setLocation] = useState<LocationPreset>(getSavedLocation)
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LocationPreset[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [customLat, setCustomLat] = useState('')
  const [customLon, setCustomLon] = useState('')
  const [locationNotice, setLocationNotice] = useState('')

  // Data fetching state
  const [data, setData] = useState<DailyRainRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const searchTimer = useRef<number | null>(null)

  // Keep compareYear synchronized when year changes
  useEffect(() => {
    setCompareYear(year - 1)
  }, [year])

  // Save location to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(location))
    } catch {
      // ignore
    }
  }, [location])

  // Load meteorological rainfall for past 10+ years up to current year
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const startYear = Math.min(year - 9, currentYear - 10)
    const endYear = currentYear

    fetchRainfallData(location.latitude, location.longitude, startYear, endYear)
      .then((records) => {
        if (!cancelled) {
          setData(records)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load rainfall data.')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [location, year, currentYear])

  // Location search handler with debounce
  function handleSearchChange(text: string) {
    setSearchQuery(text)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    if (!text.trim() || text.trim().length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    searchTimer.current = window.setTimeout(async () => {
      const results = await searchLocations(text)
      setSearchResults(results)
      setIsSearching(false)
    }, 350)
  }

  // Detect GPS Location
  function detectGPSLocation() {
    if (!navigator.geolocation) {
      setLocationNotice('Geolocation is not supported by your browser.')
      return
    }
    setIsLocating(true)
    setLocationNotice('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords
        const newLoc: LocationPreset = {
          id: `gps-${Date.now()}`,
          name: 'My Estate (GPS)',
          region: `${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E`,
          latitude,
          longitude,
          elevation: altitude ? Math.round(altitude) : undefined
        }
        setLocation(newLoc)
        setIsLocating(false)
        setShowLocationPicker(false)
      },
      (err) => {
        setIsLocating(false)
        setLocationNotice(`Could not get GPS location: ${err.message}`)
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  function applyCustomCoordinates() {
    const lat = Number(customLat)
    const lon = Number(customLon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setLocationNotice('Please enter valid coordinates (-90 to 90 lat, -180 to 180 lon).')
      return
    }
    const newLoc: LocationPreset = {
      id: `custom-${lat}-${lon}`,
      name: `Custom (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`,
      region: 'Custom coordinates',
      latitude: lat,
      longitude: lon
    }
    setLocation(newLoc)
    setShowLocationPicker(false)
  }

  // Aggregated data for each view
  const yearsList = useMemo(() => {
    const years = new Set(data.map((r) => Number(r.date.slice(0, 4))))
    if (!years.has(year)) years.add(year)
    return [...years].sort((a, b) => b - a)
  }, [data, year])

  const compareYearsList = useMemo(() => {
    return yearsList.filter((y) => y !== year)
  }, [yearsList, year])

  const activeCompareYear = compareWithPrev ? compareYear : undefined

  const yearData = useMemo(() => aggregateByYear(data), [data])
  const monthData = useMemo(() => aggregateByMonth(data, year, activeCompareYear), [data, year, activeCompareYear])
  const weekData = useMemo(() => aggregateByWeek(data, year, month, activeCompareYear), [data, year, month, activeCompareYear])
  const dayData = useMemo(() => aggregateByDay(data, year, month, activeCompareYear), [data, year, month, activeCompareYear])

  // Summary indicators based on current view
  const summary = useMemo(() => {
    if (view === 'year') {
      const selectedYearItem = yearData.find((y) => y.year === year)
      const totalMm = selectedYearItem?.totalMm ?? 0
      const rainyDays = selectedYearItem?.rainyDays ?? 0
      const wettestMonth = selectedYearItem?.wettestMonth
      const blossomRain = selectedYearItem?.blossomRainMm ?? 0
      const monsoonRain = selectedYearItem?.monsoonRainMm ?? 0

      const prevYearTotal = selectedYearItem?.prevYearTotalMm
      const yoyDiff = selectedYearItem?.yoyDifferenceMm
      const yoyPct = selectedYearItem?.yoyDifferencePercent

      return {
        totalLabel: `${year} Annual Rainfall`,
        totalMm,
        prevTotalMm: prevYearTotal,
        diffLabel: prevYearTotal != null
          ? `${yoyDiff != null && yoyDiff >= 0 ? '+' : ''}${formatRainfall(yoyDiff ?? 0, unit)}${yoyPct != null ? ` (${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}%)` : ''} vs ${year - 1}`
          : undefined,
        rainyDays,
        highlightTitle: 'Blossom & Monsoon',
        highlightText: `🌸 Blossom: ${formatRainfall(blossomRain, unit)} · 🌧️ Monsoon: ${formatRainfall(monsoonRain, unit)}`,
        extraLabel: 'Wettest Month',
        extraValue: wettestMonth ? `${new Date(year, wettestMonth.month - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} (${formatRainfall(wettestMonth.totalMm, unit)})` : '—'
      }
    }

    if (view === 'month') {
      const selectedMonthItem = monthData.find((m) => m.month === month)
      const totalMm = selectedMonthItem?.totalMm ?? 0
      const rainyDays = selectedMonthItem?.rainyDays ?? 0
      const maxDaily = selectedMonthItem?.maxDailyMm ?? 0
      const prevTotalMm = selectedMonthItem?.prevYearTotalMm
      const diffMm = selectedMonthItem?.differenceMm
      const diffPct = selectedMonthItem?.differencePercent

      let agronomicNote = ''
      if (month === 3 || month === 4) {
        agronomicNote = totalMm >= 25
          ? 'Adequate blossom shower (>25 mm) for robust flowering.'
          : totalMm > 0
            ? 'Light shower; monitor flower bud expansion and backing water.'
            : 'Dry blossom period; watch for backing moisture.'
      } else if (month === 5) {
        agronomicNote = totalMm >= 30 ? 'Good backing showers for healthy fruit set.' : 'Scanty backing showers.'
      } else if (month >= 6 && month <= 8) {
        agronomicNote = 'Active South-West monsoon. Ensure drainage cradle pits and collar trenches are clear.'
      } else if (month >= 11 || month <= 2) {
        agronomicNote = 'Dry harvest & drying yard window. Suitable for picking and sun drying.'
      } else {
        agronomicNote = 'Post-monsoon ripening stage.'
      }

      return {
        totalLabel: `${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })} ${year}`,
        totalMm,
        prevTotalMm,
        diffLabel: compareWithPrev && prevTotalMm != null
          ? `${diffMm != null && diffMm >= 0 ? '+' : ''}${formatRainfall(diffMm ?? 0, unit)}${diffPct != null ? ` (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%)` : ''} vs ${compareYear}`
          : undefined,
        rainyDays,
        highlightTitle: selectedMonthItem?.seasonLabel ?? 'Monthly Season',
        highlightText: agronomicNote,
        extraLabel: 'Peak Day Rain',
        extraValue: maxDaily > 0 ? formatRainfall(maxDaily, unit) : '0 mm'
      }
    }

    if (view === 'week') {
      const totalMm = weekData.reduce((sum, w) => sum + w.totalMm, 0)
      const prevTotalMm = weekData.reduce((sum, w) => sum + (w.prevYearTotalMm ?? 0), 0)
      const diffMm = totalMm - prevTotalMm
      const rainyDays = weekData.reduce((sum, w) => sum + w.rainyDays, 0)
      const wettestWeek = [...weekData].sort((a, b) => b.totalMm - a.totalMm)[0]

      return {
        totalLabel: `${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} Weekly Rainfall`,
        totalMm,
        prevTotalMm: compareWithPrev ? prevTotalMm : undefined,
        diffLabel: compareWithPrev ? `${diffMm >= 0 ? '+' : ''}${formatRainfall(diffMm, unit)} vs ${compareYear}` : undefined,
        rainyDays,
        highlightTitle: 'Weekly Pattern',
        highlightText: `${weekData.length} weeks recorded in this period.`,
        extraLabel: 'Wettest Week',
        extraValue: wettestWeek && wettestWeek.totalMm > 0 ? `${wettestWeek.label} (${formatRainfall(wettestWeek.totalMm, unit)})` : '—'
      }
    }

    // Day view
    const totalMm = dayData.reduce((sum, d) => sum + d.precipitationMm, 0)
    const prevTotalMm = dayData.reduce((sum, d) => sum + (d.prevYearPrecipitationMm ?? 0), 0)
    const diffMm = totalMm - prevTotalMm
    const rainyDays = dayData.filter((d) => d.precipitationMm >= 1).length
    const dryDays = dayData.length - rainyDays
    const wettestDay = [...dayData].sort((a, b) => b.precipitationMm - a.precipitationMm)[0]

    return {
      totalLabel: `Daily Rainfall · ${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })} ${year}`,
      totalMm,
      prevTotalMm: compareWithPrev ? prevTotalMm : undefined,
      diffLabel: compareWithPrev ? `${diffMm >= 0 ? '+' : ''}${formatRainfall(diffMm, unit)} vs ${compareYear}` : undefined,
      rainyDays,
      highlightTitle: 'Dry vs Wet Days',
      highlightText: `${dryDays} dry days (${Math.round((dryDays / (dayData.length || 1)) * 100)}% of month) — key for spray schedule and yard drying.`,
      extraLabel: 'Wettest Day',
      extraValue: wettestDay && wettestDay.precipitationMm > 0 ? `${wettestDay.dayOfMonth} ${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} (${formatRainfall(wettestDay.precipitationMm, unit)})` : '—'
    }
  }, [view, year, month, unit, compareWithPrev, compareYear, yearData, monthData, weekData, dayData])

  // Chart data preparation
  const chartData: ChartPoint[] = useMemo(() => {
    if (view === 'year') {
      return [...yearData].reverse().map((y) => ({
        name: String(y.year),
        value: convertRainfall(y.totalMm, unit),
        compareValue: compareWithPrev && y.prevYearTotalMm != null ? convertRainfall(y.prevYearTotalMm, unit) : undefined,
        rawMm: y.totalMm,
        prevRawMm: y.prevYearTotalMm,
        rainyDays: y.rainyDays
      }))
    }
    if (view === 'month') {
      return monthData.map((m) => ({
        name: m.shortName,
        value: convertRainfall(m.totalMm, unit),
        compareValue: compareWithPrev && m.prevYearTotalMm != null ? convertRainfall(m.prevYearTotalMm, unit) : undefined,
        rawMm: m.totalMm,
        prevRawMm: m.prevYearTotalMm,
        rainyDays: m.rainyDays,
        prevRainyDays: m.prevRainyDays
      }))
    }
    if (view === 'week') {
      return weekData.map((w) => ({
        name: `W${w.weekNumber}`,
        label: w.label,
        value: convertRainfall(w.totalMm, unit),
        compareValue: compareWithPrev && w.prevYearTotalMm != null ? convertRainfall(w.prevYearTotalMm, unit) : undefined,
        rawMm: w.totalMm,
        prevRawMm: w.prevYearTotalMm,
        rainyDays: w.rainyDays
      }))
    }
    return dayData.map((d) => ({
      name: `${d.dayOfMonth} (${d.dayOfWeek})`,
      value: convertRainfall(d.precipitationMm, unit),
      compareValue: compareWithPrev && d.prevYearPrecipitationMm != null ? convertRainfall(d.prevYearPrecipitationMm, unit) : undefined,
      rawMm: d.precipitationMm,
      prevRawMm: d.prevYearPrecipitationMm,
      intensity: d.intensity
    }))
  }, [view, unit, yearData, monthData, weekData, dayData, compareWithPrev])

  function exportRainfallCsv() {
    if (view === 'year') {
      const rows = yearData.map((y) => ({
        Year: y.year,
        'Total Rainfall (mm)': y.totalMm,
        'Total Rainfall (inches)': convertRainfall(y.totalMm, 'inches'),
        'Total Rainfall (cents)': convertRainfall(y.totalMm, 'cents'),
        'Previous Year Total (mm)': y.prevYearTotalMm ?? '',
        'YoY Difference (mm)': y.yoyDifferenceMm ?? '',
        'YoY Change (%)': y.yoyDifferencePercent != null ? `${y.yoyDifferencePercent}%` : '',
        'Rainy Days (>=1mm)': y.rainyDays,
        'Blossom Rain Mar-Apr (mm)': y.blossomRainMm,
        'Monsoon Rain Jun-Aug (mm)': y.monsoonRainMm
      }))
      downloadCsv(`rainfall-${location.name.toLowerCase().replace(/\s+/g, '-')}-annual.csv`, rows)
    } else if (view === 'month') {
      const rows = monthData.map((m) => ({
        Year: year,
        Month: m.monthName,
        Season: m.seasonLabel,
        [`${year} Rainfall (mm)`]: m.totalMm,
        [`${year} Rainfall (inches)`]: convertRainfall(m.totalMm, 'inches'),
        [`${year} Rainfall (cents)`]: convertRainfall(m.totalMm, 'cents'),
        [`${compareYear} Rainfall (mm)`]: m.prevYearTotalMm ?? '',
        'Difference (mm)': m.differenceMm ?? '',
        'Change (%)': m.differencePercent != null ? `${m.differencePercent}%` : '',
        [`${year} Rainy Days`]: m.rainyDays,
        [`${compareYear} Rainy Days`]: m.prevRainyDays ?? '',
        'Max Daily Rain (mm)': m.maxDailyMm
      }))
      downloadCsv(`rainfall-${location.name.toLowerCase().replace(/\s+/g, '-')}-${year}-vs-${compareYear}-monthly.csv`, rows)
    } else if (view === 'week') {
      const rows = weekData.map((w) => ({
        Year: year,
        Month: new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' }),
        Week: w.label,
        [`${year} Rainfall (mm)`]: w.totalMm,
        [`${compareYear} Rainfall (mm)`]: w.prevYearTotalMm ?? '',
        'Difference (mm)': w.differenceMm ?? '',
        'Rainy Days': w.rainyDays
      }))
      downloadCsv(`rainfall-${location.name.toLowerCase().replace(/\s+/g, '-')}-${year}-${month}-weekly.csv`, rows)
    } else {
      const rows = dayData.map((d) => ({
        Date: d.date,
        Day: d.dayOfWeek,
        [`${year} Rainfall (mm)`]: d.precipitationMm,
        [`${compareYear} Rainfall (mm)`]: d.prevYearPrecipitationMm ?? '',
        'Difference (mm)': d.differenceMm ?? '',
        Intensity: d.intensity
      }))
      downloadCsv(`rainfall-${location.name.toLowerCase().replace(/\s+/g, '-')}-${year}-${month}-daily.csv`, rows)
    }
  }

  return (
    <div className="page space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Weather &amp; Rain Gauge</p>
          <h1 className="mt-1 text-3xl font-extrabold text-stone-900">Rainfall tracker</h1>
          <p className="mt-1 text-sm text-stone-600">
            Compare this season with previous years: blossom showers, monsoon downpours, and dry spells.
          </p>
        </div>

        {/* Location badge & change button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-2 rounded-2xl border border-leaf-600/30 bg-leaf-50/70 px-3.5 py-2 text-left shadow-sm transition hover:bg-leaf-100"
            onClick={() => setShowLocationPicker(true)}
            aria-label="Change estate location"
          >
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-leaf-700 text-white shadow-xs">
              📍
            </span>
            <div>
              <p className="text-xs font-bold tracking-wide text-leaf-800 uppercase">Selected Location</p>
              <p className="text-sm font-extrabold text-stone-900">
                {location.name}
                {location.elevation ? <span className="ml-1 text-xs font-normal text-stone-500">({location.elevation}m)</span> : ''}
              </p>
            </div>
            <span className="ml-1 text-xs font-bold text-leaf-700 underline">Change</span>
          </button>
        </div>
      </header>

      {/* Location Picker Modal / Card */}
      {showLocationPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="location-dialog-title"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLocationPicker(false) }}
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h2 id="location-dialog-title" className="text-xl font-extrabold text-stone-900">
                  Choose Estate Location
                </h2>
                <p className="text-xs text-stone-600">Pick a coffee hub, search any village or use GPS.</p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                onClick={() => setShowLocationPicker(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {/* GPS Button */}
            <div className="flex items-center justify-between rounded-xl bg-leaf-50 p-3">
              <div>
                <p className="text-sm font-bold text-leaf-900">Auto-detect from device GPS</p>
                <p className="text-xs text-leaf-700">Find the exact coordinates of your current plantation block.</p>
              </div>
              <button
                type="button"
                className="button-primary min-h-10 text-xs shrink-0"
                disabled={isLocating}
                onClick={detectGPSLocation}
              >
                {isLocating ? 'Detecting…' : '📍 Use My Location'}
              </button>
            </div>

            {/* Search Input */}
            <div>
              <label className="label" htmlFor="location-search-input">
                Search place name
              </label>
              <input
                id="location-search-input"
                className="field"
                type="search"
                placeholder="e.g. Sakleshpur, Mudigere, Aldur, Hanbal, Madikeri…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                autoFocus
              />
              {isSearching && <p className="mt-1 text-xs text-stone-500">Searching places…</p>}

              {searchResults.length > 0 && (
                <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-stone-50 max-h-48 overflow-y-auto">
                  {searchResults.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 text-left text-sm hover:bg-leaf-100 flex items-center justify-between"
                        onClick={() => {
                          setLocation(result)
                          setShowLocationPicker(false)
                          setSearchQuery('')
                          setSearchResults([])
                        }}
                      >
                        <div>
                          <strong className="font-bold text-stone-900">{result.name}</strong>
                          <p className="text-xs text-stone-500">{result.region}</p>
                        </div>
                        <span className="text-xs font-semibold text-leaf-700">
                          {result.elevation ? `${result.elevation}m alt` : 'Select'} →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Coffee Presets */}
            <div>
              <p className="label">Major Coffee Plantation Hubs</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {COFFEE_PRESETS.map((preset) => {
                  const isSelected = location.id === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                        isSelected
                          ? 'bg-leaf-700 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                      onClick={() => {
                        setLocation(preset)
                        setShowLocationPicker(false)
                      }}
                    >
                      {preset.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom Coordinates Collapsible */}
            <details className="rounded-xl border border-stone-200 p-3 text-xs">
              <summary className="font-bold text-stone-700 cursor-pointer">
                Enter custom coordinates (Latitude &amp; Longitude)
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="label">
                  Latitude
                  <input
                    className="field mt-1"
                    placeholder="12.9439"
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value)}
                  />
                </label>
                <label className="label">
                  Longitude
                  <input
                    className="field mt-1"
                    placeholder="75.7876"
                    value={customLon}
                    onChange={(e) => setCustomLon(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="button-secondary mt-2 w-full text-xs"
                onClick={applyCustomCoordinates}
              >
                Apply Coordinates
              </button>
            </details>

            {locationNotice && (
              <p className="rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800" role="alert">
                {locationNotice}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main View & Unit Toolbar */}
      <section className="card flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Granularity Switch */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Time scale">
            {(['year', 'month', 'week', 'day'] as const).map((level) => {
              const isActive = view === level
              const labels: Record<Granularity, string> = {
                year: 'Yearly',
                month: 'Monthly',
                week: 'Weekly',
                day: 'Daily'
              }
              return (
                <button
                  key={level}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`min-h-10 rounded-xl px-3.5 text-xs font-extrabold transition sm:text-sm ${
                    isActive
                      ? 'bg-leaf-700 text-white shadow-sm'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                  onClick={() => setView(level)}
                >
                  {labels[level]}
                </button>
              )
            })}
          </div>

          {/* Filters & Unit Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Year select */}
            {view !== 'year' && (
              <label className="flex items-center gap-1.5 text-xs font-bold text-stone-600">
                <span>Year:</span>
                <select
                  aria-label="Filter by year"
                  className="field min-h-10 py-1 text-xs sm:text-sm"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {yearsList.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Month select (for week and day views) */}
            {(view === 'week' || view === 'day') && (
              <label className="flex items-center gap-1.5 text-xs font-bold text-stone-600">
                <span>Month:</span>
                <select
                  aria-label="Filter by month"
                  className="field min-h-10 py-1 text-xs sm:text-sm"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const mNum = i + 1
                    const mName = new Date(year, i, 1).toLocaleDateString('en-IN', { month: 'long' })
                    return (
                      <option key={mNum} value={mNum}>
                        {mName}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}

            {/* Unit Toggle: mm | inches | cents */}
            <div className="flex rounded-xl border border-stone-200 bg-stone-100 p-0.5 text-xs font-bold">
              {(['mm', 'inches', 'cents'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={`rounded-lg px-2.5 py-1.5 transition ${
                    unit === u ? 'bg-white text-leaf-800 shadow-xs' : 'text-stone-500 hover:text-stone-800'
                  }`}
                  onClick={() => setUnit(u)}
                  title={u === 'cents' ? '100 cents = 1 inch' : undefined}
                >
                  {u === 'cents' ? 'Cents' : u === 'inches' ? 'Inches (″)' : 'mm'}
                </button>
              ))}
            </div>

            {/* CSV Export Button */}
            <button
              type="button"
              className="button-secondary min-h-10 text-xs shrink-0"
              onClick={exportRainfallCsv}
              title="Download displayed rainfall data as CSV"
            >
              ↓ CSV
            </button>
          </div>
        </div>

        {/* Previous Year Comparison Toolbar Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-2.5 text-xs">
          <label className="flex items-center gap-2 font-bold text-stone-700 cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded accent-leaf-700 cursor-pointer"
              checked={compareWithPrev}
              onChange={(e) => setCompareWithPrev(e.target.checked)}
            />
            <span>Compare with previous year breakdown</span>
          </label>

          {compareWithPrev && compareYearsList.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-stone-500 font-semibold">Compare {year} against:</span>
              <select
                aria-label="Select comparison year"
                className="field py-1 text-xs font-bold"
                value={compareYear}
                onChange={(e) => setCompareYear(Number(e.target.value))}
              >
                {compareYearsList.map((y) => (
                  <option key={y} value={y}>
                    {y} {y === year - 1 ? '(Previous Year)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Error / Loading notices */}
      {error && (
        <div className="app-banner" role="alert">
          <strong>Weather data could not be loaded.</strong>
          <p>{error}</p>
        </div>
      )}

      {loading && (
        <div className="loading-state" role="status">
          <span className="loading-leaf" aria-hidden="true">🌧️</span>
          <p>Fetching precipitation records for {location.name}…</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary Metric Tiles */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="summary-tile tone-volume">
              <p className="tile-label">{summary.totalLabel}</p>
              <p className="mt-2 text-2xl font-extrabold sm:text-3xl">
                {formatRainfall(summary.totalMm, unit)}
              </p>
              {summary.diffLabel && (
                <p className="mt-1 text-xs font-bold text-leaf-800">
                  {summary.diffLabel}
                </p>
              )}
              {summary.prevTotalMm != null && (
                <p className="mt-0.5 text-[11px] opacity-75">
                  {compareYear} was {formatRainfall(summary.prevTotalMm, unit)}
                </p>
              )}
            </div>

            <div className="summary-tile tone-production">
              <p className="tile-label">Rainy Days (≥ 1mm)</p>
              <p className="mt-2 text-2xl font-extrabold sm:text-3xl">
                {summary.rainyDays} <span className="text-sm font-semibold opacity-75">days</span>
              </p>
              <p className="mt-1 text-xs opacity-75">Recorded with measurable rain</p>
            </div>

            <div className="summary-tile tone-expense">
              <p className="tile-label">{summary.extraLabel}</p>
              <p className="mt-2 text-xl font-extrabold sm:text-2xl">{summary.extraValue}</p>
              <p className="mt-1 text-xs opacity-75">Peak recorded precipitation</p>
            </div>

            <div className="summary-tile tone-market-arabica">
              <p className="tile-label">{summary.highlightTitle}</p>
              <p className="mt-2 text-xs font-bold leading-5 sm:text-sm">{summary.highlightText}</p>
            </div>
          </section>

          {/* Interactive Chart Panel */}
          <section className="card space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="tile-label text-leaf-700">Precipitation Pattern</p>
                <h2 className="text-xl font-extrabold text-stone-900">
                  {view === 'year'
                    ? compareWithPrev ? 'Annual Rainfall & Previous Year Comparison' : 'Annual Rainfall Comparison'
                    : view === 'month'
                    ? compareWithPrev ? `Monthly Comparison: ${year} vs ${compareYear}` : `Monthly Breakdown (${year})`
                    : view === 'week'
                    ? compareWithPrev ? `Weekly Rainfall: ${year} vs ${compareYear}` : `Weekly Rainfall (${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })} ${year})`
                    : compareWithPrev ? `Daily Rain: ${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })} ${year} vs ${compareYear}` : `Daily Rain Gauge (${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })} ${year})`}
                </h2>
              </div>
              <p className="text-xs font-bold text-stone-500">
                Values shown in {unit === 'cents' ? 'Cents (1″ = 100 cents)' : unit === 'inches' ? 'Inches' : 'Millimetres (mm)'}
              </p>
            </div>

            {/* Recharts Bar Chart */}
            <div className="h-64 sm:h-80 w-full min-w-0 pt-2" role="group" aria-label="Rainfall distribution chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={chartData} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#e8ede7" strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#68766d', fontSize: 11 }}
                    minTickGap={15}
                  />
                  <YAxis
                    width={52}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#68766d', fontSize: 10 }}
                    tickFormatter={(val) => `${val}${unit === 'inches' ? '″' : ''}`}
                  />
                  <Tooltip
                    formatter={(val, name) => [
                      `${val} ${unit === 'cents' ? 'cents' : unit === 'inches' ? '″' : 'mm'}`,
                      String(name)
                    ]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: '#dce5da',
                      fontSize: 12,
                      boxShadow: '0 6px 20px rgba(35, 54, 45, 0.08)'
                    }}
                  />
                  {compareWithPrev && <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />}
                  <Bar
                    dataKey="value"
                    name={view === 'year' ? 'Annual Rainfall' : `${year}`}
                    fill="#174e3c"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  {compareWithPrev && (
                    <Bar
                      dataKey="compareValue"
                      name={view === 'year' ? 'Previous Year' : `${compareYear}`}
                      fill="#4a7c9d"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Quick Chart Notes */}
            <p className="text-xs text-stone-500">
              * Meteorological data for {location.name} ({location.latitude.toFixed(3)}°N, {location.longitude.toFixed(3)}°E).
            </p>
          </section>

          {/* Detailed Data Table Panel with Previous Year Break-ups */}
          <section className="card space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-extrabold text-stone-900">
                {view === 'year'
                  ? 'Historical Yearly Totals & Previous Year Break-ups'
                  : view === 'month'
                  ? `Monthly Rain Ledger & YoY Variance (${year} vs ${compareYear})`
                  : view === 'week'
                  ? `Weekly Rain Ledger & Variance (${year} vs ${compareYear})`
                  : `Daily Rain Ledger & Variance (${new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' })}: ${year} vs ${compareYear})`}
              </h2>
              {view === 'year' && (
                <span className="text-xs text-stone-500 font-semibold">
                  Tap "Monthly break-up" to expand all 12 months for any year
                </span>
              )}
            </div>

            <div className="table-wrap">
              <table className="data-table record-table">
                <thead>
                  {view === 'year' && (
                    <tr>
                      <th>Year</th>
                      <th>Total Rain ({unit})</th>
                      <th>vs Previous Year</th>
                      <th>Rainy Days</th>
                      <th>Wettest Month</th>
                      <th>Blossom (Mar–Apr)</th>
                      <th>Monsoon (Jun–Aug)</th>
                      <th>Break-up</th>
                    </tr>
                  )}
                  {view === 'month' && (
                    <tr>
                      <th>Month</th>
                      <th>Season Focus</th>
                      <th>{year} Rain ({unit})</th>
                      {compareWithPrev && <th>{compareYear} Rain ({unit})</th>}
                      {compareWithPrev && <th>Difference ({unit})</th>}
                      <th>Rainy Days ({year}{compareWithPrev ? ` vs ${compareYear}` : ''})</th>
                      <th>Wettest Day ({year})</th>
                    </tr>
                  )}
                  {view === 'week' && (
                    <tr>
                      <th>Week</th>
                      <th>Date Range</th>
                      <th>{year} Rain ({unit})</th>
                      {compareWithPrev && <th>{compareYear} Rain ({unit})</th>}
                      {compareWithPrev && <th>Difference ({unit})</th>}
                      <th>Rainy Days</th>
                    </tr>
                  )}
                  {view === 'day' && (
                    <tr>
                      <th>Day</th>
                      <th>{year} Date</th>
                      <th>{year} Rain ({unit})</th>
                      <th>{year} Intensity</th>
                      {compareWithPrev && <th>{compareYear} Rain ({unit})</th>}
                      {compareWithPrev && <th>Difference ({unit})</th>}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {view === 'year' &&
                    yearData.map((y) => {
                      const isExpanded = expandedYear === y.year
                      return (
                        <FragmentRow key={y.year}>
                          <tr>
                            <td data-label="Year" className="font-bold">
                              <span className="inline-flex items-center gap-1.5">
                                {y.year}
                                {y.year === currentYear && (
                                  <span className="rounded-sm bg-leaf-100 px-1.5 py-0.2 text-[10px] font-bold text-leaf-800">
                                    Current
                                  </span>
                                )}
                              </span>
                            </td>
                            <td data-label={`Total (${unit})`} className="font-extrabold text-leaf-800">
                              {formatRainfall(y.totalMm, unit)}
                            </td>
                            <td data-label="vs Previous Year">
                              {y.yoyDifferenceMm != null ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                    y.yoyDifferenceMm >= 0
                                      ? 'bg-emerald-50 text-emerald-800'
                                      : 'bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {y.yoyDifferenceMm >= 0 ? '▲ +' : '▼ '}
                                  {formatRainfall(Math.abs(y.yoyDifferenceMm), unit)}
                                  {y.yoyDifferencePercent != null && ` (${y.yoyDifferencePercent >= 0 ? '+' : ''}${y.yoyDifferencePercent}%)`}
                                </span>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>
                            <td data-label="Rainy Days">{y.rainyDays} days</td>
                            <td data-label="Wettest Month">
                              {new Date(y.year, y.wettestMonth.month - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} ({formatRainfall(y.wettestMonth.totalMm, unit)})
                            </td>
                            <td data-label="Blossom">{formatRainfall(y.blossomRainMm, unit)}</td>
                            <td data-label="Monsoon">{formatRainfall(y.monsoonRainMm, unit)}</td>
                            <td data-label="Break-up">
                              <button
                                type="button"
                                className="button-secondary py-1 px-2.5 text-xs font-bold"
                                onClick={() => setExpandedYear(isExpanded ? null : y.year)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? 'Hide break-up ▲' : 'Monthly break-up ▼'}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded 12-Month Break-up Row */}
                          {isExpanded && (
                            <tr className="bg-stone-50/80">
                              <td colSpan={8} className="p-4">
                                <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-extrabold text-stone-800 uppercase tracking-wider">
                                      {y.year} Monthly Break-up (Jan to Dec)
                                    </h4>
                                    <button
                                      type="button"
                                      className="text-xs font-bold text-leaf-700 underline"
                                      onClick={() => {
                                        setYear(y.year)
                                        setView('month')
                                      }}
                                    >
                                      Open in Monthly View →
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
                                    {y.monthlyBreakdown.map((mb) => (
                                      <div
                                        key={mb.month}
                                        className="rounded-lg border border-stone-100 bg-stone-50/50 p-2 text-xs"
                                      >
                                        <p className="font-bold text-stone-700">{mb.monthName}</p>
                                        <p className="text-sm font-extrabold text-leaf-800 mt-0.5">
                                          {formatRainfall(mb.totalMm, unit)}
                                        </p>
                                        <p className="text-[11px] text-stone-500">{mb.rainyDays} rainy days</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </FragmentRow>
                      )
                    })}

                  {view === 'month' &&
                    monthData.map((m) => {
                      const diffMm = m.differenceMm
                      const diffPct = m.differencePercent
                      return (
                        <tr
                          key={m.month}
                          className={m.month === month ? 'bg-leaf-50/60 font-semibold' : undefined}
                        >
                          <td data-label="Month" className="font-bold">
                            <button
                              type="button"
                              className="underline text-leaf-800 hover:text-leaf-950 text-left"
                              onClick={() => {
                                setMonth(m.month)
                                setView('day')
                              }}
                              title="Click to view daily details for this month"
                            >
                              {m.monthName} ↗
                            </button>
                          </td>
                          <td data-label="Season">{m.seasonLabel}</td>
                          <td data-label={`${year} Rain`} className="font-extrabold text-leaf-800">
                            {formatRainfall(m.totalMm, unit)}
                          </td>
                          {compareWithPrev && (
                            <td data-label={`${compareYear} Rain`}>
                              {m.prevYearTotalMm != null ? formatRainfall(m.prevYearTotalMm, unit) : '—'}
                            </td>
                          )}
                          {compareWithPrev && (
                            <td data-label="Difference">
                              {diffMm != null ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                    diffMm >= 0
                                      ? 'bg-emerald-50 text-emerald-800'
                                      : 'bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {diffMm >= 0 ? '+' : ''}
                                  {formatRainfall(diffMm, unit)}
                                  {diffPct != null && ` (${diffPct >= 0 ? '+' : ''}${diffPct}%)`}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          )}
                          <td data-label="Rainy Days">
                            {m.rainyDays} days
                            {compareWithPrev && m.prevRainyDays != null && (
                              <span className="text-stone-500 font-normal ml-1">
                                (vs {m.prevRainyDays} in {compareYear})
                              </span>
                            )}
                          </td>
                          <td data-label="Wettest Day">
                            {m.maxDailyMm > 0 ? `${formatRainfall(m.maxDailyMm, unit)} (${m.maxDailyDate.slice(8)})` : '0 mm'}
                          </td>
                        </tr>
                      )
                    })}

                  {view === 'week' &&
                    weekData.map((w) => {
                      const diffMm = w.differenceMm
                      return (
                        <tr key={w.weekNumber}>
                          <td data-label="Week" className="font-bold">Week {w.weekNumber}</td>
                          <td data-label="Date Range">{w.label}</td>
                          <td data-label={`${year} Rain`} className="font-extrabold text-leaf-800">
                            {formatRainfall(w.totalMm, unit)}
                          </td>
                          {compareWithPrev && (
                            <td data-label={`${compareYear} Rain`}>
                              {w.prevYearTotalMm != null ? formatRainfall(w.prevYearTotalMm, unit) : '—'}
                            </td>
                          )}
                          {compareWithPrev && (
                            <td data-label="Difference">
                              {diffMm != null ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                    diffMm >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {diffMm >= 0 ? '+' : ''}
                                  {formatRainfall(diffMm, unit)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          )}
                          <td data-label="Rainy Days">{w.rainyDays} days</td>
                        </tr>
                      )
                    })}

                  {view === 'day' &&
                    dayData.map((d) => {
                      const diffMm = d.differenceMm
                      const hasRain = d.precipitationMm >= 1 || (d.prevYearPrecipitationMm ?? 0) >= 1
                      return (
                        <tr key={d.date} className={hasRain ? undefined : 'opacity-60'}>
                          <td data-label="Day" className="font-bold">
                            {d.dayOfMonth} <span className="text-xs text-stone-500 font-normal">({d.dayOfWeek})</span>
                          </td>
                          <td data-label={`${year} Date`} className="font-mono text-xs">{d.date}</td>
                          <td data-label={`${year} Rain`} className="font-extrabold text-leaf-800">
                            {formatRainfall(d.precipitationMm, unit)}
                          </td>
                          <td data-label={`${year} Intensity`}>
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                d.intensity === 'none'
                                  ? 'bg-stone-100 text-stone-500'
                                  : d.intensity === 'light'
                                  ? 'bg-blue-50 text-blue-700'
                                  : d.intensity === 'moderate'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : d.intensity === 'heavy'
                                  ? 'bg-amber-100 text-amber-900 font-extrabold'
                                  : 'bg-red-100 text-red-900 font-extrabold'
                              }`}
                            >
                              {d.intensity === 'none'
                                ? 'Dry'
                                : d.intensity === 'light'
                                ? 'Light'
                                : d.intensity === 'moderate'
                                ? 'Moderate'
                                : d.intensity === 'heavy'
                                ? 'Heavy'
                                : 'Torrential'}
                            </span>
                          </td>
                          {compareWithPrev && (
                            <td data-label={`${compareYear} Rain`}>
                              {d.prevYearPrecipitationMm != null
                                ? formatRainfall(d.prevYearPrecipitationMm, unit)
                                : '—'}
                            </td>
                          )}
                          {compareWithPrev && (
                            <td data-label="Difference">
                              {diffMm != null && (d.precipitationMm > 0 || (d.prevYearPrecipitationMm ?? 0) > 0) ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                    diffMm >= 0 ? 'text-emerald-800' : 'text-amber-800'
                                  }`}
                                >
                                  {diffMm >= 0 ? '+' : ''}
                                  {formatRainfall(diffMm, unit)}
                                </span>
                              ) : (
                                <span className="text-stone-400">0</span>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
