import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { parcelPoint, type SurveyParcel, type SurveyVillage } from '../lib/farmSurveyMap'

export type EstateMapParcel = {
  id: string
  village: SurveyVillage
  parcel: SurveyParcel
  level: 'whole_survey' | 'hissa'
  sourceUrl: string
  retrievedAt: string
}
type View = { zoom: number; x: number; y: number }
type Pointer = { x: number; y: number; clientX: number; clientY: number; startX: number; startY: number; startClientX: number; startClientY: number; parcelId: string | null }
// Safari emits GestureEvents for trackpad pinches instead of Control-wheel events.
type MapGestureEvent = Event & { scale: number; clientX?: number; clientY?: number }
const START: View = { zoom: 1, x: 0, y: 0 }
const WIDTH = 1000, FALLBACK_HEIGHT = 700, MAX_ZOOM = 32, DRAG_THRESHOLD = 8

function bound(view: View, height: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom))
  return { zoom, x: Math.min(0, Math.max(WIDTH - WIDTH * zoom, view.x)), y: Math.min(0, Math.max(height - height * zoom, view.y)) }
}
function position(svg: SVGSVGElement, clientX: number, clientY: number, canvasHeight: number) {
  const rect = svg.getBoundingClientRect(), width = rect.width || WIDTH, height = rect.height || canvasHeight
  const scale = Math.min(width / WIDTH, height / canvasHeight)
  return { x: (clientX - rect.left - (width - WIDTH * scale) / 2) / scale, y: (clientY - rect.top - (height - canvasHeight * scale) / 2) / scale }
}
// The street tiles and the government parcel outlines share Web Mercator.
function mercator([longitude, latitude]: [number, number]) {
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180)
  return [(longitude + 180) / 360, .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)] as const
}

