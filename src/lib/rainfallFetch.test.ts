import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRainfallData } from './rainfall'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const reply = (dates: string[], amounts: (number | null)[]) => new Response(JSON.stringify({ daily: { time: dates, precipitation_sum: amounts } }), { headers: { 'Content-Type': 'application/json' } })
describe('rainfall fetch integrity', () => {
  it('omits missing and invalid measurements without turning them into dry days', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2026-01-01'], [0, null, -1, 12.5, 99]))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchRainfallData(12, 75, 2025, 2025)).toEqual([{ date: '2025-01-01', precipitationMm: 0 }, { date: '2025-01-04', precipitationMm: 12.5 }])
  })
  it('rejects a failed or empty archive rather than claiming a dry historical period', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('error', { status: 503 })).mockResolvedValueOnce(reply([], []))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchRainfallData(13, 75, 2025, 2025)).rejects.toThrow('historical rainfall')
    await expect(fetchRainfallData(14, 75, 2025, 2025)).rejects.toThrow('historical rainfall')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps forecast estimates out of historical totals and refreshes archive data after cache expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T18:35:00Z'))
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(url.includes('archive-api') ? reply(['2026-10-04'], [10]) : reply(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'], [99, 2, 3, 100])))
    vi.stubGlobal('fetch', fetch)
    const records = await fetchRainfallData(15, 75, 2026, 2026)
    expect(records.map(record => record.precipitationMm)).toEqual([10])
    await fetchRainfallData(15, 75, 2026, 2026)
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-10-05T18:41:00Z'))
    await fetchRainfallData(15, 75, 2026, 2026)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([url])=>String(url).includes('archive-api'))).toBe(true)
  })
  it('rejects empty coordinates and future-only ranges before requesting weather', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(fetchRainfallData(NaN, 75, 2025, 2025)).rejects.toThrow('valid coordinates')
    await expect(fetchRainfallData(12, 75, 2200, 2200)).rejects.toThrow('future')
    expect(fetch).not.toHaveBeenCalled()
  })
})
