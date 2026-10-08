// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OurEstate } from './OurEstate'
import { EstateMapCanvas, type EstateMapParcel } from './EstateMapCanvas'
import type { SurveyParcel } from '../lib/farmSurveyMap'
import type { RtcLookupRequest, RtcRecord } from '../lib/farmRtcClient'
import { SURVEY_VILLAGES } from '../lib/farmSurveyMap'

const api = vi.hoisted(() => ({ whole: vi.fn(), hissa: vi.fn(), clear: vi.fn(), details: vi.fn(), record: null as RtcRecord | null }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/farmSurveyMap', async importOriginal => ({ ...await importOriginal<typeof import('../lib/farmSurveyMap')>(), loadSurveyParcels: api.whole, loadVillageHissaParcels: api.hissa, clearSurveyMapCache: api.clear }))
vi.mock('./FarmParcelDetails', async () => {
  const { useEffect } = await import('react')
  return { FarmParcelDetails: ({ parcel, village, initialRecord, onRecord }: { parcel: SurveyParcel; village: { name: string }; initialRecord?: RtcLookupRequest; onRecord?: (record: RtcRecord | null) => void }) => {
    api.details({ parcel, village, initialRecord })
    useEffect(() => { if (api.record) onRecord?.(api.record) }, [onRecord])
    return <section aria-label="Selected parcel details">{village.name} · {parcel.survey} · {parcel.hissa ?? 'whole'} · RTC details</section>
  } }
})
const whole: SurveyParcel = { key: '12::', survey: '12', surnoc: null, hissa: null, polygons: [[[[75, 13], [75.01, 13], [75.01, 13.01], [75, 13.01], [75, 13]]]] }
const hissa: SurveyParcel = { ...whole, key: '12:*:1A', surnoc: '*', hissa: '1A' }
const devi: SurveyParcel = { ...whole, key: '45::', survey: '45', polygons: [[[[75.02, 13], [75.03, 13], [75.03, 13.01], [75.02, 13.01], [75.02, 13]]]] }
const result = (parcels: SurveyParcel[]) => ({ parcels, sourceUrl: 'https://kgis.ksrsac.in/test/query', retrievedAt: '2026-10-08T03:00:00Z' })
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'touch' }
}
beforeEach(() => {
  vi.clearAllMocks(); api.record = null; vi.stubGlobal('PointerEvent', TestPointerEvent)
  api.whole.mockImplementation(async village => result(village.id === 'hebbasale' ? [whole] : [devi]))
  api.hissa.mockImplementation(async village => result(village.id === 'hebbasale' ? [hissa] : []))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = '' })
async function mapsReady() { await waitFor(() => expect(document.querySelector('[data-estate-parcel="2301110012:whole_survey:12::"]')).toBeTruthy()) }

