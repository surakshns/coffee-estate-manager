import { useMemo, useState } from 'react'
import { ArrowUpRight, Bell, Check, ChevronDown, CloudLightning, ExternalLink, MapPin, RefreshCw, ShieldCheck, Sprout, TrendingUp } from 'lucide-react'
import { ViewTabs, EmptyState, Notice } from './Workspace'
import { RecordLoading } from './RecordLoading'
import { FarmOnboarding, CROP_LABELS } from './FarmOnboarding'
import { FarmQuickSetup } from './FarmQuickSetup'
import { useFarmIntelligence } from '../hooks/useFarmIntelligence'
import { CROPS, estateCrops, matchUpdate, schemeEligibility, wantsAlert, updateStale, isExpired, insuranceAvailability, nearestStation, validSourceUrl, type Crop, type OfficialUpdate, type FarmProfile, type SchemeRules, type MarketPrice } from '../lib/farmIntelligence'
import { latestMarketPrices, nextStep, priceIsStale, priceValue, visibleFarmUpdate } from '../lib/farmPresentation'
import '../farm-intelligence.css'

const categories = [{ value: 'all', label: 'All notices' }, { value: 'schemes', label: 'Schemes & subsidies' }, { value: 'insurance', label: 'Insurance' }, { value: 'pest', label: 'Pest & disease' }, { value: 'government', label: 'Government' }, { value: 'news', label: 'News' }, { value: 'training', label: 'Training' }, { value: 'relief', label: 'Relief' }]
const dateLabel = (value: string | null, withTime = false) => {
  if (!value) return 'Date unavailable'
  const parsed = Date.parse(value.length === 10 ? `${value}T12:00:00Z` : value)
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric' as const, minute: '2-digit' as const } : {}) }).format(parsed) : 'Date unavailable'
}
export function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  return validSourceUrl(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13} aria-hidden="true" /></a> : <span>Source link unavailable</span>
}
function confidence(update: OfficialUpdate) {
  if (update.verification_status === 'UNVERIFIED') return 'Details need checking'
  if (update.verification_status === 'EXPIRED') return 'Expired'
  if (update.verification_status === 'OFFICIAL_BUT_OLD') return 'Older official period'
  return update.source_authority_level === 1 ? 'Official source' : 'Secondary source'
}
function UpdateCard({ update, profile, read, onRead }: { update: OfficialUpdate; profile: FarmProfile | null; read: boolean; onRead?: () => void }) {
  const match = profile ? matchUpdate(update, profile) : null, stale = updateStale(update), expired = isExpired(update) || update.verification_status === 'OFFICIAL_BUT_OLD'
  const eligibility = profile && update.category === 'schemes' ? schemeEligibility(update, profile, (update.details.eligibility_rules ?? { verified: false, financial_year: update.financial_year }) as SchemeRules) : null
  return <article className="fi-update">
    <div className="fi-badges"><span>{update.category === 'pest' ? 'Risk advisory' : update.category}</span><span className={update.verification_status === 'OFFICIAL_CONFIRMED' ? 'fi-confirmed' : 'fi-unverified'}>{confidence(update)}</span>{stale && <span className="fi-stale">Last retrieved over 3 days ago</span>}{expired && update.verification_status !== 'EXPIRED' && <span className="fi-stale">Expired</span>}</div>
    <h3>{update.title}</h3><p>{update.summary}</p>
    <div className="fi-next-step"><strong><ArrowUpRight size={16} />{expired ? 'Before using this notice' : 'Your next step'}</strong><p>{nextStep(update)}</p></div>
    {eligibility && <p className="fi-eligibility"><strong>{eligibility.status.toLowerCase().replaceAll('_', ' ')}</strong> · {eligibility.missing.join(' ') || eligibility.reasons.join(' ')}</p>}
    {match && !expired && <details className="fi-match"><summary>Why this appears for your estate</summary><ul>{[...match.reasons, ...match.missing].map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    <dl className="fi-dates">{update.source_published_at && <div><dt>Published</dt><dd>{dateLabel(update.source_published_at)}</dd></div>}{update.effective_from && <div><dt>Event / effective date</dt><dd>{dateLabel(update.effective_from)}</dd></div>}{update.financial_year && <div><dt>Financial year</dt><dd>{update.financial_year}</dd></div>}{update.season && <div><dt>Season</dt><dd>{update.season}</dd></div>}{update.application_deadline && <div><dt>Application deadline</dt><dd>{dateLabel(update.application_deadline)}</dd></div>}</dl>
    <footer><SourceLink url={update.source_url}>View official notice</SourceLink>{onRead && <button type="button" disabled={read} onClick={onRead} className="fi-read"><Check size={14} />{read ? 'Read' : 'Mark read'}</button>}</footer>
    <small className="fi-attribution">{update.source_name} · Retrieved {dateLabel(update.retrieved_at, true)}</small>
    {update.application_url && <SourceLink url={update.application_url}>Application information</SourceLink>}
  </article>
}
function PriceRows({ prices }: { prices: MarketPrice[] }) {
  return <div className="fi-price-rows">{prices.map(price => <div className="fi-price-row" key={price.id ?? [price.market, price.variety, price.grade, price.unit].join('-')}><div><span>{price.grade ?? price.variety ?? price.market}</span><small>{price.market} · {dateLabel(price.price_date)}</small></div><div><strong>{price.unit === 'INR/kg' ? '₹' : ''}{priceValue(price)!.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong><small>{price.unit === 'INR/kg' ? 'per kg' : price.unit}</small></div></div>)}</div>
}
function PricePanel({ crop, prices }: { crop: Crop; prices: MarketPrice[] }) {
  const rows = prices.filter(price => price.crop === crop && price.price_kind !== 'futures').slice(0, 4)
  const stale = rows.some(priceIsStale)
  return <section className="fi-panel fi-market-card" aria-label={`${CROP_LABELS[crop]} market overview`}>
    <div className="fi-panel-heading"><span className="fi-icon-tile"><TrendingUp size={20} /></span><span className="fi-eyebrow">{crop === 'COFFEE' ? 'COFFEE · GLOBAL BENCHMARK' : crop === 'PEPPER' ? 'PEPPER · MARKET INDICATION' : 'ARECANUT · MARKET PRICES'}</span></div>
    <h2>{crop === 'COFFEE' ? 'International coffee indicators' : crop === 'PEPPER' ? 'Pepper market reference' : 'Arecanut prices'}</h2>
    {rows.length ? <><PriceRows prices={rows} /><p className="fi-quote-date">Quote: {dateLabel(rows[0].price_date)} {stale && <span className="fi-stale">Stale quote</span>}</p><p className="fi-card-action">{crop === 'COFFEE' ? 'Use for market context. Ask your buyer for a local cherry or parchment quote in ₹.' : 'Compare your buyer’s offer for the same grade. These market indications do not guarantee your selling price.'}</p><SourceLink url={rows[0].source_url}>{crop === 'COFFEE' ? 'Coffee Board prices' : crop === 'PEPPER' ? 'Spices Board prices' : 'Official market source'}</SourceLink></> : <><p className="fi-no-data">No verified {CROP_LABELS[crop].toLowerCase()} quote is available.</p><p className="fi-card-action">Ask your buyer for today’s quote, including grade, unit, deductions and payment terms.</p></>}
  </section>
}

export function FarmIntelligence({ userId }: { userId: string }) {
  const { snapshot, loading, saving, setupReady, error, refresh, save, markRead } = useFarmIntelligence(userId)
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<FarmProfile | null>(null), [crop, setCrop] = useState<'ALL' | Crop>('ALL'), [category, setCategory] = useState('all'), [count, setCount] = useState(12), [notice, setNotice] = useState(''), [history, setHistory] = useState(false), [reading, setReading] = useState(false)
  const { profile, updates, prices, sources, stations, observations, alerts } = snapshot
  const regional = !profile, location = profile?.estate ?? { taluk: 'Sakleshpur', district: 'Hassan', village: null }
  const relevant = useMemo(() => updates.filter(update => visibleFarmUpdate(update, profile)), [profile, updates])
  const matched = useMemo(() => relevant.filter(update => !['prices', 'weather'].includes(update.category) && (crop === 'ALL' || update.crops.includes(crop)) && (category === 'all' || update.category === category)).sort((a, b) => (profile ? matchUpdate(b, profile).score - matchUpdate(a, profile).score : 0) || (b.source_published_at ?? '').localeCompare(a.source_published_at ?? '')), [profile, relevant, crop, category])
  const historical = useMemo(() => updates.filter(update => (isExpired(update) || update.verification_status === 'OFFICIAL_BUT_OLD') && visibleFarmUpdate(update, profile, true) && !['prices', 'weather'].includes(update.category) && (crop === 'ALL' || update.crops.includes(crop)) && (category === 'all' || update.category === category)).slice(0, 20), [profile, updates, crop, category])
  const marketPrices = useMemo(() => latestMarketPrices(prices), [prices])
  const futures = marketPrices.filter(price => price.price_kind === 'futures' && (crop === 'ALL' || price.crop === crop))
  const weather = relevant.filter(update => update.category === 'weather' && update.verification_status === 'OFFICIAL_CONFIRMED').sort((a, b) => (a.effective_from ?? '').localeCompare(b.effective_from ?? '') || b.retrieved_at.localeCompare(a.retrieved_at))[0]
  const upcoming = relevant.filter(update => update.application_deadline && update.verification_status === 'OFFICIAL_CONFIRMED').sort((a, b) => a.application_deadline!.localeCompare(b.application_deadline!)).slice(0, 5)
  const station = profile ? nearestStation(profile, stations) : null
  const observation = station ? observations.find(item => item.station_id === station.id && ['verified', 'revised'].includes(item.quality_status) && item.rainfall_mm !== null && Date.parse(item.period_end) <= Date.now()) : null
  const connected = sources.filter(source => source.enabled && source.last_success_at)
  const lastRetrieved = connected.map(source => source.last_success_at!).sort().at(-1)
  const unread = profile ? relevant.filter(update => update.id && wantsAlert(update, profile) && update.verification_status === 'OFFICIAL_CONFIRMED' && !updateStale(update) && (update.details.measurement_type !== 'official_district_warning' || ['yellow', 'orange', 'red'].includes(String(update.details.warning_colour))) && !alerts.some(alert => alert.update_id === update.id && alert.read_at)) : []
  async function read(update: OfficialUpdate) {
    if (!profile?.estate.id || !update.id) return
    try { await markRead(profile.estate.id, update.id) } catch { setNotice('Could not mark this alert as read. Try again.') }
  }
  async function readBrief() {
    if (!profile?.estate.id || reading) return
    setReading(true)
    try {
      const results = await Promise.allSettled(unread.map(update => markRead(profile.estate.id!, update.id!)))
      if (results.some(result => result.status === 'rejected')) setNotice('Some alerts could not be marked as read. Try again.')
    } finally { setReading(false) }
  }
  function openEditor(initial: FarmProfile | null = profile) { setDraft(initial); setEditing(true) }
  return <div className="page fi-workspace">
    <header className="workspace-heading fi-heading"><div><h1>Farm Intelligence</h1><p>Weather, market references and official notices—with a next step you can use.</p></div><button className="button-secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'fi-spinning' : ''} />{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    <Notice error>{error || notice}</Notice>
    {!setupReady && !loading && <div className="fi-service-notice"><h2>Farm updates are being connected</h2><p>Your estate setup will be available when the data service is ready. Try refreshing in a moment.</p></div>}
    {loading && !updates.length && !profile ? <RecordLoading message="Loading weather, prices and official notices…" /> : <>
      <section className="fi-context"><div><span className="fi-eyebrow">{regional ? 'REGIONAL OVERVIEW' : 'YOUR ESTATE BRIEFING'}</span><h2>{profile?.estate.estate_name || [location.taluk, location.district].filter(Boolean).join(' & ')}</h2><p><MapPin size={15} />{[location.village, location.taluk, location.district].filter(Boolean).join(' · ')}{regional ? ' · Not yet personalized' : ` · ${profile.blocks.length} physical ${profile.blocks.length === 1 ? 'block' : 'blocks'}`}</p></div><div className="fi-context-actions">{profile ? <><span>{estateCrops(profile).map(c => CROP_LABELS[c]).join(' · ') || 'Crops not recorded'}</span><button type="button" className="fi-light-button" onClick={() => openEditor()}>Edit estate profile<ArrowUpRight size={16} /></button></> : <span>Browse the regional brief below.<br />Add your estate to tailor the notices.</span>}</div></section>
      <ViewTabs label="Crop filters" value={crop} onChange={value => { setCrop(value); setCount(12) }} items={[{ value: 'ALL', label: 'All crops' }, ...CROPS.map(value => ({ value, label: CROP_LABELS[value] }))]} />
      <div className="fi-section-heading fi-brief-heading"><h2>At a glance</h2><div className="fi-brief-actions"><span>{lastRetrieved ? `Latest source retrieval ${dateLabel(lastRetrieved, true)}` : 'Showing available publisher records'}</span>{unread.length > 0 && <button type="button" className="fi-text-button" disabled={reading} onClick={() => void readBrief()}><Check size={14} />{reading ? 'Marking read…' : 'Mark fresh alerts read'}</button>}</div></div>
      <div className={`fi-overview-grid ${crop !== 'ALL' ? 'fi-two-columns' : ''}`}>
        <section className={`fi-panel fi-weather-card ${weather && ['yellow', 'orange', 'red'].includes(String(weather.details.warning_colour)) ? 'fi-weather-warning' : ''}`} aria-label="District weather overview">
          <div className="fi-panel-heading"><span className="fi-icon-tile"><CloudLightning size={20} /></span><span className="fi-eyebrow">DISTRICT WEATHER</span>{weather && <span className="fi-warning-label">{['yellow', 'orange', 'red'].includes(String(weather.details.warning_colour)) ? `${weather.details.warning_colour} warning` : 'IMD bulletin'}</span>}</div>
          <h2>{location.district} weather</h2>{weather ? <><h3>{weather.title.replace(/^IMD Hassan /, '')}</h3><p>{weather.summary}</p><p className="fi-quote-date">Valid for {dateLabel(weather.effective_from)}{updateStale(weather) && <span className="fi-stale">Check for an update</span>}</p><p className="fi-card-action">{updateStale(weather) ? 'Review the latest district bulletin before scheduling outdoor work.' : 'Review the district warning before scheduling outdoor work.'}</p><SourceLink url={weather.source_url}>Read IMD warning</SourceLink></> : <><p className="fi-no-data">No current verified warning is available.</p><p className="fi-card-action">An unavailable bulletin does not mean clear weather. Check the latest IMD forecast before scheduling work.</p></>}<small>District forecast, not rainfall measured on your estate.</small>
        </section>
        {(crop === 'ALL' ? ['PEPPER', 'COFFEE'] as Crop[] : [crop]).map(value => <PricePanel key={value} crop={value} prices={marketPrices} />)}
      </div>
      {crop === 'ALL' && <p className="fi-inline-note">Arecanut: no verified market quote is connected yet. Select Arecanut for its available notices.</p>}
      {futures.length > 0 && <details className="fi-compact-details fi-futures"><summary><TrendingUp size={17} /><span>International futures archive <small>{futures.length} contracts · quote {dateLabel(futures[0].price_date)}{futures.some(priceIsStale) ? ' · Stale' : ''}</small></span><ChevronDown size={17} /></summary><div><p className="fi-help">These are dated futures quotations, separate from current local selling prices. Contract month and quote date are different.</p><div className="fi-futures-grid">{futures.map(price => <div className="fi-futures-item" key={price.id ?? `${price.variety}-${price.grade}`}><strong>{price.variety} · {price.grade}</strong><span>{priceValue(price)!.toLocaleString('en-IN')} {price.unit}</span><small>Quote: {dateLabel(price.price_date)} · {price.market}</small><SourceLink url={price.source_url}>Publisher</SourceLink></div>)}</div></div></details>}
      {setupReady && !loading && !profile && <FarmQuickSetup saving={saving} onSave={save} onDetails={openEditor} />}
      {profile && !estateCrops(profile).length && <div className="fi-service-notice"><h2>Add your crops to see relevant notices</h2><p>Your location is saved. Add coffee, pepper or arecanut to the blocks where they grow.</p><button className="button-secondary" onClick={() => openEditor()}>Add crops</button></div>}
      <section aria-labelledby="fi-feed"><div className="fi-section-heading"><div><span className="fi-eyebrow">OFFICIAL NOTICES</span><h2 id="fi-feed">{regional ? 'Notices to explore' : 'Updates for your estate'}{unread.length > 0 && <span className="fi-alert-count"><Bell size={14} />{unread.length} fresh alerts</span>}</h2></div><label>Show<select value={category} onChange={e => { setCategory(e.target.value); setCount(12) }}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        {matched.length ? <div className="fi-update-grid">{matched.slice(0, count).map(update => <UpdateCard key={update.id ?? update.dedupe_key} update={update} profile={profile} read={alerts.some(alert => alert.update_id === update.id && !!alert.read_at)} onRead={profile && wantsAlert(update, profile) ? () => void read(update) : undefined} />)}</div> : <EmptyState title="No matching notices right now" detail="Try another crop or category. Weather and market references are shown above when available." />}
        {matched.length > count && <button className="button-secondary fi-load-more" onClick={() => setCount(value => value + 12)}>Show more notices</button>}
        <label className="fi-history-toggle"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} />View expired notices separately</label>{history && <div className="fi-update-grid">{historical.length ? historical.map(update => <UpdateCard key={update.id ?? update.dedupe_key} update={update} profile={profile} read />) : <p className="fi-help">No expired notices in the loaded history.</p>}</div>}
      </section>
      {upcoming.length > 0 && <section className="fi-deadline-panel"><h2>Verified application deadlines</h2><ul className="fi-deadlines">{upcoming.map(update => <li key={update.id ?? update.dedupe_key}><strong>{dateLabel(update.application_deadline)}</strong><SourceLink url={update.source_url}>{update.title}</SourceLink></li>)}</ul></section>}
      <details className="fi-compact-details"><summary><ShieldCheck size={18} /><span>Rainfall & insurance <small>Check observations and policy details</small></span><ChevronDown size={17} /></summary><div className="fi-evidence-content"><section><h3>Official station observations</h3>{station ? <><p>Nearest verified station: <strong>{station.station_name}</strong> · {station.distance_km!.toFixed(2)} km from your estate</p>{observation ? <><p><strong>{observation.rainfall_mm} mm</strong> · {dateLabel(observation.period_start)} to {dateLabel(observation.period_end)}</p><p>{Date.now() - Date.parse(observation.period_end) > 36 * 3600000 ? 'Stale observation. ' : ''}Measured at the station, not your estate.</p><SourceLink url={observation.source_url}>Observation source</SourceLink></> : <p>No verified observations are available for this station.</p>}</> : <p>Official Karnataka rainfall data is unavailable. No verified station dataset is connected.</p>}<small>Insurance uses its notified reference station, independently of the nearest station.</small></section>
        {profile ? <div className="fi-insurance-grid">{profile.insurance.filter(policy => crop === 'ALL' || policy.crop === crop).map(policy => <article key={policy.crop}><h3>{CROP_LABELS[policy.crop]}</h3><p>Policy status: {policy.currently_insured === null ? 'Unknown' : policy.currently_insured ? 'Reported insured' : 'Reported not insured'}</p><p>{[policy.scheme_name, policy.policy_year, policy.season].filter(Boolean).join(' · ') || 'Policy details not recorded'}</p><strong className="fi-unavailable">Claim calculation unavailable</strong><details><summary>What needs verification</summary><ul>{insuranceAvailability(policy).missing.map(item => <li key={item}>{item}</li>)}</ul></details></article>)}</div> : <p>Add your estate and policy details to review insurance information by crop. Official coverage and payout rules must also be verified.</p>}
      </div></details>
      <details className="fi-compact-details fi-sources"><summary><Sprout size={18} /><span>Data coverage <small>{connected.length} connected sources · availability and quote dates</small></span><ChevronDown size={17} /></summary><div><p className="fi-help">Prices and notices show their own publication dates. Source retrieval does not make an older quote current.</p><div className="fi-source-list">{sources.map(source => <article key={source.id}><div><SourceLink url={source.source_url}>{source.source_name}</SourceLink><p>{source.status_message}</p>{source.last_success_at && <small>Retrieved {dateLabel(source.last_success_at, true)}</small>}</div><span className={source.enabled && source.last_success_at ? 'fi-confirmed' : 'fi-unverified'}>{source.enabled ? source.last_success_at ? 'Connected' : 'Awaiting data' : 'Not connected'}</span></article>)}</div>{!sources.length && <p className="fi-help">Source status has not been loaded.</p>}<p className="fi-help">Local arecanut quotes, official rainfall observations, automated pest advice and verified insurance calculations are not currently connected. We show available evidence without filling these gaps with estimates.</p></div></details>
    </>}
    {editing && setupReady && <FarmOnboarding key={userId} initial={draft} saving={saving} onSave={async value => { await save(value); setNotice('') }} onClose={() => setEditing(false)} />}
  </div>
}
