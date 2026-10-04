import { describe, expect, it } from 'vitest'
import { DEFAULT_REMINDER, deliveryResult, indiaToday, isPushEndpoint, latestWednesday, notificationPayload, readSchedule, readSubscription } from './reminderRules'

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const subscription = { endpoint: 'https://web.push.apple.com/example', expirationTime: null, keys: { p256dh: encode(Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : 1)), auth: encode(new Uint8Array(16).fill(1)) } }

describe('advance reminder rules', () => {
  it('defaults to a disabled Wednesday 8 PM reminder in India', () => {
    expect(DEFAULT_REMINDER).toEqual({ enabled: false, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' })
  })

  it('uses India dates and the latest Wednesday across UTC midnight and year boundaries', () => {
    expect(indiaToday(new Date('2026-10-06T20:00:00Z'))).toBe('2026-10-07')
    expect(latestWednesday(indiaToday(new Date('2026-10-06T20:00:00Z')))).toBe('2026-10-07')
    expect(latestWednesday('2026-10-06')).toBe('2026-09-30')
    expect(latestWednesday('2027-01-01')).toBe('2026-12-30')
  })

  it('accepts editable day/time including Sunday and midnight without changing timezone', () => {
    expect(readSchedule({ enabled: true, weekday: 0, time: '00:00' })).toEqual({ enabled: true, weekday: 0, time: '00:00', timezone: 'Asia/Kolkata' })
    expect(readSchedule({ enabled: false, weekday: 6, time: '23:59' }).weekday).toBe(6)
    for (const invalid of [{ enabled: 'true', weekday: 3, time: '20:00' }, { enabled: true, weekday: 7, time: '20:00' }, { enabled: true, weekday: 1.5, time: '20:00' }, { enabled: true, weekday: 3, time: '24:00' }, { enabled: true, weekday: 3, time: '20:60' }, { enabled: true, weekday: 3, time: '8:00' }]) {
      expect(() => readSchedule(invalid)).toThrow()
    }
    expect(() => readSchedule({ enabled: true, weekday: 3, time: '20:00', timezone: 'UTC' })).toThrow('India time')
  })

  it('accepts both phone platforms and rejects server-side request forgery endpoints', () => {
    for (const endpoint of ['https://web.push.apple.com/abc', 'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/abc', 'https://example.notify.windows.com/abc']) expect(isPushEndpoint(endpoint)).toBe(true)
    for (const endpoint of ['http://web.push.apple.com/abc', 'https://127.0.0.1/admin', 'https://web.push.apple.com.evil.example/abc', 'https://user:password@web.push.apple.com/abc', 'https://web.push.apple.com:8443/abc', 'https://web.push.apple.com/abc#secret', 'https://evil.example/path']) expect(isPushEndpoint(endpoint)).toBe(false)
  })

  it('validates subscription keys and expiry before storing them', () => {
    expect(readSubscription(subscription)).toEqual(subscription)
    expect(() => readSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'bad-key' } })).toThrow('keys are invalid')
    expect(() => readSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: encode(new Uint8Array(65)) } })).toThrow('keys are invalid')
    expect(() => readSubscription({ ...subscription, expirationTime: 1000 }, 2000)).toThrow('expired')
    expect(readSubscription({ ...subscription, expirationTime: 3000 }, 2000).expirationTime).toBe(3000)
  })

  it('links to the exact Wednesday while preserving a hosted subdirectory and avoids sensitive notification content', () => {
    const payload = notificationPayload('https://example.com/coffee-estate-manager/', '2026-09-30')
    expect(payload.data.url).toBe('https://example.com/coffee-estate-manager/?advanceWeek=2026-09-30')
    expect(payload.data.weekStart).toBe('2026-09-30')
    expect(payload.tag).toBe('advance-2026-09-30')
    expect(Object.keys(payload)).toEqual(['title', 'body', 'tag', 'data'])
    expect(notificationPayload('https://example.com/', '2026-09-30', true).tag).toBe('advance-reminder-test')
  })

  it('retries only explicit temporary push-service rejections and never ambiguous network outcomes', () => {
    expect(deliveryResult(201)).toBe('sent')
    expect(deliveryResult(429)).toBe('retry')
    expect(deliveryResult(503)).toBe('retry')
    expect(deliveryResult(410)).toBe('expired')
    expect(deliveryResult(404)).toBe('expired')
    expect(deliveryResult(403)).toBe('expired')
    expect(deliveryResult()).toBe('uncertain')
  })
})
