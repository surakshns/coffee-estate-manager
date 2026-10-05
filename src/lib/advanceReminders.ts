import { supabase } from './supabase'

export type ReminderSchedule = { enabled: boolean; weekday: number; time: string }
export type AdvanceWeekStatus = 'complete' | 'needs_review' | 'not_saved' | 'no_workers'
export type ReminderStatus = {
  ready: boolean
  settings: ReminderSchedule & { timezone: 'Asia/Kolkata' }
  vapidPublicKey: string | null
  subscribed: boolean
  subscriptionCount: number
  weekStart: string
  weekStatus: AdvanceWeekStatus
  setupMessage?: string
  settingsStorageReady?: boolean
}
export const defaultReminderSchedule: ReminderSchedule = { enabled: false, weekday: 3, time: '20:00' }

export function validReminderSchedule(value: unknown): value is ReminderSchedule {
  if (!value || typeof value !== 'object') return false
  const schedule = value as ReminderSchedule
  return typeof schedule.enabled === 'boolean' && Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
}

export function validAdvanceWeek(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 3
}

export function reminderScheduleLabel(schedule: ReminderSchedule): string {
  if (!validReminderSchedule(schedule)) return 'Choose a day and time'
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][schedule.weekday]
  const [hour, minute] = schedule.time.split(':').map(Number)
  return `${day} · ${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function advanceWeekFromUrl(url: string, appUrl: string): string | null {
  try {
    const target = new URL(url, appUrl)
    const app = new URL(appUrl)
    if (target.origin !== app.origin || target.pathname !== app.pathname) return null
    const week = target.searchParams.get('advanceWeek')
    return validAdvanceWeek(week) ? week : null
  } catch { return null }
}

export class ReminderSetupError extends Error {}

async function reminderFunctionMissing(): Promise<boolean> {
  const origin = import.meta.env.VITE_SUPABASE_URL
  if (!origin) return false
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 3500)
  try {
    // An undeployed Edge Function rejects the authenticated JSON preflight. The
    // browser reports that as a network error, hiding its 404. This simple GET
    // needs no preflight and never sends session headers, keys or cookies.
    const response = await fetch(`${origin.replace(/\/$/, '')}/functions/v1/estate-reminders`, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal })
    if (response.status !== 404) return false
    if (response.headers.get('sb-error-code') === 'NOT_FOUND') return true
    const body = await response.json() as { code?: string }
    return body.code === 'NOT_FOUND'
  } catch { return false }
  finally { window.clearTimeout(timer) }
}

export async function reminderRequest<T = ReminderStatus>(body: Record<string, unknown>): Promise<T> {
  if (!supabase.functions?.invoke) throw new ReminderSetupError('Reminder delivery has not been set up yet.')
  const { data, error } = await supabase.functions.invoke('estate-reminders', { body, timeout: 15000 })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context?.status === 404) throw new ReminderSetupError('Reminder delivery has not been set up yet.')
    if (error.name === 'FunctionsFetchError' && await reminderFunctionMissing()) throw new ReminderSetupError('Reminder delivery has not been set up yet.')
    let detail = ''
    if (context && typeof context.clone === 'function') {
      try {
        const payload = await context.clone().json() as { error?: string; code?: string }
        if (payload.code === 'REMINDER_SETUP_REQUIRED') throw new ReminderSetupError(payload.error || 'Reminder delivery has not been set up yet.')
        if (typeof payload.error === 'string') detail = payload.error
      } catch (cause) {
        if (cause instanceof ReminderSetupError) throw cause
        /* Keep the actionable fallback below when response content is unavailable. */
      }
    }
    throw new Error(detail || 'Could not connect to reminder settings. Check your connection and try again.')
  }
  if (!data || typeof data !== 'object') throw new Error('Could not read reminder settings. Please try again.')
  return data as T
}

export function checkReminderStatus(value: ReminderStatus): ReminderStatus {
  if (!value || !validReminderSchedule(value.settings) || value.settings.timezone !== 'Asia/Kolkata' || typeof value.ready !== 'boolean' || typeof value.subscribed !== 'boolean' || !Number.isInteger(value.subscriptionCount) || value.subscriptionCount < 0 || !validAdvanceWeek(value.weekStart) || !['complete', 'needs_review', 'not_saved', 'no_workers'].includes(value.weekStatus) || (value.vapidPublicKey !== null && typeof value.vapidPublicKey !== 'string') || (value.ready && !value.vapidPublicKey)) {
    throw new Error('Could not read reminder settings. Please try again.')
  }
  return value
}

export function notificationSupport(): 'supported' | 'unsupported' {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window ? 'supported' : 'unsupported'
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default'
}

export function applicationUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration(applicationUrl())
  return registration?.pushManager ? registration.pushManager.getSubscription() : null
}

export function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  const key = Uint8Array.from(decoded, char => char.charCodeAt(0))
  if (key.length !== 65 || key[0] !== 4) throw new Error('Notification setup needs a valid public key.')
  return key
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(new URL('sw.js', applicationUrl()).href, { scope: applicationUrl() })
  // An older installed worker can still be active while the push-capable update
  // installs. Wait for that update before connecting notifications.
  if (registration.active && !registration.installing && !registration.waiting) return registration
  await new Promise<void>((resolve, reject) => {
    const worker = registration.installing || registration.waiting
    if (!worker) { reject(new Error('Could not start notifications. Reload the app and try again.')); return }
    const timer = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Notifications took too long to start. Reload the app and try again.')) }, 15000)
    function changed() {
      if (worker?.state === 'activated') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve() }
      if (worker?.state === 'redundant') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('Could not start notifications. Reload the app and try again.')) }
    }
    worker.addEventListener('statechange', changed)
    changed()
  })
  return registration
}

export async function connectPushDevice(publicKey: string): Promise<PushSubscription> {
  const registration = await activeRegistration()
  const key = decodeVapidKey(publicKey)
  let subscription = await registration.pushManager.getSubscription()
  // A changed server key requires a fresh subscription.
  const previousKey = subscription?.options.applicationServerKey
  if (subscription && previousKey && !Array.from(new Uint8Array(previousKey)).every((byte, index) => byte === key[index])) {
    await subscription.unsubscribe()
    subscription = null
  }
  return subscription ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

const preferenceKey = (userId: string) => `coffee-estate-advance-reminder:${userId}`
export function readReminderPreference(userId: string): ReminderSchedule {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey(userId)) || 'null')
    return validReminderSchedule(value) ? value : { ...defaultReminderSchedule }
  } catch { return { ...defaultReminderSchedule } }
}
export function saveReminderPreference(userId: string, schedule: ReminderSchedule): boolean {
  try { localStorage.setItem(preferenceKey(userId), JSON.stringify(schedule)); return true }
  catch { return false }
}
