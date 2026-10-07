import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestMarketPrices, nextStep, priceIsStale, priceValue, visibleFarmUpdate } from './farmPresentation'
import { emptyFarmProfile, type MarketPrice, type OfficialUpdate } from './farmIntelligence'

const price = (patch: Partial<MarketPrice> = {}): MarketPrice => ({ crop: 'PEPPER', source_id: 'spices-board-prices', variety: null, grade: 'Garbled', market: 'Cochin', state: 'Kerala', district: null, min_price: null, max_price: null, modal_price: null, average_price: 723, unit: 'INR/kg', price_date: '2026-10-05', price_kind: 'indicative', source_url: 'https://www.indianspices.com/', retrieved_at: '2026-10-07T00:00:00Z', ...patch })
const update = (patch: Partial<OfficialUpdate> = {}): OfficialUpdate => ({ source_id: 'coffee-board-news', source_name: 'Coffee Board', source_url: 'https://coffeeboard.gov.in/News.aspx', source_type: 'official', source_authority_level: 1, retrieved_at: '2026-10-07T00:00:00Z', source_published_at: '2026-09-01', source_updated_at: null, effective_from: null, effective_until: null, financial_year: null, season: null, raw_source_reference: 'Test', verification_status: 'OFFICIAL_CONFIRMED', title: 'Coffee notice', summary: 'Test announcement', category: 'government', crops: ['COFFEE'], state: null, district: null, taluk: null, village: null, application_deadline: null, application_url: null, dedupe_key: 'a'.repeat(64), details: {}, ...patch })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T02:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('regional browsing boundaries', () => {
  it('includes regional and national notices without inferring a saved estate', () => {
    expect(visibleFarmUpdate(update(), null)).toBe(true)
    expect(visibleFarmUpdate(update({ district: 'Hassan', state: 'Karnataka' }), null)).toBe(true)
    expect(visibleFarmUpdate(update({ district: 'Kodagu' }), null)).toBe(false)
    expect(visibleFarmUpdate(update({ village: 'Another village' }), null)).toBe(false)
    expect(visibleFarmUpdate(update({ details: { scope: 'non_traditional_area' } }), null)).toBe(false)
    expect(visibleFarmUpdate(update(), emptyFarmProfile())).toBe(false)
  })
  it('keeps expired and older fiscal notices out of the regional current feed', () => {
    expect(visibleFarmUpdate(update({ effective_until: '2026-10-06' }), null)).toBe(false)
    expect(visibleFarmUpdate(update({ category: 'schemes', financial_year: '2025–26' }), null)).toBe(false)
    expect(visibleFarmUpdate(update({ verification_status: 'OFFICIAL_BUT_OLD' }), null)).toBe(false)
    expect(visibleFarmUpdate(update({ effective_until: '2026-10-06' }), null, true)).toBe(true)
    expect(nextStep(update({ verification_status: 'OFFICIAL_BUT_OLD' }))).toContain('past period')
  })
})
describe('market reference integrity', () => {
  it('deduplicates quote histories by grade, market, kind and unit while retaining distinct products', () => {
    const rows = latestMarketPrices([price({ price_date: '2026-10-02', average_price: 700 }), price(), price({ grade: 'Ungarbled', average_price: 703 }), price({ market: 'Other market' }), price({ unit: 'INR/quintal', average_price: 72300 })])
    expect(rows).toHaveLength(4)
    expect(rows.find(row => row.grade === 'Garbled' && row.market === 'Cochin' && row.unit === 'INR/kg')?.average_price).toBe(723)
  })
  it('does not turn missing, invalid or future values into usable prices', () => {
    expect(priceValue(price({ modal_price: 0 }))).toBe(0)
    expect(priceValue(price({ average_price: null }))).toBeNull()
    expect(latestMarketPrices([price({ average_price: NaN }), price({ average_price: -1 }), price({ price_date: 'bad date' }), price({ price_date: '2026-10-08' })])).toEqual([])
    expect(priceValue(price({ average_price: '723' as unknown as number }))).toBe(723)
  })
  it('keeps freshly retrieved old quotations stale', () => {
    expect(priceIsStale(price({ price_date: '2026-06-05' }))).toBe(true)
    expect(priceIsStale(price())).toBe(false)
  })
})
