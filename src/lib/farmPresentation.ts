import { indiaDate, isExpired, matchUpdate, estateCrops, type FarmProfile, type OfficialUpdate, type MarketPrice } from './farmIntelligence'

const place = (value: string | null) => (value ?? '').trim().toLowerCase().replace(/sakaleshpura|sakleshpura/g, 'sakleshpur')

// Regional browsing does not create an estate or infer crops, insurance or eligibility.
export function visibleFarmUpdate(update: OfficialUpdate, profile: FarmProfile | null, historical = false) {
  if (!historical && (isExpired(update) || update.verification_status === 'OFFICIAL_BUT_OLD')) return false
  if (profile && !historical) return matchUpdate(update, profile).relevant
  const location = profile?.estate ?? { state: 'Karnataka', district: 'Hassan', taluk: 'Sakleshpur', village: null }
  for (const key of ['state', 'district', 'taluk', 'village'] as const) {
    if (update[key] && place(update[key]) !== 'india' && place(update[key]) !== place(location[key])) return false
  }
  if (update.details.scope === 'non_traditional_area' && ['karnataka', 'kerala', 'tamil nadu'].includes(place(location.state))) return false
  if (profile && update.crops.length && !update.crops.some(c => estateCrops(profile).includes(c))) return false
  if (!historical && update.category === 'schemes' && update.financial_year) {
    const today = indiaDate(), year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0)
    if (/^\d{4}/.test(update.financial_year) && Number(update.financial_year.slice(0, 4)) < year) return false
  }
  return !/coffee recipes|cafe lifestyle|latte art|celebrity/i.test(`${update.title} ${update.summary}`)
}

export function priceValue(price: MarketPrice) {
  const value = price.modal_price ?? price.average_price
  if (value === null || value === undefined || String(value).trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

export function latestMarketPrices(prices: MarketPrice[]) {
  const groups = new Map<string, MarketPrice>()
  for (const price of prices) {
    if (priceValue(price) === null || !Number.isFinite(Date.parse(price.price_date)) || price.price_date.slice(0, 10) > indiaDate()) continue
    const key = [price.crop, price.price_kind, price.market, price.variety, price.grade, price.unit].join('|')
    const previous = groups.get(key)
    if (!previous || price.price_date > previous.price_date || (price.price_date === previous.price_date && price.retrieved_at > previous.retrieved_at)) groups.set(key, price)
  }
  return [...groups.values()].sort((a, b) => b.price_date.localeCompare(a.price_date))
}

export function priceIsStale(price: MarketPrice) {
  // Use the quote date, never the date we downloaded the publisher page.
  return Date.now() - Date.parse(price.price_date) > 4 * 86400000
}

export function nextStep(update: OfficialUpdate) {
  if (isExpired(update) || update.verification_status === 'OFFICIAL_BUT_OLD') return 'This notice covers a past period. Check for a newer announcement before making plans.'
  if (update.details.notice_subject === 'arabica_hybrids' || /hybrid/i.test(update.title)) return 'If you are planning Arabica planting, ask Coffee Board about planting material availability and suitability for your site.'
  if (update.details.notice_subject === 'quality_diploma') return 'Ask Coffee Board whether admissions are still open, and confirm entry requirements, fees and the course schedule.'
  if (update.details.notice_subject === 'foreign_promotion') return 'If you market or export coffee, ask the Board about participation requirements and the events relevant to your business.'
  if (update.category === 'training') return 'Before enrolling, confirm the course dates, location, fees and whether places are still available.'
  if (update.category === 'schemes') return 'Confirm the current application window and eligibility with the issuing office before preparing an application.'
  if (update.category === 'insurance') return 'Compare the notified crop, season and reference station with your policy before taking action.'
  if (update.category === 'pest') return 'Compare the advisory with conditions in your crop and consult your local extension officer before treatment.'
  return 'Confirm the notice’s current scope with the issuing office before making a decision for your estate.'
}
