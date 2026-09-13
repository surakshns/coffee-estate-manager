import { useEffect, useState } from 'react'
import { money } from '../lib/calculations'

type FuturesPoint = { date: string; arabicaUsd: number; robustaUsd: number; usdInr: number; arabicaInrKg: number; robustaInrKg: number }
const cacheUrl = '/market-data/coffee-futures-2026.csv'
const coffeeApi = 'https://buonmathuotcoffee.com/api/v1/coffee-price'
const csvHeader = 'date,arabica_usd_lb,robusta_usd_tonne,usd_inr,arabica_inr_kg,robusta_inr_kg,source'

function parseCsv(csv: string) {
  const [, ...lines] = csv.trim().split('\n')
  return lines.map((line) => {
    const [date, arabicaUsd, robustaUsd, usdInr, arabicaInrKg, robustaInrKg] = line.split(',')
    return { date, arabicaUsd: Number(arabicaUsd), robustaUsd: Number(robustaUsd), usdInr: Number(usdInr), arabicaInrKg: Number(arabicaInrKg), robustaInrKg: Number(robustaInrKg) }
  }).filter((row) => row.date && Number.isFinite(row.arabicaInrKg) && Number.isFinite(row.robustaInrKg))
}

export function Prices() {
  const [futuresHistory, setFuturesHistory] = useState<FuturesPoint[]>([])
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => { void fetch(cacheUrl).then((response) => response.ok ? response.text() : '').then((csv) => setFuturesHistory(parseCsv(csv))).catch(() => setFuturesHistory([])) }, [])
  const latest = futuresHistory.at(-1)
  async function refreshLatest() {
    setRefreshing(true); setMessage('')
    try {
      const [quoteResponse, fxResponse] = await Promise.all([fetch(coffeeApi), fetch('https://open.er-api.com/v6/latest/USD')])
      if (!quoteResponse.ok || !fxResponse.ok) throw new Error('The price source is unavailable right now.')
      const quote = await quoteResponse.json(); const fx = await fxResponse.json()
      const usdInr = Number(fx.rates?.INR); const arabicaUsd = Number(quote.ice_arabica?.value); const robustaUsd = Number(quote.ice_robusta?.value); const date = String(quote.timestamp ?? '').slice(0, 10)
      if (!date || !Number.isFinite(usdInr) || !Number.isFinite(arabicaUsd) || !Number.isFinite(robustaUsd)) throw new Error('The price source returned incomplete data.')
      const point = { date, arabicaUsd, robustaUsd, usdInr, arabicaInrKg: arabicaUsd * usdInr * 2.20462262185, robustaInrKg: robustaUsd * usdInr / 1000 }
      const merged = [...futuresHistory.filter((item) => item.date !== date), point].sort((a, b) => a.date.localeCompare(b.date))
      setFuturesHistory(merged)
      const csv = `${csvHeader}\n${merged.map((item) => [item.date, item.arabicaUsd, item.robustaUsd, item.usdInr.toFixed(4), item.arabicaInrKg.toFixed(2), item.robustaInrKg.toFixed(2), 'Buon Ma Thuot Coffee API'].join(',')).join('\n')}\n`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = 'coffee-futures-2026.csv'; link.click(); URL.revokeObjectURL(url)
      setMessage(`Latest quote for ${date} loaded and an updated CSV was downloaded.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not refresh prices.') } finally { setRefreshing(false) }
  }
  return <div className="page space-y-5"><header><p className="text-sm font-bold uppercase tracking-wider text-leaf-700">Market rates</p><h1 className="mt-1 text-3xl font-extrabold">Coffee prices</h1><p className="mt-1 text-stone-600">Global ICE benchmark futures, converted to Indian rupees per kilogram. These are not Sakleshpur spot rates.</p></header>
    {message && <p className="rounded-xl bg-leaf-50 p-3 font-semibold text-leaf-700">{message}</p>}
    <section className="grid gap-4 lg:grid-cols-2"><PriceCard title="Latest Arabica" price={latest?.arabicaInrKg} multiplied={latest?.arabicaInrKg ? latest.arabicaInrKg * 24 : undefined} source={`${latest?.arabicaUsd.toFixed(3) ?? '—'} USD/lb`} /><PriceCard title="Latest Robusta" price={latest?.robustaInrKg} multiplied={latest?.robustaInrKg ? latest.robustaInrKg * 24 : undefined} source={`${latest?.robustaUsd.toLocaleString() ?? '—'} USD/tonne`} /></section>
    <section className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-extrabold">Cached market data</h2><p className="mt-1 text-sm text-stone-600">Latest cached trading day: {latest?.date ?? 'No data'}. Refresh fetches the latest quote and downloads a replacement CSV.</p></div><button className="button-primary shrink-0" disabled={refreshing} onClick={() => void refreshLatest()}>{refreshing ? 'Refreshing…' : 'Refresh & download CSV'}</button></section>
  </div>
}
function PriceCard({ title, price, multiplied, source }: { title: string; price?: number; multiplied?: number; source: string }) { return <section className="card"><p className="text-sm font-bold uppercase tracking-wider text-stone-500">{title}</p><p className="mt-2 text-4xl font-extrabold text-leaf-700">{price == null ? '—' : money(price)}<span className="text-base text-stone-500"> / kg</span></p><p className="mt-2 text-lg font-extrabold text-stone-800">{multiplied == null ? '—' : money(multiplied)} <span className="text-sm font-semibold text-stone-500">for 24 kg</span></p><p className="mt-2 text-sm text-stone-500">{source}</p></section> }
