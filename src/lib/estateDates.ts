/** Calendar dates for estate work always follow India time, regardless of the device. */
export function estateToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** A pay week begins on Wednesday; use the latest Wednesday, including today. */
export function currentAdvanceWeek(now = new Date()) {
  const date = new Date(`${estateToday(now)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 4) % 7)
  return date.toISOString().slice(0, 10)
}
