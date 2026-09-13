import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'public/market-data/coffee-futures-2026.csv')
const coffeeApi = 'https://buonmathuotcoffee.com/api/v1/coffee-price'
const header = 'date,arabica_usd_lb,robusta_usd_tonne,usd_inr,arabica_inr_kg,robusta_inr_kg,source'
const getJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`API returned ${response.status}: ${url}`)
  return response.json()
}
const [historyPayload, latest] = await Promise.all([getJson(`${coffeeApi}/history?days=180`), getJson(coffeeApi)])
const rows = new Map()
try {
  const [existingHeader, ...lines] = (await readFile(output, 'utf8')).trim().split('\n')
  for (const line of lines) {
    const values = line.split(',')
    if (existingHeader === header) {
      const [date, arabicaUsd, robustaUsd, usdInr, arabicaInr, robustaInr, source] = values
      rows.set(date, { date, arabicaUsd: Number(arabicaUsd), robustaUsd: Number(robustaUsd), usdInr: Number(usdInr), arabicaInr: Number(arabicaInr), robustaInr: Number(robustaInr), source })
    } else {
      const [date, arabicaUsd, robustaUsd, source] = values
      rows.set(date, { date, arabicaUsd: Number(arabicaUsd), robustaUsd: Number(robustaUsd), source })
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const addQuote = (date, arabicaUsd, robustaUsd) => {
  if (!date || arabicaUsd == null || robustaUsd == null) return
  rows.set(date, { ...rows.get(date), date, arabicaUsd: Number(arabicaUsd), robustaUsd: Number(robustaUsd), source: 'Buon Ma Thuot Coffee API' })
}
for (const item of Array.isArray(historyPayload.data) ? historyPayload.data : []) addQuote(item.date, item.ice_arabica_usd_lb, item.ice_robusta_usd_tonne)
addQuote(latest.timestamp?.slice(0, 10), latest.ice_arabica?.value, latest.ice_robusta?.value)
for (const row of rows.values()) {
  if (!Number.isFinite(row.usdInr) || row.usdInr <= 0) {
    const exchange = await getJson(`https://api.frankfurter.dev/v1/${row.date}?base=USD&symbols=INR`)
    row.usdInr = Number(exchange.rates?.INR)
  }
  if (!Number.isFinite(row.usdInr) || row.usdInr <= 0) throw new Error(`USD/INR conversion was unavailable for ${row.date}`)
  row.arabicaInr = row.arabicaUsd * row.usdInr * 2.20462262185
  row.robustaInr = row.robustaUsd * row.usdInr / 1000
}
const lines = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => [row.date, row.arabicaUsd, row.robustaUsd, row.usdInr.toFixed(4), row.arabicaInr.toFixed(2), row.robustaInr.toFixed(2), row.source].join(','))
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${header}\n${lines.join('\n')}\n`)
console.log(`Cached ${lines.length} observations; newest trading-day quote: ${latest.timestamp?.slice(0, 10) ?? 'unknown'}`)
