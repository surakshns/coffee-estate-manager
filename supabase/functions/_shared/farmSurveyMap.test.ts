import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSurveyMap, hissaQuery, parseSurveyParcels, refreshSurveyMaps, surveyQuery, SURVEY_VILLAGES, type FarmSurveyMapLayer, type Position, type SurveyMapCacheRow, type SurveyMapCacheStore } from './farmSurveyMap.ts'

const at = '2026-10-07T12:00:00.000Z', now = () => new Date(at), village = SURVEY_VILLAGES[0]
const ring: Position[] = [[75, 13], [75.01, 13], [75.01, 13.01], [75, 13.01], [75, 13]]
function feature(v = village as typeof SURVEY_VILLAGES[number], patch: Record<string, unknown> = {}, coords = ring) {
  return { type: 'Feature', properties: { KGISVillageCode: v.bhoomi, LGD_VillageCode: v.lgd, surveynumberi: 12, Surnoc: '*', HissaNo: null, ...patch }, geometry: { type: 'Polygon', coordinates: [coords] } }
}
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
function responseFor(url: string) {
  const params = new URL(url).searchParams
  const v = SURVEY_VILLAGES.find(item => params.get('where') === `LGD_VillageCode=${item.lgd}`)!
  const hissa = url.includes('HissaData/')
  return new Response(JSON.stringify(collection([feature(v, hissa ? { HissaNo: '1', HissaCategory: 'Valid-Matching to Bhoomi Records' } : {})])))
}
afterEach(() => vi.useRealTimers())

describe('public survey map cache refresh', () => {
  it('uses four fixed village/layer queries and excludes owner/document fields', async () => {
    const store: SurveyMapCacheStore = { get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) }
    const fetcher = vi.fn().mockImplementation(async (url: string) => responseFor(url))
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 4, skipped: 0, failed: 0 })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(SURVEY_VILLAGES.flatMap(v => [surveyQuery(v), hissaQuery(v)]))
    for (const [url, options] of fetcher.mock.calls) {
      const fields = new URL(url).searchParams.get('outFields')!
      expect(fields).not.toMatch(/owner|document|\*/i)
      expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' })
    }
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ village_code: village.bhoomi, source_url: surveyQuery(village), retrieved_at: at }))
    expect(() => surveyQuery({ ...village, bhoomi: 'wrong' } as unknown as typeof village)).toThrow('supported village')
    expect(() => surveyQuery(village, '1 OR 1=1')).toThrow('Invalid survey')
    expect(() => surveyQuery(village, '0')).toThrow('Invalid survey')
  })

  it('groups multipart identities, removes surplus properties and keeps only matching numbered Hissa', async () => {
    const valid = feature(village, { HissaNo: '2', HissaCategory: 'Valid-Matching to Bhoomi Records\n', OwnerName: 'Excluded', PrivateDocument: 'Excluded' })
    const body = collection([valid, valid, feature(village, { HissaNo: '3', HissaCategory: 'Valid-Kharab Lands' }), feature(village, { HissaNo: '0', HissaCategory: 'Valid-Matching to Bhoomi Records' })])
    const row = await fetchSurveyMap(village, 'hissa', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))), now)
    expect(row.geojson.features).toHaveLength(1)
    expect(row.geojson.features[0].geometry.coordinates).toHaveLength(2)
    expect(row.geojson.features[0].properties).toEqual({ KGISVillageCode: village.bhoomi, LGD_VillageCode: village.lgd, surveynumberi: 12, Surnoc: '*', HissaNo: '2', HissaCategory: 'Valid-Matching to Bhoomi Records' })
    expect(parseSurveyParcels(row.geojson, village, true)[0].polygons).toHaveLength(2)
    expect(JSON.stringify(row)).not.toContain('Excluded')
    expect(row.source_url).toBe(hissaQuery(village))
  })

  it('skips fresh snapshots without fetching and refreshes expired or future-dated snapshots', async () => {
    const get = vi.fn().mockResolvedValue({ retrieved_at: '2026-10-07T01:00:00.000Z' })
    const store: SurveyMapCacheStore = { get, save: vi.fn().mockResolvedValue(undefined) }
    const fetcher = vi.fn().mockImplementation(async (url: string) => responseFor(url))
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 0, skipped: 4, failed: 0 })
    expect(fetcher).not.toHaveBeenCalled()
    get.mockResolvedValue({ retrieved_at: '2026-10-06T12:00:00.000Z' })
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 4, skipped: 0, failed: 0 })
    get.mockResolvedValue({ retrieved_at: '2026-10-08T12:00:00.000Z' })
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 4, skipped: 0, failed: 0 })
  })

  it('retains the previous data and retrieval date on failure while updating other maps', async () => {
    const previous = { retrieved_at: '2026-10-05T12:00:00.000Z' }
    const saved: SurveyMapCacheRow[] = []
    const store: SurveyMapCacheStore = { get: vi.fn().mockResolvedValue(previous), save: vi.fn().mockImplementation(async row => { saved.push(row) }) }
    const fetcher = vi.fn().mockImplementation(async (url: string) => url === surveyQuery(village) ? new Response('', { status: 503 }) : responseFor(url))
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 3, skipped: 0, failed: 1 })
    expect(saved.some(row => row.village_code === village.bhoomi && row.layer === 'whole_survey')).toBe(false)
    expect(previous.retrieved_at).toBe('2026-10-05T12:00:00.000Z')
    expect(saved.every(row => row.retrieved_at === at)).toBe(true)
  })

  it.each([
    collection([feature(village, { KGISVillageCode: 'foreign' })]),
    { ...collection([feature()]), exceededTransferLimit: true },
    collection([feature(village, {}, ring.slice(0, 4))]),
    collection([feature(village, {}, [[400000, 1400000], [1, 2], [1, 3], [400000, 1400000]])]),
    collection([]),
    { type: 'FeatureCollection', features: Array.from({ length: 1000 }, () => feature()) },
  ])('does not persist malformed, incomplete, foreign or empty geometry', async body => {
    const store: SurveyMapCacheStore = { get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))
    expect(await refreshSurveyMaps(store, { fetcher, now })).toEqual({ refreshed: 0, skipped: 0, failed: 4 })
    expect(store.save).not.toHaveBeenCalled()
  })

  it('rejects oversized headers and actual bodies instead of trusting content length', async () => {
    await expect(fetchSurveyMap(village, 'whole_survey', vi.fn().mockResolvedValue(new Response('x', { headers: { 'content-length': '5000001' } })), now)).rejects.toThrow('too large')
    await expect(fetchSurveyMap(village, 'whole_survey', vi.fn().mockResolvedValue(new Response(new Uint8Array(5000001))), now)).rejects.toThrow('too large')
    await expect(fetchSurveyMap(village, 'other' as FarmSurveyMapLayer, vi.fn(), now)).rejects.toThrow('Invalid map layer')
  })

  it('aborts slow official requests after 30 seconds', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    const pending = expect(fetchSurveyMap(village, 'whole_survey', fetcher, now)).rejects.toThrow('Aborted')
    await vi.advanceTimersByTimeAsync(30000)
    await pending
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
