import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
    <section className="grid grid-cols-2 gap-3 lg:gap-4"><PriceCard title="Latest Arabica" price={latest?.arabicaInrKg} multiplied={latest?.arabicaInrKg ? latest.arabicaInrKg * 24 : undefined} source={`${latest?.arabicaUsd.toFixed(3) ?? '—'} USD/lb`} tone="market-arabica" /><PriceCard title="Latest Robusta" price={latest?.robustaInrKg} multiplied={latest?.robustaInrKg ? latest.robustaInrKg * 24 : undefined} source={`${latest?.robustaUsd.toLocaleString() ?? '—'} USD/tonne`} tone="market-robusta" /></section>
    <section className="card"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-extrabold">Cached price movement</h2><p className="text-sm text-stone-600">Charts use every valid row in the bundled CSV. Arabica and Robusta are separated so both movements remain easy to read.</p></div><p className="text-sm font-bold text-stone-500">₹ / kg</p></div>{futuresHistory.length ? <div className="mt-4 grid gap-5 lg:grid-cols-2"><FuturesChart title="Arabica" colour="#3d6637" data={futuresHistory} dataKey="arabicaInrKg" /><FuturesChart title="Robusta" colour="#b87937" data={futuresHistory} dataKey="robustaInrKg" /></div> : <div className="grid h-56 place-items-center text-center text-stone-500">No usable prices were found in the CSV.</div>}</section>
    <section className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-extrabold">Cached market data</h2><p className="mt-1 text-sm text-stone-600">Latest cached trading day: {latest?.date ?? 'No data'}. Refresh fetches the latest quote and downloads a replacement CSV.</p></div><button className="button-primary shrink-0" disabled={refreshing} onClick={() => void refreshLatest()}>{refreshing ? 'Refreshing…' : 'Refresh & download CSV'}</button></section>
  </div>
}
function PriceCard({ title, price, multiplied, source, tone }: { title: string; price?: number; multiplied?: number; source: string; tone: string }) { return <section className={`summary-tile tone-${tone}`}><p className="tile-label">{title}</p><p className="mt-2 text-2xl font-extrabold sm:text-4xl">{price == null ? '—' : money(price)}<span className="text-sm font-semibold opacity-70 sm:text-base"> / kg</span></p><p className="mt-2 text-sm font-extrabold sm:text-lg">{multiplied == null ? '—' : money(multiplied)} <span className="text-xs font-semibold opacity-70 sm:text-sm">for 24 kg</span></p><p className="mt-2 text-xs font-medium opacity-75 sm:text-sm">{source}</p></section> }
function FuturesChart({ title, colour, data, dataKey }: { title: string; colour: string; data: FuturesPoint[]; dataKey: 'arabicaInrKg' | 'robustaInrKg' }) { return <div className="rounded-xl bg-stone-50 p-3"><h3 className="text-sm font-extrabold text-stone-800">{title}</h3><ResponsiveContainer width="100%" height={220}><LineChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(date) => String(date).slice(5)} minTickGap={28} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(amount) => `₹${Math.round(Number(amount))}`} width={52} /><Tooltip formatter={(value) => money(Number(value))} labelFormatter={(date) => `Date: ${date}`} /><Line type="monotone" dataKey={dataKey} name={`${title} / kg`} stroke={colour} strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> }
