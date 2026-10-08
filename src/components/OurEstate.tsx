import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Expand, Layers, LocateFixed, MapPin, Maximize2, Menu, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { FarmParcelDetails } from './FarmParcelDetails'
import { EstateMapCanvas, type EstateMapParcel } from './EstateMapCanvas'
import { SURVEY_VILLAGES, SURVEY_LAYER, clearSurveyMapCache, loadSurveyParcels, loadVillageHissaParcels, parcelPoint, type Position } from '../lib/farmSurveyMap'
import type { RtcLookupRequest, RtcRecord } from '../lib/farmRtcClient'
import '../farm-intelligence.css'
import '../our-estate.css'

export type EstateOwnershipMatch = { villageCode: string; surveyNumber: string; surnoc: string | null; hissaNumber: string | null }
type MapSet = { whole: EstateMapParcel[]; hissa: EstateMapParcel[] }
const EMPTY_MATCHES: EstateOwnershipMatch[] = []
const parcelTitle = (item: EstateMapParcel) => `Survey ${item.parcel.survey}${item.parcel.hissa ? ` / ${item.parcel.hissa}` : ''}`
const compareParcels = (a: EstateMapParcel, b: EstateMapParcel) => a.village.name.localeCompare(b.village.name) || Number(a.parcel.survey) - Number(b.parcel.survey) || (a.parcel.hissa ?? '').localeCompare(b.parcel.hissa ?? '', 'en', { numeric: true })

