import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { LocateFixed, Minus, Plus, RotateCcw } from 'lucide-react'
import { Sheet, Notice } from './Workspace'
import { FarmParcelDetails } from './FarmParcelDetails'
import type { RtcRecord } from '../lib/farmRtcClient'
import { SURVEY_VILLAGES, clearSurveyMapCache, loadSurveyParcels, parcelPoint, SURVEY_LAYER, type SurveyParcel, type SurveySelection } from '../lib/farmSurveyMap'

const label = (parcel: SurveyParcel) => (parcel.hissa ? `${parcel.survey} / ${parcel.hissa}` : parcel.survey) + (parcel.surnoc && parcel.surnoc !== '*' ? ` · Surnoc ${parcel.surnoc}` : '')
type MapView = { zoom: number; x: number; y: number }
type MapPointer = { x: number; y: number; clientX: number; clientY: number; startX: number; startY: number; startClientX: number; startClientY: number; parcel: string | null; hissa: string | null }
const INITIAL_VIEW: MapView = { zoom: 1, x: 0, y: 0 }
const MAX_ZOOM = 8
const DRAG_THRESHOLD = 8
function boundedView(view: MapView): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom)), min = 500 - 500 * zoom
  return { zoom, x: Math.min(0, Math.max(min, view.x)), y: Math.min(0, Math.max(min, view.y)) }
}
function mapPosition(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect(), width = rect.width || 500, height = rect.height || 500
  const scale = Math.min(width / 500, height / 500)
  return { x: (clientX - rect.left - (width - 500 * scale) / 2) / scale, y: (clientY - rect.top - (height - 500 * scale) / 2) / scale }
}
export function FarmSurveyPicker({ onSelect }: { onSelect: (selection: SurveySelection) => void }) {
  const [open, setOpen] = useState(false), [villageId, setVillageId] = useState(''), [parcels, setParcels] = useState<SurveyParcel[]>([]), [subdivisions, setSubdivisions] = useState<SurveyParcel[]>([])
  const [selected, setSelected] = useState(''), [hissa, setHissa] = useState(''), [loading, setLoading] = useState(false), [hissaLoading, setHissaLoading] = useState(false), [error, setError] = useState(''), [hissaError, setHissaError] = useState(''), [retry, setRetry] = useState(0)
  const [source, setSource] = useState({ sourceUrl: '', retrievedAt: '' }), [hissaSource, setHissaSource] = useState({ sourceUrl: '', retrievedAt: '' }), [view, setView] = useState(INITIAL_VIEW)
  const viewRef = useRef(INITIAL_VIEW), pointers = useRef(new Map<number, MapPointer>()), gestureMoved = useRef(false), suppressClick = useRef(false)
  const mapRequest = useRef<AbortController | null>(null), hissaRequest = useRef<AbortController | null>(null)
  const [rtcRecord, setRtcRecord] = useState<RtcRecord | null>(null)
  const zoom = view.zoom
  const village = SURVEY_VILLAGES.find(item => item.id === villageId)
  const whole = parcels.find(parcel => parcel.key === selected), subdivision = whole ? subdivisions.find(parcel => parcel.key === hissa && parcel.survey === whole.survey) : undefined, chosen = subdivision ?? whole
  useEffect(() => {
    resetMapSelection()
    if (!open || !village) return
    let active = true
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    mapRequest.current = controller
    setLoading(true)
    void loadSurveyParcels(village, controller.signal).then(result => { if (active && mapRequest.current === controller && !controller.signal.aborted) { setParcels(result.parcels); setSource(result) } }).catch(() => { if (active && mapRequest.current === controller) setError(controller.signal.aborted ? 'The saved map is taking too long to load. Check your connection and retry.' : 'The saved village map could not be loaded. Check your connection and retry.') }).finally(() => { clearTimeout(timer); if (active && mapRequest.current === controller) setLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort(); if (mapRequest.current === controller) mapRequest.current = null }
  }, [open, village, retry])
  useEffect(() => {
    resetSubdivisionSelection()
    if (!open || !village || !whole) return
    let active = true
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000)
    hissaRequest.current = controller
    setHissaLoading(true)
    void loadSurveyParcels(village, controller.signal, whole.survey).then(result => { if (active && hissaRequest.current === controller && !controller.signal.aborted) { setSubdivisions(result.parcels.filter(parcel => parcel.hissa)); setHissaSource(result) } }).catch(() => { if (active && hissaRequest.current === controller) setHissaError(controller.signal.aborted ? 'Subdivision lookup timed out. You can use the whole-survey map point.' : 'Subdivision geometry could not be verified. You can use the whole-survey map point.') }).finally(() => { clearTimeout(timer); if (active && hissaRequest.current === controller) setHissaLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort(); if (hissaRequest.current === controller) hissaRequest.current = null }
  }, [open, village, whole])
  const drawing = useMemo(() => {
    const points = parcels.flatMap(parcel => parcel.polygons.flat(2))
    if (!points.length) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const point of points) { minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]) }
    const cos = Math.cos((minY + maxY) / 2 * Math.PI / 180), width = (maxX - minX) * cos, height = maxY - minY, scale = 440 / Math.max(width, height)
    const project = (point: [number, number]) => [30 + (point[0] - minX) * cos * scale, 30 + (maxY - point[1]) * scale] as const
    const path = (parcel: SurveyParcel) => parcel.polygons.map(polygon => polygon.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${project(point)[0].toFixed(2)},${project(point)[1].toFixed(2)}`).join(' ') + ' Z').join(' ')).join(' ')
    const paths = new Map(parcels.map(parcel => [parcel.key, path(parcel)]))
    const labels = parcels.flatMap(parcel => { try { return [{ key: parcel.key, label: parcel.survey, point: project(parcelPoint(parcel)) }] } catch { return [] } })
    return { project, path: (parcel: SurveyParcel) => paths.get(parcel.key) ?? path(parcel), labels }
  }, [parcels])
  const hissaDrawing = useMemo(() => {
    if (!drawing || !whole) return []
    return subdivisions.filter(parcel => parcel.survey === whole.survey).map(parcel => {
      let labelPoint: readonly [number, number] | null = null
      try { labelPoint = drawing.project(parcelPoint(parcel)) } catch { /* Keep a selectable outline even when its interior point is unavailable. */ }
      return { parcel, path: drawing.path(parcel), labelPoint }
    })
  }, [drawing, whole, subdivisions])
  const point = useMemo(() => { if (!chosen) return null; try { return parcelPoint(chosen) } catch { return null } }, [chosen])
  const marker = chosen && point && drawing ? drawing.project(point) : [250, 250]
  function updateView(next: MapView) {
    const bounded = boundedView(next)
    viewRef.current = bounded
    setView(bounded)
  }
  function resetView() {
    pointers.current.clear(); gestureMoved.current = false; suppressClick.current = false
    updateView(INITIAL_VIEW)
  }
  function resetSubdivisionSelection() {
    setRtcRecord(null)
    const controller = hissaRequest.current
    hissaRequest.current = null; controller?.abort()
    setSubdivisions([]); setHissa(''); setHissaError(''); setHissaLoading(false); setHissaSource({ sourceUrl: '', retrievedAt: '' })
  }
  function resetMapSelection() {
    const controller = mapRequest.current
    mapRequest.current = null; controller?.abort()
    resetSubdivisionSelection()
    setParcels([]); setSelected(''); setError(''); setLoading(false); setSource({ sourceUrl: '', retrievedAt: '' }); resetView()
  }
  function closePicker() { resetMapSelection(); setOpen(false) }
  function selectParcel(key: string) {
    setRtcRecord(null)
    if (key !== selected) resetSubdivisionSelection()
    else setHissa('')
    setSelected(key)
    const parcel = parcels.find(item => item.key === key)
    if (!parcel || !drawing) return
    try {
      const centre = drawing.project(parcelPoint(parcel)), zoom = Math.max(2, viewRef.current.zoom)
      updateView({ zoom, x: 250 - centre[0] * zoom, y: 250 - centre[1] * zoom })
    } catch { /* The details panel handles a parcel without a verified interior point. */ }
  }
  function selectHissa(key: string) {
    if (key !== hissa) setRtcRecord(null)
    if (!key || (whole && subdivisions.some(parcel => parcel.key === key && parcel.survey === whole.survey))) setHissa(key)
  }
  function zoomBy(amount: number) {
    const current = viewRef.current, nextZoom = Math.min(MAX_ZOOM, Math.max(1, current.zoom + amount)), ratio = nextZoom / current.zoom
    updateView({ zoom: nextZoom, x: 250 - (250 - current.x) * ratio, y: 250 - (250 - current.y) * ratio })
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (!pointers.current.size) { gestureMoved.current = false; suppressClick.current = false }
    const position = mapPosition(event.currentTarget, event.clientX, event.clientY)
    const target = event.target instanceof Element ? event.target.closest('[data-survey-key], [data-hissa-key]') : null
    pointers.current.set(event.pointerId, { ...position, clientX: event.clientX, clientY: event.clientY, startX: position.x, startY: position.y, startClientX: event.clientX, startClientY: event.clientY, parcel: target?.getAttribute('data-survey-key') ?? null, hissa: target?.getAttribute('data-hissa-key') ?? null })
    if (pointers.current.size > 1) { gestureMoved.current = true; suppressClick.current = true }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const previousPair = [...pointers.current.values()].slice(0, 2)
    const position = mapPosition(event.currentTarget, event.clientX, event.clientY)
    pointers.current.set(event.pointerId, { ...previous, ...position, clientX: event.clientX, clientY: event.clientY })
    const current = viewRef.current
    if (pointers.current.size > 1) {
      const nextPair = [...pointers.current.values()].slice(0, 2)
      const distance = (pair: MapPointer[]) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)
      const previousDistance = distance(previousPair)
      if (previousDistance < 1) return
      const previousMid = { x: (previousPair[0].x + previousPair[1].x) / 2, y: (previousPair[0].y + previousPair[1].y) / 2 }, nextMid = { x: (nextPair[0].x + nextPair[1].x) / 2, y: (nextPair[0].y + nextPair[1].y) / 2 }
      const nextZoom = Math.min(MAX_ZOOM, Math.max(1, current.zoom * distance(nextPair) / previousDistance)), ratio = nextZoom / current.zoom
      updateView({ zoom: nextZoom, x: nextMid.x - (previousMid.x - current.x) * ratio, y: nextMid.y - (previousMid.y - current.y) * ratio })
      return
    }
    const wasMoving = gestureMoved.current
    if (!wasMoving && Math.hypot(event.clientX - previous.startClientX, event.clientY - previous.startClientY) < DRAG_THRESHOLD) return
    gestureMoved.current = true; suppressClick.current = true
    updateView({ ...current, x: current.x + position.x - (wasMoving ? previous.x : previous.startX), y: current.y + position.y - (wasMoving ? previous.y : previous.startY) })
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const moved = Math.hypot(event.clientX - previous.startClientX, event.clientY - previous.startClientY) >= DRAG_THRESHOLD
    const canSelect = !cancelled && !moved && !gestureMoved.current && pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    suppressClick.current = true
    if (canSelect && previous.hissa) selectHissa(previous.hissa)
    else if (canSelect && previous.parcel) selectParcel(previous.parcel)
    if (!pointers.current.size) gestureMoved.current = false
  }
  function apply() {
    if (!village || !chosen || !point) return
    onSelect({ village, parcel: chosen, longitude: point[0], latitude: point[1], ...(subdivision ? hissaSource : source), level: subdivision ? 'hissa' : 'whole_survey', rtcRecord })
    closePicker()
  }
  return <><button type="button" className="button-secondary fi-map-launch" onClick={() => { resetMapSelection(); setOpen(true) }}><LocateFixed size={17} />Select survey number on map</button><Sheet open={open} title="Locate your estate by survey number" wide onClose={closePicker} className="fi-survey-sheet">
    <p className="fi-help">Official KGIS map · Kasaba hobli, Sakleshpur, Hassan. Select your village, then a survey parcel. You can choose a mapped subdivision when available.</p>
    <div className="fi-map-filters"><label>Map village<select value={villageId} onChange={e => { resetMapSelection(); setVillageId(e.target.value) }}><option value="">Select a village</option>{SURVEY_VILLAGES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Survey number<select disabled={!parcels.length || loading} value={selected} onChange={e => selectParcel(e.target.value)}><option value="">Select a survey number</option>{parcels.map(parcel => <option key={parcel.key} value={parcel.key}>{label(parcel)}</option>)}</select></label></div>
    <Notice error>{error}</Notice>{error && <button type="button" className="button-secondary" onClick={() => { resetMapSelection(); clearSurveyMapCache(); setRetry(value => value + 1) }}>Retry map</button>}
    {loading ? <p role="status" className="fi-map-status">Loading official survey outlines…</p> : drawing ? <div className="fi-survey-map"><svg viewBox="0 0 500 500" aria-label={`${village?.name} survey parcels`} role="img" style={{ touchAction: 'none', userSelect: 'none' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}><rect width="500" height="500" fill="#f3f6ed" /><g transform={`translate(${view.x} ${view.y}) scale(${zoom})`}>{parcels.map(parcel => <path key={parcel.key} d={drawing.path(parcel)} fillRule="evenodd" className={parcel.key === selected ? 'is-selected' : ''} vectorEffect="non-scaling-stroke" data-survey-key={parcel.key} onClick={() => { if (!suppressClick.current) selectParcel(parcel.key) }}><title>Survey {label(parcel)}</title></path>)}{zoom >= 3 && drawing.labels.map(item => <text key={`label-${item.key}`} x={item.point[0]} y={item.point[1]} textAnchor="middle" style={{fontSize: `${18 / zoom}px`}}>{item.label}</text>)}{hissaDrawing.map(item => <path key={`hissa-${item.parcel.key}`} d={item.path} className={`fi-hissa-outline${item.parcel.key === hissa ? ' is-selected-hissa' : ''}`} fillRule="evenodd" vectorEffect="non-scaling-stroke" data-hissa-key={item.parcel.key} onClick={() => { if (!suppressClick.current) selectHissa(item.parcel.key) }}><title>Survey {label(item.parcel)}</title></path>)}{zoom >= 2 && hissaDrawing.map(item => item.labelPoint && <text key={`hissa-label-${item.parcel.key}`} className={item.parcel.key === hissa ? "is-selected-hissa-label" : undefined} x={item.labelPoint[0]} y={item.labelPoint[1]} textAnchor="middle" style={{ fontSize: `${18 / zoom}px` }}>H{item.parcel.hissa}</text>)}{point && <circle cx={marker[0]} cy={marker[1]} r={4 / zoom} className="fi-map-point" />}</g><text x="474" y="26" textAnchor="middle">N ↑</text></svg><div className="fi-map-tools"><button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(1)}><Plus size={17} /></button><button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomBy(-1)}><Minus size={17} /></button><button type="button" aria-label="Reset map view" onClick={resetView}><RotateCcw size={16} /></button></div><p>Pinch to zoom and drag with one finger. Tap a survey, then a mapped Hissa, or use the lists. Selected survey: green; selected Hissa: dark green.</p></div> : <p className="fi-map-status">{village ? 'No selectable survey parcels were returned.' : 'Choose Hebbasale or Devihalli to load its official survey map.'}</p>}
    {whole && <div className="fi-map-selection"><div className="fi-map-filters"><label>Subdivision / Hissa<select value={hissa} disabled={hissaLoading || !subdivisions.length} onChange={e => selectHissa(e.target.value)}><option value="">Whole survey {whole.survey}</option>{subdivisions.map(parcel => <option key={parcel.key} value={parcel.key}>{label(parcel)}</option>)}</select></label><div><strong>{village?.name} · Survey {label(chosen!)}</strong>{point && <p>Map point: {point[1].toFixed(6)}, {point[0].toFixed(6)}</p>}</div></div><p className="fi-help">{hissaLoading ? 'Checking official subdivision geometry…' : hissaError || (!subdivisions.length ? 'No numbered subdivision geometry was returned for this survey.' : 'Tap a mapped Hissa or choose it above, or keep the whole survey.')}</p>{village && <FarmParcelDetails key={`${village.id}:${chosen!.key}`} village={village} parcel={chosen!} point={point} level={subdivision ? 'hissa' : 'whole_survey'} sourceUrl={subdivision ? hissaSource.sourceUrl : source.sourceUrl} retrievedAt={subdivision ? hissaSource.retrievedAt : source.retrievedAt} onRecord={setRtcRecord} />} <p className="fi-help">Elevation, cultivated area, crops and ownership are not supplied by this map. A whole-survey point does not identify your particular subdivision.</p>{!point && <Notice error>A point inside this parcel could not be verified. Use manual coordinates.</Notice>}<button type="button" className="button-primary" disabled={!point} onClick={apply}>Use this {subdivision ? 'subdivision' : 'survey'} location</button></div>}
    {source.retrievedAt && <p className="fi-help">Saved official map · retrieved {new Date(source.retrievedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. {Date.now() - Date.parse(source.retrievedAt) > 172800000 ? 'The publisher refresh is delayed; this saved map remains available.' : 'Checked for updates daily in the background.'}</p>}
    {subdivision && hissaSource.retrievedAt !== source.retrievedAt && <p className="fi-help">Subdivision map retrieved {new Date(hissaSource.retrievedAt).toLocaleString('en-IN')}.</p>}
    <p className="fi-map-attribution"><a href={SURVEY_LAYER} target="_blank" rel="noopener noreferrer">Source: Karnataka GIS / KSRSAC</a> · For farm planning. Verify current boundaries and ownership against official RTC/SSLR records.</p>
  </Sheet></>
}
