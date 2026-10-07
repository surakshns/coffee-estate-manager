import { useEffect, useMemo, useState } from 'react'
import { LocateFixed, Minus, Plus, RotateCcw } from 'lucide-react'
import { Sheet, Notice } from './Workspace'
import { SURVEY_VILLAGES, clearSurveyMapCache, loadSurveyParcels, parcelPoint, SURVEY_LAYER, type SurveyParcel, type SurveySelection } from '../lib/farmSurveyMap'

const label = (parcel: SurveyParcel) => (parcel.hissa ? `${parcel.survey} / ${parcel.hissa}` : parcel.survey) + (parcel.surnoc && parcel.surnoc !== '*' ? ` · Surnoc ${parcel.surnoc}` : '')
export function FarmSurveyPicker({ onSelect }: { onSelect: (selection: SurveySelection) => void }) {
  const [open, setOpen] = useState(false), [villageId, setVillageId] = useState(''), [parcels, setParcels] = useState<SurveyParcel[]>([]), [subdivisions, setSubdivisions] = useState<SurveyParcel[]>([])
  const [selected, setSelected] = useState(''), [hissa, setHissa] = useState(''), [loading, setLoading] = useState(false), [hissaLoading, setHissaLoading] = useState(false), [error, setError] = useState(''), [hissaError, setHissaError] = useState(''), [retry, setRetry] = useState(0)
  const [source, setSource] = useState({ sourceUrl: '', retrievedAt: '' }), [hissaSource, setHissaSource] = useState({ sourceUrl: '', retrievedAt: '' }), [zoom, setZoom] = useState(1)
  const village = SURVEY_VILLAGES.find(item => item.id === villageId)
  const whole = parcels.find(parcel => parcel.key === selected), subdivision = subdivisions.find(parcel => parcel.key === hissa), chosen = subdivision ?? whole
  useEffect(() => {
    setParcels([]); setSelected(''); setSubdivisions([]); setHissa(''); setError(''); setSource({ sourceUrl: '', retrievedAt: '' }); setZoom(1)
    setLoading(false)
    if (!open || !village) return
    let active = true
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    setLoading(true)
    void loadSurveyParcels(village, controller.signal).then(result => { if (active && !controller.signal.aborted) { setParcels(result.parcels); setSource(result) } }).catch(() => { if (active) setError(controller.signal.aborted ? 'The saved map is taking too long to load. Check your connection and retry.' : 'The saved village map could not be loaded. Check your connection and retry.') }).finally(() => { clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [open, village, retry])
  useEffect(() => {
    setSubdivisions([]); setHissa(''); setHissaError('')
    setHissaLoading(false)
    if (!open || !village || !whole) return
    let active = true
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000)
    setHissaLoading(true)
    void loadSurveyParcels(village, controller.signal, whole.survey).then(result => { if (active && !controller.signal.aborted) { setSubdivisions(result.parcels.filter(parcel => parcel.hissa)); setHissaSource(result) } }).catch(() => { if (active) setHissaError(controller.signal.aborted ? 'Subdivision lookup timed out. You can use the whole-survey map point.' : 'Subdivision geometry could not be verified. You can use the whole-survey map point.') }).finally(() => { clearTimeout(timer); if (active) setHissaLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort() }
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
  const point = useMemo(() => { if (!chosen) return null; try { return parcelPoint(chosen) } catch { return null } }, [chosen])
  const marker = chosen && point && drawing ? drawing.project(point) : [250, 250]
  const focus = zoom === 1 ? [250, 250] : marker
  function apply() {
    if (!village || !chosen || !point) return
    onSelect({ village, parcel: chosen, longitude: point[0], latitude: point[1], ...(subdivision ? hissaSource : source), level: subdivision ? 'hissa' : 'whole_survey' })
    setOpen(false)
  }
  return <><button type="button" className="button-secondary fi-map-launch" onClick={() => setOpen(true)}><LocateFixed size={17} />Select survey number on map</button><Sheet open={open} title="Locate your estate by survey number" wide onClose={() => setOpen(false)} className="fi-survey-sheet">
    <p className="fi-help">Official KGIS map · Kasaba hobli, Sakleshpur, Hassan. Select your village, then a survey parcel. You can choose a mapped subdivision when available.</p>
    <div className="fi-map-filters"><label>Map village<select value={villageId} onChange={e => setVillageId(e.target.value)}><option value="">Select a village</option>{SURVEY_VILLAGES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Survey number<select disabled={!parcels.length || loading} value={selected} onChange={e => { setSelected(e.target.value); setZoom(2) }}><option value="">Select a survey number</option>{parcels.map(parcel => <option key={parcel.key} value={parcel.key}>{label(parcel)}</option>)}</select></label></div>
    <Notice error>{error}</Notice>{error && <button type="button" className="button-secondary" onClick={() => { clearSurveyMapCache(); setRetry(value => value + 1) }}>Retry map</button>}
    {loading ? <p role="status" className="fi-map-status">Loading official survey outlines…</p> : drawing ? <div className="fi-survey-map"><svg viewBox="0 0 500 500" aria-label={`${village?.name} survey parcels`} role="img"><rect width="500" height="500" fill="#f3f6ed" /><g transform={`translate(${250 - focus[0] * zoom} ${250 - focus[1] * zoom}) scale(${zoom})`}>{parcels.map(parcel => <path key={parcel.key} d={drawing.path(parcel)} fillRule="evenodd" className={parcel.key === selected ? 'is-selected' : ''} vectorEffect="non-scaling-stroke" onClick={() => { setSelected(parcel.key); setZoom(2) }}><title>Survey {label(parcel)}</title></path>)}{zoom >= 3 && drawing.labels.map(item => <text key={`label-${item.key}`} x={item.point[0]} y={item.point[1]} textAnchor="middle" style={{fontSize: `${10 / zoom}px`}}>{item.label}</text>)}{subdivision && <path d={drawing.path(subdivision)} className="is-hissa" fillRule="evenodd" vectorEffect="non-scaling-stroke" />}{point && <circle cx={marker[0]} cy={marker[1]} r={4 / zoom} className="fi-map-point" />}</g><text x="474" y="26" textAnchor="middle">N ↑</text></svg><div className="fi-map-tools"><button type="button" aria-label="Zoom in" disabled={zoom >= 8} onClick={() => setZoom(value => Math.min(8, value + 1))}><Plus size={17} /></button><button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 1))}><Minus size={17} /></button><button type="button" aria-label="Reset map view" onClick={() => setZoom(1)}><RotateCcw size={16} /></button></div><p>Tap a parcel or use the survey-number list. Selected parcel: green.</p></div> : <p className="fi-map-status">{village ? 'No selectable survey parcels were returned.' : 'Choose Hebbasale or Devihalli to load its official survey map.'}</p>}
    {whole && <div className="fi-map-selection"><div className="fi-map-filters"><label>Subdivision / Hissa<select value={hissa} disabled={hissaLoading || !subdivisions.length} onChange={e => setHissa(e.target.value)}><option value="">Whole survey {whole.survey}</option>{subdivisions.map(parcel => <option key={parcel.key} value={parcel.key}>{label(parcel)}</option>)}</select></label><div><strong>{village?.name} · Survey {label(chosen!)}</strong>{point && <p>Map point: {point[1].toFixed(6)}, {point[0].toFixed(6)}</p>}</div></div><p className="fi-help">{hissaLoading ? 'Checking official subdivision geometry…' : hissaError || (!subdivisions.length ? 'No numbered subdivision geometry was returned for this survey.' : 'Choose your Hissa above, or keep the whole survey.')}</p><p className="fi-help">Elevation, cultivated area, crops and ownership are not supplied by this map. A whole-survey point does not identify your particular subdivision.</p>{!point && <Notice error>A point inside this parcel could not be verified. Use manual coordinates.</Notice>}<button type="button" className="button-primary" disabled={!point} onClick={apply}>Use this {subdivision ? 'subdivision' : 'survey'} location</button></div>}
    {source.retrievedAt && <p className="fi-help">Saved official map · retrieved {new Date(source.retrievedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. {Date.now() - Date.parse(source.retrievedAt) > 172800000 ? 'The publisher refresh is delayed; this saved map remains available.' : 'Checked for updates daily in the background.'}</p>}
    {subdivision && hissaSource.retrievedAt !== source.retrievedAt && <p className="fi-help">Subdivision map retrieved {new Date(hissaSource.retrievedAt).toLocaleString('en-IN')}.</p>}
    <p className="fi-map-attribution"><a href={SURVEY_LAYER} target="_blank" rel="noopener noreferrer">Source: Karnataka GIS / KSRSAC</a> · For farm planning. Verify current boundaries and ownership against official RTC/SSLR records.</p>
  </Sheet></>
}