/** Cadastral geometry is preprojected once; moving the map changes one SVG group. */
export function EstateMapCanvas({ items, selectedId, holdingIds, approximateHoldingIds, showSubdivisions, focusId, estateFocusRequest = 0, onSelect }: {
  items: EstateMapParcel[]
  selectedId: string | null
  holdingIds: ReadonlySet<string>
  approximateHoldingIds?: ReadonlySet<string>
  showSubdivisions: boolean
  focusId: string | null
  estateFocusRequest?: number
  onSelect: (id: string) => void
}) {
  const [view, setView] = useState(START)
  const gridId = useId()
  const [canvasSize, setCanvasSize] = useState({ width: WIDTH, height: FALLBACK_HEIGHT }), [tileError, setTileError] = useState(false)
  const canvasHeight = Math.max(350, Math.min(2400, WIDTH * canvasSize.height / canvasSize.width))
  const density = Math.min(canvasSize.width / WIDTH, canvasSize.height / canvasHeight), screenScale = 1 / density
  const svgRef = useRef<SVGSVGElement | null>(null)
  const viewRef = useRef(START), pointers = useRef(new Map<number, Pointer>()), moved = useRef(false), suppressClick = useRef(false)
  const initialEstateFocus = useRef(false), lastEstateFocusRequest = useRef(estateFocusRequest), lastEstateFocusHeight = useRef(canvasHeight)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect?.width && rect.height) setCanvasSize({ width: rect.width, height: rect.height })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])
  const drawing = useMemo(() => {
    const whole = items.filter(item => item.level === 'whole_survey')
    const basis = whole.length ? whole : items
    let west = Infinity, east = -Infinity, south = -Infinity, north = Infinity
    for (const item of basis) for (const polygon of item.parcel.polygons) for (const ring of polygon) for (const point of ring) {
      const [x, y] = mercator(point)
      west = Math.min(west, x); east = Math.max(east, x); south = Math.max(south, y); north = Math.min(north, y)
    }
    if (!Number.isFinite(west) || east <= west || south <= north) return null
    const spanX = east - west, spanY = south - north
    const scale = Math.min((WIDTH - 120) / spanX, (canvasHeight - 120) / spanY)
    const offsetX = (WIDTH - spanX * scale) / 2, offsetY = (canvasHeight - spanY * scale) / 2
    const project = (point: [number, number]) => {
      const [x, y] = mercator(point)
      return [offsetX + (x - west) * scale, offsetY + (y - north) * scale] as const
    }
    const paths = items.map(item => {
      let centre: readonly [number, number] | null = null
      try { centre = project(parcelPoint(item.parcel)) } catch { /* Outlines remain selectable without an interior point. */ }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const d = item.parcel.polygons.map(polygon => polygon.map(ring => ring.map((point, index) => {
        const [x, y] = project(point)
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
      }).join(' ') + ' Z').join(' ')).join(' ')
      return { item, d, centre, bounds: { minX, minY, maxX, maxY } }
    })
    const villageLabels = [...new Map(basis.map(item => [item.village.id, item.village])).values()].map(village => {
      const coordinates = paths.filter(path => path.item.village.id === village.id && path.item.level === 'whole_survey').flatMap(path => path.centre ? [path.centre] : [])
      return { village, x: coordinates.reduce((sum, p) => sum + p[0], 0) / (coordinates.length || 1), y: coordinates.reduce((sum, p) => sum + p[1], 0) / (coordinates.length || 1) }
    })
    return { paths, villageLabels, scale, offsetX, offsetY, west, north }
  }, [items, canvasHeight])

  const tiles = useMemo(() => {
    if (!drawing) return []
    const z = Math.max(1, Math.min(19, Math.floor(Math.log2(drawing.scale * view.zoom * density / 256))))
    const n = 2 ** z, size = drawing.scale / n
    const worldX = (x: number) => ((x - view.x) / view.zoom - drawing.offsetX) / drawing.scale + drawing.west
    const worldY = (y: number) => ((y - view.y) / view.zoom - drawing.offsetY) / drawing.scale + drawing.north
    const left = Math.max(0, Math.floor(worldX(0) * n)), right = Math.min(n - 1, Math.floor(worldX(WIDTH) * n))
    const top = Math.max(0, Math.floor(worldY(0) * n)), bottom = Math.min(n - 1, Math.floor(worldY(canvasHeight) * n))
    const visibleTiles = []
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) visibleTiles.push({ id: `${z}/${x}/${y}`, src: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, x: drawing.offsetX + (x / n - drawing.west) * drawing.scale, y: drawing.offsetY + (y / n - drawing.north) * drawing.scale, size })
    // Only the current viewport is requested. No prefetch or offline tile cache.
    return visibleTiles
  }, [drawing, view, canvasHeight, density])

  const update = useCallback((next: View) => { const value = bound(next, canvasHeight); viewRef.current = value; setView(value) }, [canvasHeight])
  function reset() { pointers.current.clear(); moved.current = false; suppressClick.current = false; update(START) }
  useEffect(() => { reset(); if (!items.length) initialEstateFocus.current = false }, [items]) // A village filter refits its visible geometry.
  useEffect(() => {
    const requested = estateFocusRequest !== lastEstateFocusRequest.current
    const resized = canvasHeight !== lastEstateFocusHeight.current
    if (!drawing || (initialEstateFocus.current && !requested && !resized)) return
    const matches = drawing.paths.filter(path => holdingIds.has(path.item.id))
    if (!matches.length) return
    // A missing Hissa contributes its location marker, not an unrelated whole-survey extent.
    const bounds = matches.map(path => approximateHoldingIds?.has(path.item.id) && path.centre
      ? { minX: path.centre[0], maxX: path.centre[0], minY: path.centre[1], maxY: path.centre[1] } : path.bounds)
    const minX = Math.min(...bounds.map(bounds => bounds.minX)), maxX = Math.max(...bounds.map(bounds => bounds.maxX))
    const minY = Math.min(...bounds.map(bounds => bounds.minY)), maxY = Math.max(...bounds.map(bounds => bounds.maxY))
    // Leave room above and below the estate for the floating map controls.
    const zoom = Math.min(MAX_ZOOM, Math.max(1, Math.min(WIDTH * .76 / Math.max(maxX - minX, 1), canvasHeight * .58 / Math.max(maxY - minY, 1))))
    update({ zoom, x: WIDTH / 2 - (minX + maxX) / 2 * zoom, y: canvasHeight * .52 - (minY + maxY) / 2 * zoom })
    initialEstateFocus.current = true; lastEstateFocusRequest.current = estateFocusRequest; lastEstateFocusHeight.current = canvasHeight
  }, [drawing, holdingIds, approximateHoldingIds, estateFocusRequest, canvasHeight, update])
  useEffect(() => {
    if (!focusId || !drawing) return
    const path = drawing.paths.find(item => item.item.id === focusId)
    if (!path?.centre) return
    const width = path.bounds.maxX - path.bounds.minX, height = path.bounds.maxY - path.bounds.minY
    const zoom = Math.min(MAX_ZOOM, Math.max(2, Math.min(WIDTH * .5 / Math.max(width, 1), canvasHeight * .5 / Math.max(height, 1))))
    const isPhone = (svgRef.current?.getBoundingClientRect().width || WIDTH) < 768
    const anchor = { x: isPhone ? WIDTH / 2 : WIDTH * .4, y: isPhone ? canvasHeight * .28 : canvasHeight / 2 }
    update({ zoom, x: anchor.x - path.centre[0] * zoom, y: anchor.y - path.centre[1] * zoom })
  }, [drawing, focusId])
  const zoomBy = useCallback((amount: number, anchor = { x: WIDTH / 2, y: canvasHeight / 2 }) => {
    const current = viewRef.current, zoom = Math.min(MAX_ZOOM, Math.max(1, current.zoom * amount)), ratio = zoom / current.zoom
    update({ zoom, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio })
  }, [canvasHeight, update])
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let gestureScale: number | null = null
    function wheel(event: WheelEvent) {
      // Trackpad pinches synthesize Control-wheel; ordinary scrolling stays available.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (gestureScale !== null || pointers.current.size > 1) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (svg!.getBoundingClientRect().height || canvasHeight) : 1
      const delta = event.deltaY * unit
      if (!Number.isFinite(delta) || delta === 0) return
      moved.current = true; suppressClick.current = true
      zoomBy(Math.exp(Math.max(-1, Math.min(1, -delta * .01))), position(svg!, event.clientX, event.clientY, canvasHeight))
    }
    function gestureStart(event: Event) {
      event.preventDefault()
      // Touchscreen pointers already implement pinch; do not zoom twice on iOS.
      if (pointers.current.size) { gestureScale = null; return }
      const { scale } = event as MapGestureEvent
      gestureScale = Number.isFinite(scale) && scale > 0 ? scale : 1
      moved.current = true; suppressClick.current = true
    }
    function gestureChange(event: Event) {
      event.preventDefault()
      if (gestureScale === null || pointers.current.size) return
      const { scale, clientX, clientY } = event as MapGestureEvent
      if (!Number.isFinite(scale) || scale <= 0) return
      const anchor = typeof clientX === 'number' && Number.isFinite(clientX) && typeof clientY === 'number' && Number.isFinite(clientY)
        ? position(svg!, clientX, clientY, canvasHeight) : { x: WIDTH / 2, y: canvasHeight / 2 }
      zoomBy(scale / gestureScale, anchor)
      gestureScale = scale
    }
    function gestureEnd(event: Event) { event.preventDefault(); gestureScale = null }
    // Native non-passive listeners can cancel browser page zoom over the map.
    svg.addEventListener('wheel', wheel, { passive: false })
    svg.addEventListener('gesturestart', gestureStart, { passive: false })
    svg.addEventListener('gesturechange', gestureChange, { passive: false })
    svg.addEventListener('gestureend', gestureEnd, { passive: false })
    return () => {
      svg.removeEventListener('wheel', wheel)
      svg.removeEventListener('gesturestart', gestureStart)
      svg.removeEventListener('gesturechange', gestureChange)
      svg.removeEventListener('gestureend', gestureEnd)
    }
  }, [canvasHeight, zoomBy])
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!pointers.current.size) { moved.current = false; suppressClick.current = false }
    const p = position(event.currentTarget, event.clientX, event.clientY, canvasHeight)
    const target = event.target instanceof Element ? event.target.closest('[data-estate-parcel]') : null
    pointers.current.set(event.pointerId, { ...p, clientX: event.clientX, clientY: event.clientY, startX: p.x, startY: p.y, startClientX: event.clientX, startClientY: event.clientY, parcelId: target?.getAttribute('data-estate-parcel') ?? null })
    if (pointers.current.size > 1) { moved.current = true; suppressClick.current = true }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const before = pointers.current.get(event.pointerId)
    if (!before) return
    const beforePair = [...pointers.current.values()].slice(0, 2), p = position(event.currentTarget, event.clientX, event.clientY, canvasHeight)
    pointers.current.set(event.pointerId, { ...before, ...p, clientX: event.clientX, clientY: event.clientY })
    const current = viewRef.current
    if (pointers.current.size > 1) {
      const pair = [...pointers.current.values()].slice(0, 2)
      const distance = (values: Pointer[]) => Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y), previousDistance = distance(beforePair)
      if (previousDistance < 1) return
      const middle = { x: (beforePair[0].x + beforePair[1].x) / 2, y: (beforePair[0].y + beforePair[1].y) / 2 }, next = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 }
      const zoom = Math.min(MAX_ZOOM, Math.max(1, current.zoom * distance(pair) / previousDistance)), ratio = zoom / current.zoom
      update({ zoom, x: next.x - (middle.x - current.x) * ratio, y: next.y - (middle.y - current.y) * ratio })
      return
    }
    const wasMoving = moved.current
    if (!wasMoving && Math.hypot(event.clientX - before.startClientX, event.clientY - before.startClientY) < DRAG_THRESHOLD) return
    moved.current = true; suppressClick.current = true
    update({ ...current, x: current.x + p.x - (wasMoving ? before.x : before.startX), y: current.y + p.y - (wasMoving ? before.y : before.startY) })
  }
  function end(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const pointer = pointers.current.get(event.pointerId)
    if (!pointer) return
    const travelled = Math.hypot(event.clientX - pointer.startClientX, event.clientY - pointer.startClientY) >= DRAG_THRESHOLD
    const select = !cancelled && !travelled && !moved.current && pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    suppressClick.current = true
    if (select && pointer.parcelId) onSelect(pointer.parcelId)
    if (!pointers.current.size) moved.current = false
  }
  const selected = drawing?.paths.find(path => path.item.id === selectedId)
  const visible = useMemo(() => drawing?.paths.filter(path => path.item.level === 'whole_survey' || showSubdivisions || path.item.id === selectedId || holdingIds.has(path.item.id))
    .sort((a, b) => Number(a.item.level === 'hissa') - Number(b.item.level === 'hissa') || Number(holdingIds.has(a.item.id)) - Number(holdingIds.has(b.item.id))) ?? [], [drawing, showSubdivisions, selectedId, holdingIds])
  // The hundreds of outlines and labels retain their React nodes while panning.
  const outlines = useMemo(() => visible.map(({ item, d }) => <path key={item.id} d={d} fillRule="evenodd" vectorEffect="non-scaling-stroke" data-estate-parcel={item.id} className={`oe-parcel oe-village-${item.village.id}${item.level === 'hissa' ? ' oe-hissa' : ''}${approximateHoldingIds?.has(item.id) ? ' oe-approximate-parcel' : ''}${holdingIds.has(item.id) && !approximateHoldingIds?.has(item.id) ? ' oe-holding' : ''}${selectedId === item.id ? ' oe-selected' : ''}`} onClick={() => { if (!suppressClick.current) onSelect(item.id) }}><title>{selectedId === item.id ? `${item.village.name} · Survey ${item.parcel.survey}${item.parcel.hissa ? ` / Hissa ${item.parcel.hissa}` : ''}` : `${item.village.name} · Select for parcel details`}</title></path>), [visible, holdingIds, approximateHoldingIds, selectedId, onSelect])
  return <>
    <svg ref={svgRef} className="oe-map-canvas" viewBox={`0 0 ${WIDTH} ${canvasHeight}`} role="img" aria-label="Hebbasale and Devihalli official survey map" style={{ touchAction: 'none', userSelect: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
      <defs><pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#dce4d7" strokeWidth=".6" /></pattern></defs>
      <rect width={WIDTH} height={canvasHeight} fill={`url(#${gridId})`} />
      <g data-estate-map-view transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {tiles.map(tile => <foreignObject key={tile.id} x={tile.x} y={tile.y} width={tile.size + .05} height={tile.size + .05} className="oe-street-tile"><img src={tile.src} alt="" aria-hidden="true" draggable={false} referrerPolicy="strict-origin-when-cross-origin" onError={event => { event.currentTarget.style.opacity = '0'; setTileError(true) }} /></foreignObject>)}
        {outlines}
        {view.zoom < 3 && drawing?.villageLabels.map(({ village, x, y }) => <text className="oe-village-label" key={village.id} x={x} y={y} textAnchor="middle" fontSize={18 * screenScale / view.zoom}>{village.name}</text>)}
        {drawing?.paths.filter(path => holdingIds.has(path.item.id) && path.centre).map(({ item, centre }) => <g key={`marker-${item.id}`} className={`oe-holder-marker${approximateHoldingIds?.has(item.id) ? ' oe-approximate-marker' : ''}`} transform={`translate(${centre![0]} ${centre![1]}) scale(${screenScale / view.zoom})`} data-estate-parcel={item.id} onClick={() => { if (!suppressClick.current) onSelect(item.id) }}><circle r="11" /><path d="M-4 0 L-1 3 L5-4" /><title>Our estate · Select for RTC details{approximateHoldingIds?.has(item.id) ? ' · Approximate location; Hissa outline unavailable' : ''}</title></g>)}
        {selected?.centre && <g className="oe-selection-pin" transform={`translate(${selected.centre[0]} ${selected.centre[1]}) scale(${screenScale / view.zoom})`}><circle r="17" /><circle r="5" /><text className="oe-selected-label" y="-26" textAnchor="middle">{selected.item.parcel.survey}{selected.item.parcel.hissa ? ` / ${selected.item.parcel.hissa}` : ''}</text></g>}
      </g>
    </svg>
    <div className="oe-map-controls" aria-label="Map controls"><button type="button" aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomBy(1.5)}><Plus size={19} /></button><button type="button" aria-label="Zoom out" disabled={view.zoom <= 1} onClick={() => zoomBy(1 / 1.5)}><Minus size={19} /></button><button type="button" aria-label="Fit village map" onClick={reset}><LocateFixed size={19} /></button></div>
    <span className="oe-map-compass" aria-label="North">N<span>↑</span></span>
    {tileError && <p className="oe-tile-error" role="status">Street background unavailable. Survey outlines are still available.</p>}
  </>
}