describe('Our Estate map', () => {
  it('keeps the page fixed, reveals acreage only on click and restores scrolling on exit', async () => {
    document.body.style.overflow = 'auto'
    const user = userEvent.setup(), exit = vi.fn(), menu = vi.fn()
    const { unmount } = render(<OurEstate userId="synthetic-user" targetName="Synthetic holder" ownershipTotalAcres={4.25} ownershipRecordCount={2} onExit={exit} onOpenMenu={menu} />)
    await mapsReady()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.queryByLabelText('Matching holder recorded acreage')).toBeNull()
    expect(screen.queryByText(/4.25/)).toBeNull()
    expect(screen.queryByText(/2 RTC entries/)).toBeNull()
    expect(document.querySelector('.oe-map-footer')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Synthetic holder/ }))
    expect(screen.getByLabelText('Matching holder recorded acreage').textContent).toContain('4.25 acres')
    await user.click(screen.getByRole('button', { name: /Synthetic holder/ }))
    expect(screen.queryByLabelText('Matching holder recorded acreage')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open estate navigation' }))
    expect(menu).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Back to estate dashboard' }))
    expect(exit).toHaveBeenCalledOnce()
    unmount(); expect(document.body.style.overflow).toBe('auto')
  })
  it('colours only the exact owned Hissa and shows estate acreage when that Hissa is selected', async () => {
    const user = userEvent.setup()
    render(<OurEstate userId="synthetic-user" targetName="Synthetic holder" ownershipTotalAcres={4.25} ownershipMatches={[{ villageCode: '2301110012', surveyNumber: '12', surnoc: '*', hissaNumber: '1A' }]} />)
    await mapsReady()
    const hissaPath = document.querySelector('[data-estate-parcel="2301110012:hissa:12:*:1A"]')!
    expect(hissaPath.classList.contains('oe-holding')).toBe(true)
    expect(document.querySelector('[data-estate-parcel="2301110012:whole_survey:12::"]')!.classList.contains('oe-holding')).toBe(false)
    expect(document.querySelector('.oe-selected-label')).toBeNull()
    expect(document.querySelector('.oe-survey-label')).toBeNull()
    expect(screen.queryByLabelText('Estate recorded acreage')).toBeNull()
    fireEvent.click(hissaPath)
    expect(screen.getByLabelText('Estate recorded acreage').textContent).toContain('4.25 acres')
    expect(document.querySelector('.oe-selected-label')?.textContent).toBe('12 / 1A')
    await user.click(screen.getByRole('button', { name: 'Focus my estate' }))
    expect(screen.queryByRole('complementary', { name: 'Selected estate parcel' })).toBeNull()
    expect(document.querySelector('.oe-selected-label')).toBeNull()
  })
  it('opens the known matching RTC from an approximate marker without colouring its whole survey', async () => {
    const identity = { villageCode: '2301110038', surveyNumber: '45', surnoc: '*', hissaNumber: '9' }
    render(<OurEstate userId="synthetic-user" targetName="Synthetic holder" ownershipMatches={[identity]} />)
    await mapsReady()
    fireEvent.click(document.querySelector('.oe-approximate-marker')!)
    expect(api.details).toHaveBeenLastCalledWith(expect.objectContaining({ initialRecord: identity }))
    expect(document.querySelector('[data-estate-parcel="2301110038:whole_survey:45::"]')!.classList.contains('oe-holding')).toBe(false)
    expect(document.querySelector('[data-estate-parcel="2301110038:whole_survey:45::"]')!.classList.contains('oe-approximate-parcel')).toBe(true)
  })
  it('shows additional exact recorded names beneath the existing main holder', async () => {
    const user = userEvent.setup()
    render(<OurEstate userId="synthetic-user" targetName="Synthetic primary holder" holderAliases={['Synthetic additional recorded name']} />)
    await mapsReady()
    await user.click(screen.getByRole('button', { name: /Synthetic primary holder/ }))
    expect(screen.getByLabelText('Additional recorded names').textContent).toContain('Synthetic additional recorded name')
    expect(screen.getByRole('button', { name: /Synthetic primary holder/ }).textContent).not.toContain('Synthetic additional recorded name')
  })
  it('loads both village and subdivision snapshots together with visible map attribution', async () => {
    render(<OurEstate userId="synthetic-user" />)
    await mapsReady()
    expect(api.whole).toHaveBeenCalledTimes(2); expect(api.hissa).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Both villages' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: '© OpenStreetMap contributors' }).getAttribute('href')).toBe('https://www.openstreetmap.org/copyright')
    expect(screen.getByRole('link', { name: 'Survey data: KGIS / KSRSAC' })).toBeTruthy()
    const tiles = document.querySelectorAll<HTMLImageElement>('.oe-street-tile img')
    expect(tiles.length).toBeGreaterThan(0); expect(tiles.length).toBeLessThan(100)
    for (const tile of tiles) {
      expect(tile.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/)
      expect(tile.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    }
  })
  it('searches an alphanumeric Hissa and reuses the selected parcel detail panel', async () => {
    const user = userEvent.setup(); render(<OurEstate userId="synthetic-user" />)
    await mapsReady()
    await user.type(screen.getByRole('searchbox', { name: 'Search survey or subdivision' }), '12 / 1A')
    await user.click(screen.getByRole('button', { name: /Survey 12 \/ 1A/ }))
    expect(screen.getByRole('region', { name: 'Selected parcel details' }).textContent).toContain('Hebbasale · 12 · 1A')
    expect((screen.getByLabelText('Selected map subdivision') as HTMLSelectElement).value).toBe('2301110012:hissa:12:*:1A')
    expect(screen.getByRole('button', { name: 'Hissa outlines' }).getAttribute('aria-pressed')).toBe('true')
    const google = screen.getByRole('link', { name: 'Open Google Maps' })
    expect(google.getAttribute('href')).toMatch(/^https:\/\/www.google.com\/maps\/search\/\?api=1&query=/)
  })
  it('filters the map and search to one village and clears a hidden selection', async () => {
    const user = userEvent.setup(); render(<OurEstate userId="synthetic-user" />)
    await mapsReady()
    await user.type(screen.getByRole('searchbox'), '45')
    await user.click(screen.getByRole('button', { name: /Survey 45/ }))
    expect(screen.getByRole('complementary', { name: 'Selected estate parcel' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Hebbasale' }))
    expect(screen.queryByRole('complementary', { name: 'Selected estate parcel' })).toBeNull()
    await user.type(screen.getByRole('searchbox'), '45')
    expect(screen.getByText('No matching mapped parcels.')).toBeTruthy()
  })
  it('keeps available layers after a partial failure and offers a fresh retry', async () => {
    api.hissa.mockRejectedValue(new Error('Synthetic layer outage'))
    const user = userEvent.setup(); render(<OurEstate userId="synthetic-user" />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Some saved map layers'))
    expect(document.querySelector('[data-estate-parcel="2301110038:whole_survey:45::"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry map loading' }))
    expect(api.clear).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(api.whole).toHaveBeenCalledTimes(4))
  })
  it('shows only supplied holder matches and identifies whole-survey fallback placement', async () => {
    const user = userEvent.setup()
    render(<OurEstate userId="synthetic-user" targetName="Synthetic holder" ownershipMatches={[{ villageCode: '2301110012', surveyNumber: '12', surnoc: '*', hissaNumber: '1A' }, { villageCode: '2301110038', surveyNumber: '45', surnoc: '*', hissaNumber: '9' }]} />)
    await mapsReady()
    await user.click(screen.getByRole('button', { name: /Synthetic holder/ }))
    expect(screen.getByText('Placed on whole survey · Hissa outline unavailable')).toBeTruthy()
    expect(document.querySelectorAll('.oe-holder-marker')).toHaveLength(2)
    expect(document.querySelector('[data-estate-parcel="2301110038:whole_survey:45::"]')?.classList.contains('oe-holding')).toBe(false)
    expect(document.querySelectorAll('.oe-approximate-marker')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /Hebbasale · 12 \/ 1A/ }))
    expect(screen.getByText(/Recorded holder match for Synthetic holder/)).toBeTruthy()
  })
  it('opens the immersive fallback and exits with Escape', async () => {
    const user = userEvent.setup(); render(<OurEstate userId="synthetic-user" />)
    await mapsReady()
    await user.click(screen.getByRole('button', { name: 'Open fullscreen map' }))
    expect(document.querySelector('.oe-fullscreen')).toBeTruthy(); expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.oe-fullscreen')).toBeNull())
    expect(document.body.style.overflow).toBe('hidden')
  })
  it('shows recorded matching holder shares without treating them as whole-survey map area', async () => {
    const user = userEvent.setup()
    render(<OurEstate userId="synthetic-user" targetName="Synthetic holder" ownershipTotalAcres={4.25} ownershipRecordCount={2} ownershipStatus="Only the currently checked records are included." />)
    await mapsReady()
    await user.click(screen.getByRole('button', { name: /Synthetic holder/ }))
    const total = screen.getByLabelText('Matching holder recorded acreage')
    expect(total.textContent).toContain('4.25 acres')
    expect(total.textContent).toContain('2 RTC entries')
    expect(total.textContent).toContain('separate from whole-survey outline area')
    expect(screen.getByText('Only the currently checked records are included.')).toBeTruthy()
  })
  it('lets an unconfigured account select only a holder supplied by the selected live RTC', async () => {
    const extent = { acres: '1', guntas: '0', fractionalGuntas: '0' }
    const record: RtcRecord = { identity: { villageCode: '2301110012', surveyNumber: '12', surnoc: '*', hissaNumber: '1A' }, villageName: 'Hebbasale', landCode: 'synthetic-land', ulpin: null, extent, sourceUrl: 'https://rdservices.karnataka.gov.in/BhoomiMaps/', retrievedAt: '2026-10-08T03:00:00Z', owners: [{ name: 'Synthetic recorded holder', fatherName: null, ownerNumber: '1', mainOwnerNumber: '1', category: null, governmentRestriction: null, governmentRestrictionOwnerCategory: null, courtStay: null, extent }] }
    api.record = record
    const user = userEvent.setup(), choose = vi.fn().mockResolvedValue(undefined), loaded = vi.fn()
    render(<OurEstate userId="synthetic-user" onChooseHolder={choose} onRtcRecord={loaded} />)
    expect(screen.getByText(/Select a survey, then choose your recorded holder/)).toBeTruthy()
    await mapsReady()
    await user.type(screen.getByRole('searchbox'), '12/1A')
    await user.click(screen.getByRole('button', { name: /Survey 12 \/ 1A/ }))
    await user.selectOptions(await screen.findByLabelText('Estate holder name'), 'Synthetic recorded holder')
    await user.click(screen.getByRole('button', { name: 'Use this holder for my estate' }))
    expect(choose).toHaveBeenCalledWith(record, 'Synthetic recorded holder')
    expect(loaded).toHaveBeenCalledWith(record)
  })
  it('aborts pending map requests on account change instead of exposing stale selected data', async () => {
    let oldSignal: AbortSignal | undefined, finish: (value: ReturnType<typeof result>) => void = () => {}
    api.whole.mockImplementationOnce((_village, signal) => { oldSignal = signal; return new Promise(resolve => { finish = resolve }) })
    const { rerender } = render(<OurEstate userId="first-account" />)
    rerender(<OurEstate userId="second-account" />)
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => finish(result([{ ...whole, key: '99::', survey: '99' }])))
    await mapsReady()
    expect(document.querySelector('[data-estate-parcel="2301110012:whole_survey:99::"]')).toBeNull()
  })
})