export function OurEstate({ userId, email, ownershipMatches = EMPTY_MATCHES, ownershipLoading = false, ownershipError = '', ownershipStatus = '', ownershipTotalAcres = null, ownershipRecordCount, targetName, holderAliases = [], onExit, onOpenMenu, onRefreshOwnership, onRtcRecord, onChooseHolder }: {
  userId: string
  email?: string | null
  ownershipMatches?: EstateOwnershipMatch[]
  ownershipLoading?: boolean
  ownershipError?: string
  ownershipStatus?: string
  ownershipTotalAcres?: number | null
  ownershipRecordCount?: number
  targetName?: string | null
  holderAliases?: string[]
  onExit?: () => void
  onOpenMenu?: () => void
  onRefreshOwnership?: () => void
  onRtcRecord?: (record: RtcRecord) => void
  onChooseHolder?: (record: RtcRecord, holderName: string) => void | Promise<void>
}) {
  const [maps, setMaps] = useState<MapSet>({ whole: [], hissa: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [villageFilter, setVillageFilter] = useState('both'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null), [focusId, setFocusId] = useState<string | null>(null)
  const [showSubdivisions, setShowSubdivisions] = useState(false), [showHoldings, setShowHoldings] = useState(false), [expandedDetails, setExpandedDetails] = useState(true), [fullscreen, setFullscreen] = useState(false)
  const [latestRecord, setLatestRecord] = useState<{ parcelId: string; record: RtcRecord } | null>(null), [chosenHolder, setChosenHolder] = useState(''), [holderSaving, setHolderSaving] = useState(false), [holderError, setHolderError] = useState('')
  const [initialRtcRecord, setInitialRtcRecord] = useState<{ parcelId: string; identity: RtcLookupRequest } | null>(null)
  const [estateFocusRequest, setEstateFocusRequest] = useState(0)
  const mapRef = useRef<HTMLDivElement | null>(null), fullScreenButton = useRef<HTMLButtonElement | null>(null)
  const recordLoaded = useCallback((record: RtcRecord | null) => {
    if (record && selectedId) { setLatestRecord({ parcelId: selectedId, record }); onRtcRecord?.(record) }
    else setLatestRecord(null)
  }, [onRtcRecord, selectedId])

  useEffect(() => {
    let active = true
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    setMaps({ whole: [], hissa: [] }); setError(''); setLoading(true); setSelectedId(null); setFocusId(null); setLatestRecord(null); setInitialRtcRecord(null); setChosenHolder(''); setHolderError('')
    const requests = SURVEY_VILLAGES.flatMap(village => [
      loadSurveyParcels(village, controller.signal).then(result => ({ level: 'whole_survey' as const, village, result })),
      loadVillageHissaParcels(village, controller.signal).then(result => ({ level: 'hissa' as const, village, result })),
    ])
    void Promise.allSettled(requests).then(results => {
      if (!active) return
      const next: MapSet = { whole: [], hissa: [] }
      let failures = 0
      for (const result of results) {
        if (result.status === 'rejected') { failures++; continue }
        const { level, village, result: data } = result.value
        for (const parcel of data.parcels) next[level === 'hissa' ? 'hissa' : 'whole'].push({ id: `${village.bhoomi}:${level}:${parcel.key}`, village, parcel, level, sourceUrl: data.sourceUrl, retrievedAt: data.retrievedAt })
      }
      next.whole.sort(compareParcels); next.hissa.sort(compareParcels)
      setMaps(next)
      if (failures) setError(next.whole.length ? 'Some saved map layers could not be loaded. Retry to restore the complete village and subdivision view.' : controller.signal.aborted ? 'The saved village maps took too long to load. Check your connection and retry.' : 'The village maps could not be loaded. Check your connection and retry.')
    }).finally(() => { clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [userId, retry])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { void closeFullscreen(); return }
      if (event.key !== 'Tab' || !mapRef.current) return
      const controls = [...mapRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')].filter(element => {
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !mapRef.current.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !mapRef.current.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    function changed() { if (!document.fullscreenElement && mapRef.current?.requestFullscreen) setFullscreen(false) }
    document.addEventListener('keydown', key); document.addEventListener('fullscreenchange', changed)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', changed) }
  }, [fullscreen])

  const all = useMemo(() => [...maps.whole, ...maps.hissa], [maps])
  const visible = useMemo(() => villageFilter === 'both' ? all : all.filter(item => item.village.id === villageFilter), [all, villageFilter])
  const chosen = all.find(item => item.id === selectedId) ?? null
  const visibleRecord = latestRecord?.parcelId === selectedId ? latestRecord.record : null
  const holderChoices = useMemo(() => [...new Set(visibleRecord?.owners.flatMap(owner => owner.name ? [owner.name] : []) ?? [])], [visibleRecord])
  const point = useMemo<Position | null>(() => { if (!chosen) return null; try { return parcelPoint(chosen.parcel) } catch { return null } }, [chosen])
  const related = useMemo(() => chosen ? maps.hissa.filter(item => item.village.id === chosen.village.id && item.parcel.survey === chosen.parcel.survey) : [], [chosen, maps.hissa])
  const wholeSurvey = chosen ? maps.whole.find(item => item.village.id === chosen.village.id && item.parcel.survey === chosen.parcel.survey) : null
  const matchLocations = useMemo(() => ownershipMatches.map(match => {
    const sameSurvey = (item: EstateMapParcel) => item.village.bhoomi === match.villageCode && item.parcel.survey === match.surveyNumber
    const exact = maps.hissa.find(item => sameSurvey(item) && item.parcel.surnoc === match.surnoc && item.parcel.hissa === match.hissaNumber)
    const item = exact ?? maps.whole.find(sameSurvey)
    return item ? { match, item, exact: Boolean(exact) || match.hissaNumber === null } : null
  }).filter((value): value is NonNullable<typeof value> => value !== null), [maps, ownershipMatches])
  const holdingIds = useMemo(() => new Set(matchLocations.map(match => match.item.id)), [matchLocations])
  const approximateHoldingIds = useMemo(() => {
    const exact = new Set(matchLocations.filter(match => match.exact).map(match => match.item.id))
    return new Set(matchLocations.filter(match => !match.exact && !exact.has(match.item.id)).map(match => match.item.id))
  }, [matchLocations])
  const searchResults = useMemo(() => {
    const text = query.trim().toLocaleLowerCase().replaceAll('survey', '').replaceAll('hissa', '').replace(/\s*\/\s*/g, '/').trim()
    if (!text) return []
    const terms = text.split(/\s+/)
    return visible.filter(item => {
      const haystack = `${item.village.name} ${item.parcel.survey}${item.parcel.hissa ? `/${item.parcel.hissa}` : ''} ${item.parcel.surnoc ?? ''}`.toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    }).sort((a, b) => {
      const exact = (item: EstateMapParcel) => `${item.parcel.survey}${item.parcel.hissa ? `/${item.parcel.hissa}` : ''}`.toLocaleLowerCase() === text
      return Number(exact(b)) - Number(exact(a)) || compareParcels(a, b)
    })
  }, [visible, query])
  const villageCounts = useMemo(() => SURVEY_VILLAGES.map(village => ({ village, surveys: maps.whole.filter(item => item.village.id === village.id).length, subdivisions: maps.hissa.filter(item => item.village.id === village.id).length })), [maps])
  const newest = all.map(item => item.retrievedAt).sort().at(-1)
  const recordedAcres = ownershipTotalAcres !== null && Number.isFinite(ownershipTotalAcres) && ownershipTotalAcres >= 0 ? ownershipTotalAcres : null
  const recordedCount = ownershipRecordCount ?? ownershipMatches.length
  const acresText = recordedAcres?.toLocaleString('en-IN', { maximumFractionDigits: 3 })

  function select(id: string, focus = false, match?: EstateOwnershipMatch) {
    const item = all.find(item => item.id === id)
    if (!item) return
    if (villageFilter !== 'both' && item.village.id !== villageFilter) setVillageFilter('both')
    setSelectedId(id); setExpandedDetails(true); setQuery(''); setShowHoldings(false); setLatestRecord(null); setChosenHolder(''); setHolderError('')
    const approximateMatches = matchLocations.filter(location => location.item.id === id && !location.exact)
    const record = match ?? (approximateMatches.length === 1 ? approximateMatches[0].match : undefined)
    setInitialRtcRecord(record?.surnoc && record.hissaNumber ? { parcelId: id, identity: { villageCode: item.village.bhoomi as RtcLookupRequest['villageCode'], surveyNumber: record.surveyNumber, surnoc: record.surnoc, hissaNumber: record.hissaNumber } } : null)
    if (item.level === 'hissa') setShowSubdivisions(true)
    if (focus) setFocusId(id)
  }
  function filter(id: string) {
    setVillageFilter(id); setQuery(''); setFocusId(null)
    if (chosen && id !== 'both' && chosen.village.id !== id) setSelectedId(null)
  }
  async function openFullscreen() {
    setFullscreen(true)
    // iOS Safari can use the CSS immersive fallback when native fullscreen is unavailable.
    try { await mapRef.current?.requestFullscreen?.() } catch { /* The CSS fallback remains active. */ }
  }
  async function closeFullscreen() {
    try { if (document.fullscreenElement === mapRef.current) await document.exitFullscreen?.() } catch { /* Restore the inline view even when native exit fails. */ }
    setFullscreen(false); fullScreenButton.current?.focus()
  }
  function refresh() { clearSurveyMapCache(); setRetry(value => value + 1); onRefreshOwnership?.() }
  function focusEstate() { setVillageFilter('both'); setFocusId(null); setSelectedId(null); setShowHoldings(false); setEstateFocusRequest(value => value + 1) }
  async function openNavigation() { if (fullscreen) await closeFullscreen(); onOpenMenu?.() }
  async function chooseHolder() {
    if (!onChooseHolder || !visibleRecord || !holderChoices.includes(chosenHolder) || holderSaving) return
    setHolderSaving(true); setHolderError('')
    try { await onChooseHolder(visibleRecord, chosenHolder) }
    catch (cause) { setHolderError(cause instanceof Error ? cause.message : 'The recorded holder could not be selected. Try again.') }
    finally { setHolderSaving(false) }
  }

  return <section className="page oe-workspace" aria-label="Our Estate">
    <div ref={mapRef} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? 'Fullscreen estate map' : undefined} className={`oe-map-shell${fullscreen ? ' oe-fullscreen' : ''}${chosen && expandedDetails ? ' oe-with-details' : ''}`}>
      <EstateMapCanvas items={visible} selectedId={selectedId} holdingIds={holdingIds} approximateHoldingIds={approximateHoldingIds} showSubdivisions={showSubdivisions} focusId={focusId} estateFocusRequest={estateFocusRequest} onSelect={select} />
      <div className="oe-map-top">
        <div className="oe-map-intro"><div className="oe-title-card">{onExit && <button type="button" aria-label="Back to estate dashboard" onClick={onExit}><ArrowLeft size={19} /></button>}<div><span className="oe-eyebrow">SAKLESHPUR · KASABA</span><h1>Our Estate</h1></div></div>
        <div className="oe-search-card"><form role="search" onSubmit={event => { event.preventDefault(); if (searchResults[0]) select(searchResults[0].id, true) }}><Search size={19} aria-hidden="true" /><input aria-label="Search survey or subdivision" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a survey or Hissa" autoComplete="off" />{query && <button type="button" aria-label="Clear survey search" onClick={() => setQuery('')}><X size={17} /></button>}</form>
          <div className="oe-village-filters" role="group" aria-label="Map villages"><button type="button" aria-pressed={villageFilter === 'both'} onClick={() => filter('both')}>Both villages</button>{SURVEY_VILLAGES.map(village => <button key={village.id} type="button" aria-pressed={villageFilter === village.id} onClick={() => filter(village.id)}>{village.name}</button>)}</div>
          {query.trim() && <div className="oe-search-results" aria-label="Survey search results"><span>{searchResults.length ? `${searchResults.length} matching ${searchResults.length === 1 ? 'parcel' : 'parcels'}` : 'No matching mapped parcels.'}</span>{searchResults.slice(0, 30).map(item => <button type="button" key={item.id} onClick={() => select(item.id, true)}><MapPin size={16} /><span><strong>{parcelTitle(item)}</strong><small>{item.village.name} · {item.level === 'hissa' ? `Hissa${item.parcel.surnoc ? ` · Surnoc ${item.parcel.surnoc}` : ''}` : 'Whole survey'}</small></span>{holdingIds.has(item.id) && <ShieldCheck className="oe-search-match" size={16} />}</button>)}{searchResults.length > 30 && <small>Refine the survey number or add a village to narrow these results.</small>}</div>}
        </div></div>
        <div className="oe-top-tools"><button type="button" className="oe-focus-estate" aria-label="Focus my estate" disabled={!holdingIds.size} onClick={focusEstate}><LocateFixed size={18} /><span>My estate</span></button><button type="button" aria-label="Hissa outlines" className={showSubdivisions ? 'is-active' : ''} aria-pressed={showSubdivisions} onClick={() => setShowSubdivisions(value => !value)}><Layers size={18} /><span>Hissa outlines</span></button><button type="button" aria-label="Refresh maps" disabled={loading} onClick={refresh}><RefreshCw size={18} className={loading ? 'fi-spinning' : ''} /></button><button ref={fullScreenButton} type="button" aria-label={fullscreen ? 'Exit fullscreen map' : 'Open fullscreen map'} onClick={() => void (fullscreen ? closeFullscreen() : openFullscreen())}>{fullscreen ? <X size={19} /> : <Maximize2 size={19} />}</button>{onOpenMenu && <button type="button" aria-label="Open estate navigation" onClick={() => void openNavigation()}><Menu size={19} /></button>}</div>
      </div>
      {!targetName && onChooseHolder && <p className="oe-holder-onboarding"><ShieldCheck size={16} />Select a survey, then choose your recorded holder from its RTC to mark your estate.</p>}

      {loading && <div className="oe-map-message" role="status"><span className="oe-loading-ring" /><strong>Opening the village maps</strong><p>Loading saved official survey and subdivision outlines.</p></div>}
      {!loading && error && <div className="oe-map-error" role="alert"><p>{error}</p><button type="button" onClick={refresh}>Retry map loading</button></div>}
      {!loading && !error && !all.length && <div className="oe-map-message"><strong>No saved outlines are available</strong><button type="button" className="button-secondary" onClick={refresh}>Retry maps</button></div>}

      {targetName && <aside className={`oe-holdings${showHoldings ? ' is-open' : ''}`} aria-label="Recorded holder matches"><button type="button" className="oe-holdings-toggle" aria-expanded={showHoldings} onClick={() => setShowHoldings(value => !value)}><span className="oe-holding-dot" /><span><strong>{targetName}</strong><small>{ownershipLoading ? 'Checking estate records…' : 'View acreage & estate details'}</small></span>{showHoldings ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>{showHoldings && <div className="oe-holdings-content">{recordedAcres !== null && <div className="oe-recorded-area" aria-label="Matching holder recorded acreage"><span>Recorded estate acreage</span><strong>{acresText} <small>acres</small></strong><p>{recordedCount} {recordedCount === 1 ? 'RTC entry' : 'RTC entries'} with a matching holder name. This totals recorded holder shares, separate from whole-survey outline area.</p></div>}<p>Matching names in official Bhoomi records. Confirm each holder and share in the current RTC.</p>{holderAliases.length > 0 && <div className="oe-holder-aliases" aria-label="Additional recorded names"><span>Also matches</span>{holderAliases.map(name => <p key={name}>{name}</p>)}</div>}{ownershipStatus && <p>{ownershipStatus}</p>}{ownershipError && <p role="alert">{ownershipError}</p>}{ownershipLoading && <p role="status">Checking available estate records…</p>}{!ownershipLoading && !ownershipMatches.length && !ownershipError && <p>No matching records are available yet.</p>}{matchLocations.map(({ match, item, exact }, index) => <button type="button" key={`${match.villageCode}:${match.surveyNumber}:${match.surnoc}:${match.hissaNumber}:${index}`} onClick={() => select(item.id, true, match)}><MapPin size={15} /><span><strong>{item.village.name} · {match.surveyNumber}{match.hissaNumber ? ` / ${match.hissaNumber}` : ''}</strong><small>{exact ? 'Mapped parcel' : 'Placed on whole survey · Hissa outline unavailable'}</small></span><ArrowUpRight size={14} /></button>)}{ownershipMatches.length > matchLocations.length && <p>{ownershipMatches.length - matchLocations.length} matching records do not have a mapped survey outline.</p>}{onRefreshOwnership && <button type="button" className="oe-holdings-refresh" disabled={ownershipLoading} onClick={onRefreshOwnership}><RefreshCw size={14} />Refresh holder matches</button>}<div className="oe-map-inventory">{villageCounts.map(({ village, surveys, subdivisions }) => <small key={village.id}>{village.name}: {surveys} surveys · {subdivisions} mapped Hissas</small>)}{newest && <small>Map retrieved {new Date(newest).toLocaleString('en-IN')}</small>}</div><small>Private to your signed-in account{email ? ` · ${email}` : ''}.</small></div>}</aside>}

      {chosen && <aside className={`oe-details${expandedDetails ? ' is-expanded' : ''}`} aria-label="Selected estate parcel"><header><button type="button" className="oe-details-heading" aria-expanded={expandedDetails} onClick={() => setExpandedDetails(value => !value)}><span><small>{chosen.village.name}</small><strong>{parcelTitle(chosen)}</strong></span>{expandedDetails ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button><button type="button" aria-label="Close parcel details" onClick={() => setSelectedId(null)}><X size={18} /></button></header>{expandedDetails && <div className="oe-details-body">
        <div className="oe-parcel-actions"><button type="button" onClick={() => setFocusId(chosen.id)}><Expand size={14} />Focus parcel</button>{point && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point[1]},${point[0]}`)}`} target="_blank" rel="noopener noreferrer">Open Google Maps<ArrowUpRight size={14} /></a>}</div>
        <label className="oe-hissa-picker">Mapped survey / subdivision<select aria-label="Selected map subdivision" value={chosen.id} onChange={event => select(event.target.value, true)}>{wholeSurvey && <option value={wholeSurvey.id}>Whole survey {wholeSurvey.parcel.survey}</option>}{related.map(item => <option key={item.id} value={item.id}>Hissa {item.parcel.hissa}{item.parcel.surnoc && item.parcel.surnoc !== '*' ? ` · Surnoc ${item.parcel.surnoc}` : ''}</option>)}</select></label>
        {!related.length && <p className="oe-details-note">No matching Hissa outline is published for this survey. The RTC panel can still show the available official records.</p>}
        {holdingIds.has(chosen.id) && <div className="oe-record-match"><ShieldCheck size={17} /><span>Recorded holder match{targetName ? ` for ${targetName}` : ''}. Check the names and shares below.</span></div>}
        {holdingIds.has(chosen.id) && recordedAcres !== null && <div className="oe-recorded-area oe-parcel-estate-total" aria-label="Estate recorded acreage"><span>Estate recorded total</span><strong>{acresText} <small>acres</small></strong><p>Matching shares found so far. The selected parcel's RTC and its individual shares are below.</p></div>}
        {!targetName && onChooseHolder && holderChoices.length > 0 && <section className="oe-holder-setup" aria-label="Choose estate holder"><h3>Mark your estate</h3><p>Select the holder name you use for your estate. The server verifies this name against the selected official RTC.</p><label>Recorded holder<select aria-label="Estate holder name" value={chosenHolder} onChange={event => setChosenHolder(event.target.value)} disabled={holderSaving}><option value="">Choose a holder in this RTC</option>{holderChoices.map(name => <option key={name} value={name}>{name}</option>)}</select></label><button type="button" className="button-secondary" disabled={!chosenHolder || holderSaving} onClick={() => void chooseHolder()}>{holderSaving ? 'Checking holder…' : 'Use this holder for my estate'}</button>{(holderError || ownershipError) && <p role="alert">{holderError || ownershipError}</p>}</section>}
        <FarmParcelDetails key={`${chosen.id}:${initialRtcRecord?.identity.surnoc ?? ''}:${initialRtcRecord?.identity.hissaNumber ?? ''}`} initialRecord={initialRtcRecord?.parcelId === chosen.id ? initialRtcRecord.identity : undefined} village={chosen.village} parcel={chosen.parcel} point={point} level={chosen.level} sourceUrl={chosen.sourceUrl} retrievedAt={chosen.retrievedAt} onRecord={recordLoaded} />
      </div>}</aside>}

      <div className="oe-map-bottom"><div className="oe-map-caption"><div className="oe-legend">{targetName && <span><i className="oe-legend-holder" />Our estate</span>}<span><i />Survey borders</span>{approximateHoldingIds.size > 0 && <span><i className="oe-legend-approximate" />Border unavailable</span>}</div><p>Pinch to explore · Click a parcel for details</p></div><div className="oe-attribution"><a href={SURVEY_LAYER} target="_blank" rel="noopener noreferrer">Survey data: KGIS / KSRSAC</a><span> · </span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></div></div>
    </div>
  </section>
}
