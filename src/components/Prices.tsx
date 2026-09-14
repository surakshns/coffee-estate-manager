import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '../lib/calculations'

type FuturesPoint = { date: string; arabicaUsd: number; robustaUsd: number; usdInr: number; arabicaInrKg: number; robustaInrKg: number }
type ApiQuote = { date: string; arabicaUsd: number; robustaUsd: number }
type ApiRecord = { date?: unknown; ice_arabica_usd_lb?: unknown; ice_robusta_usd_tonne?: unknown }
type LatestRecord = { timestamp?: unknown; ice_arabica?: { value?: unknown }; ice_robusta?: { value?: unknown } }

const cacheUrl = `${import.meta.env.BASE_URL}market-data/coffee-futures-2026.csv`
const coffeeApi = 'https://buonmathuotcoffee.com/api/v1/coffee-price'
const historyApi = `${coffeeApi}/history?days=180`
const csvHeader = 'date,arabica_usd_lb,robusta_usd_tonne,usd_inr,arabica_inr_kg,robusta_inr_kg,source'
let liveHistoryForSession: FuturesPoint[] | null = null

function parseCsv(csv: string) {
  const [, ...lines] = csv.trim().split('\n')
  return lines.map((line) => {
    const [date, arabicaUsd, robustaUsd, usdInr, arabicaInrKg, robustaInrKg] = line.split(',')
    return { date, arabicaUsd: Number(arabicaUsd), robustaUsd: Number(robustaUsd), usdInr: Number(usdInr), arabicaInrKg: Number(arabicaInrKg), robustaInrKg: Number(robustaInrKg) }
  }).filter((row) => row.date && Number.isFinite(row.arabicaInrKg) && Number.isFinite(row.robustaInrKg))
}

function asApiQuote(dateValue: unknown, arabicaValue: unknown, robustaValue: unknown): ApiQuote | null {
  const date = typeof dateValue === 'string' ? dateValue.slice(0, 10) : ''
  const arabicaUsd = Number(arabicaValue)
  const robustaUsd = Number(robustaValue)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(arabicaUsd) || !Number.isFinite(robustaUsd)) return null
  return { date, arabicaUsd, robustaUsd }
}

function apiQuotes(historyPayload: unknown, latestPayload: unknown) {
  const quotes = new Map<string, ApiQuote>()
  const history = historyPayload as { data?: unknown }
  if (Array.isArray(history.data)) {
    for (const item of history.data) {
      const record = item as ApiRecord
      const quote = asApiQuote(record.date, record.ice_arabica_usd_lb, record.ice_robusta_usd_tonne)
      if (quote) quotes.set(quote.date, quote)
    }
  }
  const latest = latestPayload as LatestRecord
  const current = asApiQuote(latest.timestamp, latest.ice_arabica?.value, latest.ice_robusta?.value)
  if (current) quotes.set(current.date, current)
  return [...quotes.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function toCsv(points: FuturesPoint[]) {
  return `${csvHeader}\n${points.map((item) => [item.date, item.arabicaUsd, item.robustaUsd, item.usdInr.toFixed(4), item.arabicaInrKg.toFixed(2), item.robustaInrKg.toFixed(2), 'Buon Ma Thuot Coffee API'].join(',')).join('\n')}\n`
}

function downloadHistory(points: FuturesPoint[]) {
  const url = URL.createObjectURL(new Blob([toCsv(points)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'coffee-futures-2026.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await task(items[index])
    }
  }))
  return results
}

async function latestUsdInr() {
  const response = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })
  if (!response.ok) throw new Error('USD/INR conversion is unavailable.')
  const payload = await response.json() as { rates?: { INR?: unknown } }
  const rate = Number(payload.rates?.INR)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD/INR conversion is unavailable.')
  return rate
}