describe('estate map gestures', () => {
  const item: EstateMapParcel = { id: 'synthetic-parcel', village: SURVEY_VILLAGES[0], parcel: whole, level: 'whole_survey', sourceUrl: 'https://kgis.ksrsac.in/test', retrievedAt: '2026-10-08T03:00:00Z' }
  function mapView() {
    const transform = document.querySelector('[data-estate-map-view]')!.getAttribute('transform')!
    return /translate\((\S+) (\S+)\) scale\((\S+)\)/.exec(transform)!.slice(1).map(Number)
  }
  function gesture(svg: Element, type: string, scale: number, clientX = 400, clientY = 300) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { scale, clientX, clientY })
    fireEvent(svg, event)
    return event
  }
  it('focuses late-arriving owned parcels once and lets a later request refit all holdings', () => {
    const far: EstateMapParcel = { ...item, id: 'distant-parcel', parcel: { ...devi, polygons: [[[[75.1, 13], [75.11, 13], [75.11, 13.01], [75.1, 13.01], [75.1, 13]]]] } }
    const items = [item, far], props = { items, selectedId: null, showSubdivisions: false, focusId: null, onSelect: vi.fn() }
    const { rerender } = render(<EstateMapCanvas {...props} holdingIds={new Set()} />)
    expect(mapView()[2]).toBe(1)
    rerender(<EstateMapCanvas {...props} holdingIds={new Set([item.id])} />)
    expect(mapView()[2]).toBeGreaterThan(2)
    fireEvent.wheel(screen.getByRole('img'), { ctrlKey: true, deltaY: -20, clientX: 500, clientY: 350 })
    const movedView = mapView()
    rerender(<EstateMapCanvas {...props} holdingIds={new Set([item.id, far.id])} />)
    expect(mapView()).toEqual(movedView)
    rerender(<EstateMapCanvas {...props} holdingIds={new Set([item.id, far.id])} estateFocusRequest={1} />)
    expect(mapView()[2]).toBeLessThan(movedView[2])
  })
  it('refits the estate for a portrait viewport and keeps markers at a readable screen size', () => {
    let resized: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback }
      observe() {}
      disconnect() {}
    })
    const far: EstateMapParcel = { ...item, id: 'distant-parcel', parcel: { ...devi, polygons: [[[[75.1, 13], [75.11, 13], [75.11, 13.01], [75.1, 13.01], [75.1, 13]]]] } }
    render(<EstateMapCanvas items={[item, far]} selectedId={null} holdingIds={new Set([item.id])} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const desktopZoom = mapView()[2]
    act(() => resized([{ contentRect: { width: 390, height: 844 } }] as ResizeObserverEntry[], {} as ResizeObserver))
    expect(mapView()[2]).toBeGreaterThan(desktopZoom)
    const markerTransform = document.querySelector('.oe-holder-marker')!.getAttribute('transform')!
    const markerScale = Number(/scale\(([^)]+)\)/.exec(markerTransform)![1])
    expect(markerScale * mapView()[2] * .39).toBeCloseTo(1)
    expect(document.querySelector('.oe-map-canvas')!.getAttribute('viewBox')).toBe(`0 0 1000 ${1000 * 844 / 390}`)
  })
  it.each(['ctrlKey', 'metaKey'] as const)('zooms laptop pinch/scroll around the cursor with %s and cancels page zoom', modifier => {
    const select = vi.fn()
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={select} />)
    const svg = screen.getByRole('img'), path = document.querySelector('[data-estate-parcel]')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, right: 600, bottom: 400, width: 500, height: 350, x: 100, y: 50, toJSON: () => ({}) })
    const init = { bubbles: true, cancelable: true, [modifier]: true, clientX: 300, clientY: 200 }
    const zoomIn = new WheelEvent('wheel', { ...init, deltaY: -Math.log(2) * 100 })
    fireEvent(svg, zoomIn)
    expect(zoomIn.defaultPrevented).toBe(true)
    const [x, y, zoom] = mapView()
    expect(zoom).toBeCloseTo(2); expect(x).toBeCloseTo(-400); expect(y).toBeCloseTo(-300)
    fireEvent.click(path); expect(select).not.toHaveBeenCalled()
    const zoomOut = new WheelEvent('wheel', { ...init, deltaY: Math.log(2) * 100 })
    fireEvent(svg, zoomOut)
    expect(zoomOut.defaultPrevented).toBe(true)
    expect(mapView()).toEqual([0, 0, 1])
  })
  it('leaves ordinary laptop scrolling available and ignores zero zoom deltas', () => {
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const svg = screen.getByRole('img'), scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    fireEvent(svg, scroll)
    expect(scroll.defaultPrevented).toBe(false)
    fireEvent.wheel(svg, { ctrlKey: true, deltaY: 0 })
    expect(mapView()).toEqual([0, 0, 1])
  })
  it('uses cumulative Safari trackpad scale for zooming in and out without duplicate wheel zoom', () => {
    const select = vi.fn()
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={select} />)
    const svg = screen.getByRole('img'), path = document.querySelector('[data-estate-parcel]')!
    expect(gesture(svg, 'gesturestart', 1).defaultPrevented).toBe(true)
    expect(gesture(svg, 'gesturechange', 1.5).defaultPrevented).toBe(true)
    gesture(svg, 'gesturechange', 2)
    expect(mapView()).toEqual([-400, -300, 2])
    fireEvent.wheel(svg, { ctrlKey: true, deltaY: -Math.log(2) * 100 })
    expect(mapView()).toEqual([-400, -300, 2])
    expect(gesture(svg, 'gestureend', 2).defaultPrevented).toBe(true)
    gesture(svg, 'gesturestart', 1); gesture(svg, 'gesturechange', .5); gesture(svg, 'gestureend', .5)
    expect(mapView()).toEqual([0, 0, 1])
    fireEvent.click(path); expect(select).not.toHaveBeenCalled()
    fireEvent.pointerDown(path, { pointerId: 3, pointerType: 'mouse', clientX: 400, clientY: 300 })
    fireEvent.pointerUp(path, { pointerId: 3, pointerType: 'mouse', clientX: 400, clientY: 300 })
    expect(select).toHaveBeenCalledOnce()
  })
  it('does not apply Safari gesture scale on top of a touchscreen pinch', () => {
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const svg = screen.getByRole('img')
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 300, clientY: 350 })
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 700, clientY: 350 })
    gesture(svg, 'gesturestart', 1); gesture(svg, 'gesturechange', 1.5)
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 900, clientY: 350 })
    expect(mapView()).toEqual([-150, -175, 1.5])
  })
  it('keeps Safari trackpad zoom within map limits and ignores invalid scale', () => {
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const svg = screen.getByRole('img')
    gesture(svg, 'gesturestart', 1); gesture(svg, 'gesturechange', 100)
    expect(mapView()[2]).toBe(32)
    gesture(svg, 'gesturechange', NaN); gesture(svg, 'gesturechange', 0)
    expect(mapView().every(Number.isFinite)).toBe(true)
    expect(mapView()[2]).toBe(32)
    gesture(svg, 'gesturechange', .01); gesture(svg, 'gestureend', .01)
    expect(mapView()).toEqual([0, 0, 1])
  })
  it('removes native laptop gesture handlers when the map closes', () => {
    const { unmount } = render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const svg = screen.getByRole('img')
    unmount()
    const wheel = new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -100 })
    fireEvent(svg, wheel)
    expect(wheel.defaultPrevented).toBe(false)
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) expect(gesture(svg, type, 2).defaultPrevented).toBe(false)
  })
  it('pinches around the midpoint and suppresses selection after a gesture', () => {
    const select = vi.fn(); render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={select} />)
    const svg = screen.getByRole('img'), path = document.querySelector('[data-estate-parcel]')!
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 300, clientY: 350 })
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 700, clientY: 350 })
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 900, clientY: 350 })
    expect(document.querySelector('[data-estate-map-view]')?.getAttribute('transform')).toBe('translate(-150 -175) scale(1.5)')
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 300, clientY: 350 })
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 900, clientY: 350 })
    fireEvent.click(path); expect(select).not.toHaveBeenCalled()
  })
  it('supports a fresh tap and ignores a cancelled pointer', () => {
    const select = vi.fn(); render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={select} />)
    const path = document.querySelector('[data-estate-parcel]')!
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerCancel(path, { pointerId: 1, clientX: 400, clientY: 300 })
    expect(select).not.toHaveBeenCalled()
    fireEvent.pointerDown(path, { pointerId: 2, clientX: 400, clientY: 300 })
    fireEvent.pointerUp(path, { pointerId: 2, clientX: 400, clientY: 300 })
    expect(select).toHaveBeenCalledWith('synthetic-parcel')
  })
  it('retains selectable survey outlines when street tiles fail', () => {
    render(<EstateMapCanvas items={[item]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    fireEvent.error(document.querySelector('.oe-street-tile img')!)
    expect(screen.getByRole('status').textContent).toContain('Street background unavailable')
    expect(document.querySelector('[data-estate-parcel]')).toBeTruthy()
  })
  it('aligns a cadastral longitude and latitude with the same Web Mercator street tile coordinates', () => {
    render(<EstateMapCanvas items={[item, { ...item, id: 'devihalli-parcel', village: SURVEY_VILLAGES[1], parcel: devi }]} selectedId={null} holdingIds={new Set()} showSubdivisions={false} focusId={null} onSelect={vi.fn()} />)
    const tile = document.querySelector<SVGForeignObjectElement>('.oe-street-tile')!
    const image = tile.querySelector('img')!
    const [, z, tileX, tileY] = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(image.src)!.map(Number)
    const worldTiles = 2 ** z, tileSize = Number(tile.getAttribute('width')) - .05
    function check(id: string, longitude: number, latitude: number) {
      const path = document.querySelector(`[data-estate-parcel="${id}"]`)!
      const [, pathX, pathY] = /^M([\d.-]+),([\d.-]+)/.exec(path.getAttribute('d')!)!.map(Number)
      const x = (longitude + 180) / 360, sin = Math.sin(latitude * Math.PI / 180)
      const y = .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
      expect(pathX).toBeCloseTo(Number(tile.getAttribute('x')) + (x * worldTiles - tileX) * tileSize, 1)
      expect(pathY).toBeCloseTo(Number(tile.getAttribute('y')) + (y * worldTiles - tileY) * tileSize, 1)
    }
    check('synthetic-parcel', 75, 13); check('devihalli-parcel', 75.02, 13)
    expect(document.querySelector('[data-estate-parcel="synthetic-parcel"]')?.classList.contains('oe-village-hebbasale')).toBe(true)
    expect(document.querySelector('[data-estate-parcel="devihalli-parcel"]')?.classList.contains('oe-village-devihalli')).toBe(true)
  })
})
