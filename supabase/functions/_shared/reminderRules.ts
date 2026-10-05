export const DEFAULT_REMINDER = { enabled: false, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' as const }

export type ReminderSettings = { enabled: boolean; weekday: number; time: string; timezone: 'Asia/Kolkata' }
export type StoredSubscription = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime: number | null }

export function indiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function latestWednesday(date = indiaToday()) {
  const day = new Date(`${date}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 4) % 7)
  return day.toISOString().slice(0, 10)
}

export function readSchedule(input: Record<string, unknown>): ReminderSettings {
  if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.weekday) || Number(input.weekday) < 0 || Number(input.weekday) > 6 || typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    throw new Error('Choose a valid reminder day and time.')
  }
  if (input.timezone !== undefined && input.timezone !== 'Asia/Kolkata') throw new Error('Reminder times use India time.')
  return { enabled: input.enabled, weekday: Number(input.weekday), time: input.time, timezone: 'Asia/Kolkata' }
}

function decodeKey(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

// Never send a server request to a URL supplied by the client without checking
// it is an actual supported push service. HTTPS alone does not prevent SSRF.
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false
  try {
    const url = new URL(endpoint)
    const host = url.hostname.toLowerCase()
    const supported = /^fcm(?:-[a-z0-9]+)?\.googleapis\.com$/.test(host)
      || host === 'updates.push.services.mozilla.com' || host === 'push.services.mozilla.com'
      || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
      || host.endsWith('.notify.windows.com')
    return supported && url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443')
  } catch { return false }
}

export function readSubscription(input: unknown, now = Date.now()): StoredSubscription {
  if (!input || typeof input !== 'object') throw new Error('This phone did not provide a valid notification subscription.')
  const value = input as Record<string, unknown>
  const keys = value.keys as Record<string, unknown> | undefined
  if (!isPushEndpoint(value.endpoint) || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new Error('This phone did not provide a valid notification subscription.')
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth)) throw new Error('Notification subscription keys are invalid.')
  try {
    const publicKey = decodeKey(keys.p256dh)
    if (publicKey.length !== 65 || publicKey[0] !== 4 || decodeKey(keys.auth).length !== 16) throw new Error()
  } catch { throw new Error('Notification subscription keys are invalid.') }
  const expiration = value.expirationTime
  if (expiration !== undefined && expiration !== null && (typeof expiration !== 'number' || !Number.isFinite(expiration) || expiration <= now)) throw new Error('This phone’s notification subscription has expired.')
  return { endpoint: value.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, expirationTime: typeof expiration === 'number' ? expiration : null }
}

export function notificationPayload(appUrl: string, weekStart: string) {
  const url = new URL(appUrl)
  url.searchParams.set('advanceWeek', weekStart)
  return {
    title: 'Weekly advance reminder',
    body: 'Your weekly payment still needs saving. Tap to finish it.',
    tag: `advance-${weekStart}`,
    data: { weekStart, url: url.href }
  }
}

export function rescheduledNotificationPayload(appUrl: string, weekStart: string, settings: ReminderSettings) {
  const payload = notificationPayload(appUrl, weekStart)
  const [hour, minute] = settings.time.split(':').map(Number)
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings.weekday]
  return {
    ...payload,
    title: 'Weekly reminder rescheduled',
    body: `Reminder moved to ${day} at ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'} IST. Repeats daily until the weekly payment is saved.`,
    tag: 'advance-schedule',
    data: { ...payload.data, kind: 'rescheduled', weekday: settings.weekday, time: settings.time }
  }
}

export type DeliveryLedger = { status: string; kind: 'payment' | 'rescheduled'; scheduled_at: string; settings_revision: number }

// Shared with the sender so saves, disables, edits and new connections are
// checked again after a database claim, immediately before the push request.
export function canSendReminder(
  settings: { enabled: boolean; revision: number; updated_at: string } | null,
  ledger: DeliveryLedger | null,
  subscription: { connected_at: string; expiration_time: string | null } | null,
  complete: boolean,
  eligibleWorkers: boolean,
  now = Date.now()
) {
  if (!settings?.enabled || !ledger || ledger.status !== 'sending' || !subscription || settings.revision !== ledger.settings_revision) return false
  const due = Date.parse(ledger.scheduled_at)
  if (!(due <= now && now < due + 3600000) || !(Date.parse(settings.updated_at) <= due) || !(Date.parse(subscription.connected_at) <= due)) return false
  if (subscription.expiration_time && !(Date.parse(subscription.expiration_time) > now)) return false
  return ledger.kind === 'rescheduled' || (ledger.kind === 'payment' && !complete && eligibleWorkers)
}

export function deliveryResult(httpStatus?: number): 'sent' | 'retry' | 'expired' | 'uncertain' {
  if (httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300) return 'sent'
  if (httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600)) return 'retry'
  if (httpStatus === undefined) return 'uncertain'
  return 'expired'
}