export function Prices() {
  const [futuresHistory, setFuturesHistory] = useState<FuturesPoint[]>([])
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [showingLiveData, setShowingLiveData] = useState(Boolean(liveHistoryForSession))

  useEffect(() => {
    let cancelled = false
    if (liveHistoryForSession) {
      setFuturesHistory(liveHistoryForSession)
      return () => { cancelled = true }
    }
    void fetch(cacheUrl).then((response) => response.ok ? response.text() : '').then((csv) => {
      if (!cancelled) setFuturesHistory(parseCsv(csv))
    }).catch(() => {
      if (!cancelled) setFuturesHistory([])
    })
    return () => { cancelled = true }
  }, [])

  const latest = futuresHistory.at(-1)

  async function refreshLiveData() {
    setRefreshing(true)
    setMessage('')
    try {
      const [historyResponse, latestResponse] = await Promise.all([
        fetch(historyApi, { cache: 'no-store' }),
        fetch(coffeeApi, { cache: 'no-store' })
      ])
      if (!historyResponse.ok || !latestResponse.ok) throw new Error('The coffee-price API is unavailable right now.')
      const quotes = apiQuotes(await historyResponse.json(), await latestResponse.json())
      if (!quotes.length) throw new Error('The coffee-price API returned no usable history.')

      const cachedByDate = new Map(futuresHistory.map((point) => [point.date, point]))
      let fallbackUsdInr: Promise<number> | null = null
      const loaded = await mapWithConcurrency(quotes, 6, async (quote) => {
        try {
          const cachedRate = cachedByDate.get(quote.date)?.usdInr
          const usdInr = Number.isFinite(cachedRate) && Number(cachedRate) > 0 ? Number(cachedRate) : await (fallbackUsdInr ??= latestUsdInr())
          return {
            date: quote.date,
            arabicaUsd: quote.arabicaUsd,
            robustaUsd: quote.robustaUsd,
            usdInr,
            arabicaInrKg: quote.arabicaUsd * usdInr * 2.20462262185,
            robustaInrKg: quote.robustaUsd * usdInr / 1000
          } satisfies FuturesPoint
        } catch {
          return null
        }
      })
      const livePoints = loaded.filter((point): point is FuturesPoint => point !== null)
      if (!livePoints.length) throw new Error('Live quotes were received, but currency conversion was unavailable.')

      const combined = new Map(futuresHistory.map((point) => [point.date, point]))
      livePoints.forEach((point) => combined.set(point.date, point))
      const merged = [...combined.values()].sort((a, b) => a.date.localeCompare(b.date))
      liveHistoryForSession = merged
      setFuturesHistory(merged)
      setShowingLiveData(true)
      setMessage(`Loaded ${livePoints.length} live API observations. The prices and graph now show the refreshed data; downloading is separate.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh live prices.')
    } finally {
      setRefreshing(false)
    }
  }

  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Market rates</p><h1 className="mt-1 text-3xl font-extrabold">Coffee prices</h1><p className="mt-1 text-stone-600">Global ICE benchmark futures, converted to Indian rupees per kilogram. These are not Sakleshpur spot rates.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700" role="status">{message}</p>}
    <section className="grid grid-cols-2 gap-3 lg:gap-4"><PriceCard title="Latest Arabica" price={latest?.arabicaInrKg} multiplied={latest?.arabicaInrKg ? latest.arabicaInrKg * 24 : undefined} source={`${latest?.arabicaUsd.toFixed(3) ?? '—'} USD/lb`} tone="market-arabica" /><PriceCard title="Latest Robusta" price={latest?.robustaInrKg} multiplied={latest?.robustaInrKg ? latest.robustaInrKg * 24 : undefined} source={`${latest?.robustaUsd.toLocaleString() ?? '—'} USD/tonne`} tone="market-robusta" /></section>
      <section className="card"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-extrabold">Coffee price movement</h2><p className="text-sm text-stone-600">{showingLiveData ? 'Showing the cached CSV plus live API history fetched in this visit.' : 'Showing the bundled CSV. Refresh live data to load the API history into this graph.'}</p></div><p className="text-sm font-bold text-stone-500">₹ / kg</p></div>{futuresHistory.length ? <div className="mt-4 grid gap-5 lg:grid-cols-2"><FuturesChart title="Arabica" colour="#355c3d" data={futuresHistory} dataKey="arabicaInrKg" /><FuturesChart title="Robusta" colour="#c9913f" data={futuresHistory} dataKey="robustaInrKg" /></div> : <div className="grid h-56 place-items-center text-center text-stone-500">No usable prices were found in the CSV.</div>}</section>
    <section className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-extrabold">Market data controls</h2><p className="mt-1 text-sm text-stone-600">Latest displayed trading day: {latest?.date ?? 'No data'}. Refresh reads the API only when you press it; it does not download or overwrite the bundled CSV.</p></div><div className="flex flex-col gap-3 sm:flex-row"><button className="button-primary shrink-0" disabled={refreshing} onClick={() => void refreshLiveData()}>{refreshing ? 'Refreshing live data…' : 'Refresh live data'}</button><button className="button-secondary shrink-0" disabled={!futuresHistory.length} onClick={() => downloadHistory(futuresHistory)}>Download displayed CSV</button></div></section>
  </div>
}

function PriceCard({ title, price, multiplied, source, tone }: { title: string; price?: number; multiplied?: number; source: string; tone: string }) { return <section className={`summary-tile tone-${tone}`}><p className="tile-label">{title}</p><p className="mt-2 text-2xl font-extrabold sm:text-4xl">{price == null ? '—' : money(price)}<span className="text-sm font-semibold opacity-70 sm:text-base"> / kg</span></p><p className="mt-2 text-sm font-extrabold sm:text-lg">{multiplied == null ? '—' : money(multiplied)} <span className="text-xs font-semibold opacity-70 sm:text-sm">for 24 kg</span></p><p className="mt-2 text-xs font-medium opacity-75 sm:text-sm">{source}</p></section> }
function FuturesChart({ title, colour, data, dataKey }: { title: string; colour: string; data: FuturesPoint[]; dataKey: 'arabicaInrKg' | 'robustaInrKg' }) { return <div className="rounded-xl bg-stone-50 p-3"><h3 className="text-sm font-extrabold text-stone-800">{title}</h3><ResponsiveContainer width="100%" height={220}><LineChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(date) => String(date).slice(5)} minTickGap={28} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(amount) => `₹${Math.round(Number(amount))}`} width={52} /><Tooltip formatter={(value) => money(Number(value))} labelFormatter={(date) => `Date: ${date}`} /><Line type="monotone" dataKey={dataKey} name={`${title} / kg`} stroke={colour} strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> }
