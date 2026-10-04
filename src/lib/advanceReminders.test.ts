// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceWeekFromUrl, checkReminderStatus, connectPushDevice, currentPushSubscription, decodeVapidKey, readReminderPreference, reminderRequest, ReminderSetupError, saveReminderPreference, validAdvanceWeek, validReminderSchedule, type ReminderStatus } from './advanceReminders'

const api = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: api.invoke } } }))

const key = (byte = 1) => btoa(String.fromCharCode(4, ...Array<number>(64).fill(byte))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const status = (): ReminderStatus => ({ ready: true, settings: { enabled: false, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' }, vapidPublicKey: key(), subscribed: false, subscriptionCount: 0, weekStart: '2026-09-30', weekStatus: 'not_saved' })
const appUrl = 'https://estate.example/coffee-estate-manager/'

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('reminder client validation and setup', () => {
  it('accepts valid editable schedule boundaries and rejects malformed schedules', () => {
    expect(validReminderSchedule({ enabled: false, weekday: 0, time: '00:00' })).toBe(true)
    expect(validReminderSchedule({ enabled: true, weekday: 6, time: '23:59' })).toBe(true)
    for (const invalid of [null, {}, { enabled: 'yes', weekday: 3, time: '20:00' }, { enabled: true, weekday: -1, time: '20:00' }, { enabled: true, weekday: 7, time: '20:00' }, { enabled: true, weekday: 3.5, time: '20:00' }, { enabled: true, weekday: 3, time: '24:00' }, { enabled: true, weekday: 3, time: '8:00 PM' }]) {
      expect(validReminderSchedule(invalid)).toBe(false)
    }
  })

  it('accepts exact Wednesday links in this installation and rejects wrong dates, paths and origins', () => {
    expect(validAdvanceWeek('2025-12-31')).toBe(true)
    expect(validAdvanceWeek('2026-02-30')).toBe(false)
    expect(validAdvanceWeek('2026-10-05')).toBe(false)
    expect(advanceWeekFromUrl('?advanceWeek=2025-12-31', appUrl)).toBe('2025-12-31')
    expect(advanceWeekFromUrl('https://other.example/coffee-estate-manager/?advanceWeek=2025-12-31', appUrl)).toBeNull()
    expect(advanceWeekFromUrl('/another-app/?advanceWeek=2025-12-31', appUrl)).toBeNull()
    expect(advanceWeekFromUrl('?advanceWeek=2026-10-05', appUrl)).toBeNull()
    expect(advanceWeekFromUrl('?advanceWeek=2026-02-30', appUrl)).toBeNull()
  })

  it('distinguishes an undeployed endpoint from a network failure or server rejection', async () => {
    api.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response('', { status: 404 }) } })
    await expect(reminderRequest({ action: 'status' })).rejects.toBeInstanceOf(ReminderSetupError)
    api.invoke.mockResolvedValueOnce({ data: null, error: new Error('Fetch failed') })
    await expect(reminderRequest({ action: 'status' })).rejects.toThrow(/check your connection/i)
    api.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ error: 'The device subscription is invalid.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) } })
    await expect(reminderRequest({ action: 'subscribe' })).rejects.toThrow('The device subscription is invalid.')
    expect(api.invoke).toHaveBeenCalledWith('estate-reminders', expect.objectContaining({ body: { action: 'subscribe' } }))
  })

  it('rejects invalid server metadata with a readable validation error', () => {
    expect(checkReminderStatus(status())).toEqual(status())
    const malformed: unknown[] = [
      { ...status(), settings: null },
      { ...status(), settings: { ...status().settings, timezone: 'UTC' } },
      { ...status(), subscribed: 'yes' },
      { ...status(), subscriptionCount: -1 },
      { ...status(), subscriptionCount: 1.5 },
      { ...status(), subscriptionCount: null },
      { ...status(), vapidPublicKey: { key: 'unexpected' } },
      { ...status(), weekStart: '2026-10-05' },
      { ...status(), weekStatus: 'paid' },
    ]
    for (const value of malformed) expect(() => checkReminderStatus(value as ReminderStatus)).toThrow(/Could not read reminder settings/)
  })

  it('accepts configured schedule storage when delivery is not yet ready', () => {
    const value = { ...status(), ready: false, vapidPublicKey: null, setupMessage: 'Notification service needs setup.' }
    expect(checkReminderStatus(value)).toEqual(value)
  })

  it('keeps preferences separate per account and falls back safely from corrupt local storage', () => {
    saveReminderPreference('owner-a', { enabled: false, weekday: 1, time: '18:30' })
    saveReminderPreference('owner-b', { enabled: true, weekday: 6, time: '21:00' })
    expect(readReminderPreference('owner-a')).toEqual({ enabled: false, weekday: 1, time: '18:30' })
    expect(readReminderPreference('owner-b')).toEqual({ enabled: true, weekday: 6, time: '21:00' })
    expect(readReminderPreference('owner-c')).toEqual({ enabled: false, weekday: 3, time: '20:00' })
    localStorage.setItem('coffee-estate-advance-reminder:owner-a', '{broken')
    expect(readReminderPreference('owner-a')).toEqual({ enabled: false, weekday: 3, time: '20:00' })
  })

  it('requires a valid uncompressed VAPID public key', () => {
    expect(Array.from(decodeVapidKey(key()))).toEqual([4, ...Array<number>(64).fill(1)])
    expect(() => decodeVapidKey(btoa('short'))).toThrow(/valid public key/)
    expect(() => decodeVapidKey(btoa(String.fromCharCode(2, ...Array<number>(64).fill(1))))).toThrow(/valid public key/)
  })
})

describe('this device push subscription', () => {
  it('looks up the subscription for this app scope without asking permission', async () => {
    const subscription = { endpoint: 'https://push.example/device' }
    const getRegistration = vi.fn(async () => ({ pushManager: { getSubscription: async () => subscription } }))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration } })
    expect(await currentPushSubscription()).toBe(subscription)
    expect(getRegistration).toHaveBeenCalledOnce()
    expect(getRegistration.mock.calls[0].length).toBe(1)
  })

  it('reuses an existing same-key subscription instead of creating duplicate device registrations', async () => {
    const subscription = { endpoint: 'https://push.example/device', options: { applicationServerKey: decodeVapidKey(key()).buffer }, unsubscribe: vi.fn() }
    const subscribe = vi.fn()
    const register = vi.fn(async () => ({ active: {}, pushManager: { getSubscription: async () => subscription, subscribe } }))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    expect(await connectPushDevice(key())).toBe(subscription)
    expect(subscribe).not.toHaveBeenCalled()
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('replaces a subscription after the server signing key changes', async () => {
    const previous = { options: { applicationServerKey: decodeVapidKey(key(1)).buffer }, unsubscribe: vi.fn(async () => true) }
    const subscription = { endpoint: 'https://push.example/new-device' }
    const subscribe = vi.fn(async () => subscription)
    const register = vi.fn(async () => ({ active: {}, pushManager: { getSubscription: async () => previous, subscribe } }))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    expect(await connectPushDevice(key(2))).toBe(subscription)
    expect(previous.unsubscribe).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(key(2)) })
  })
})
