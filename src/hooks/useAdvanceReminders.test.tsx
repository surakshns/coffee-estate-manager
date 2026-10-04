// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderStatus } from '../lib/advanceReminders'
import { ReminderSetupError } from '../lib/advanceReminders'
import { useAdvanceReminders } from './useAdvanceReminders'

const client = vi.hoisted(() => ({ request: vi.fn(), subscription: vi.fn(), connect: vi.fn(), permission: vi.fn(), support: vi.fn(), readPreference: vi.fn(), savePreference: vi.fn(), requestPermission: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
vi.mock('../lib/advanceReminders', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/advanceReminders')>(),
  reminderRequest: client.request,
  currentPushSubscription: client.subscription,
  connectPushDevice: client.connect,
  notificationPermission: client.permission,
  notificationSupport: client.support,
  readReminderPreference: client.readPreference,
  saveReminderPreference: client.savePreference,
}))

const publicKey = btoa(String.fromCharCode(4, ...Array<number>(64).fill(1))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const status = (overrides: Partial<ReminderStatus> = {}): ReminderStatus => ({
  ready: true,
  settings: { enabled: false, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' },
  vapidPublicKey: publicKey,
  subscribed: false,
  subscriptionCount: 0,
  weekStart: '2026-09-30',
  weekStatus: 'not_saved',
  ...overrides,
})
const pushSubscription = (endpoint = 'https://push.example/device-a') => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: vi.fn(async () => true) })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.support.mockReturnValue('supported')
  client.permission.mockReturnValue('granted')
  client.requestPermission.mockResolvedValue('granted')
  client.readPreference.mockReturnValue({ enabled: false, weekday: 3, time: '20:00' })
  client.subscription.mockResolvedValue(null)
  client.connect.mockResolvedValue(pushSubscription())
  client.request.mockResolvedValue(status())
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: client.requestPermission })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('advance reminder controller', () => {
  it('subscribes this phone before configuring the shared account schedule and trusts the returned device status', async () => {
    const subscription = pushSubscription()
    client.connect.mockResolvedValue(subscription)
    client.request.mockImplementation(async body => body.action === 'configure'
      ? status({ settings: { enabled: true, weekday: 5, time: '21:30', timezone: 'Asia/Kolkata' }, subscribed: true, subscriptionCount: 2 })
      : body.action === 'subscribe' ? { subscribed: true } : status())
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await result.current.save({ enabled: true, weekday: 5, time: '21:30' }) })
    expect(client.request.mock.calls.map(call => call[0].action)).toEqual(['status', 'subscribe', 'configure'])
    expect(client.request).toHaveBeenLastCalledWith({ action: 'configure', enabled: true, weekday: 5, time: '21:30', endpoint: subscription.endpoint })
    expect(result.current.deviceSubscribed).toBe(true)
    expect(result.current.settings).toEqual({ enabled: true, weekday: 5, time: '21:30' })
    expect(result.current.status?.subscriptionCount).toBe(2)
  })

  it('does not configure the account or subscribe when phone permission is refused', async () => {
    client.requestPermission.mockResolvedValue('denied')
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    let failure: unknown
    await act(async () => { try { await result.current.save({ enabled: true, weekday: 3, time: '20:00' }) } catch (cause) { failure = cause } })
    expect(failure).toBeInstanceOf(Error)
    expect(result.current.error).toMatch(/blocked/i)
    expect(result.current.saving).toBe(false)
    expect(result.current.permission).toBe('denied')
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.request.mock.calls.map(call => call[0].action)).toEqual(['status'])
  })

  it('stores a local disabled schedule while delivery is undeployed and never claims this phone is connected', async () => {
    client.request.mockRejectedValue(new ReminderSetupError('Reminder delivery has not been set up yet.'))
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.message).toMatch(/needs setup/i))
    await act(async () => { await result.current.save({ enabled: false, weekday: 6, time: '19:15' }) })
    expect(client.savePreference).toHaveBeenCalledWith('owner', { enabled: false, weekday: 6, time: '19:15' })
    expect(result.current.settings).toEqual({ enabled: false, weekday: 6, time: '19:15' })
    expect(result.current.ready).toBe(false)
    expect(result.current.deviceSubscribed).toBe(false)
    expect(result.current.message).toMatch(/on this device.*needs setup/i)
    expect(client.requestPermission).not.toHaveBeenCalled()
  })

  it('does not turn a network failure into local saved settings or verified enabled status', async () => {
    client.readPreference.mockReturnValue({ enabled: true, weekday: 3, time: '20:00' })
    client.request.mockRejectedValue(new Error('Unable to connect'))
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.error).toBe('Unable to connect'))
    let failure: unknown
    await act(async () => { try { await result.current.save({ enabled: false, weekday: 1, time: '18:30' }) } catch (cause) { failure = cause } })
    expect(failure).toBeInstanceOf(Error)
    expect(client.savePreference).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
    expect(result.current.deviceSubscribed).toBe(false)
  })

  it('clears previously verified status when a later refresh cannot reach the server', async () => {
    client.request.mockResolvedValue(status({ settings: { enabled: true, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' }, subscribed: true, subscriptionCount: 1, weekStatus: 'complete' }))
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.deviceSubscribed).toBe(true))
    client.request.mockRejectedValue(new Error('Unable to connect'))
    await act(async () => { await result.current.refreshStatus() })
    expect(result.current.ready).toBe(false)
    expect(result.current.deviceSubscribed).toBe(false)
    expect(result.current.status).toBeNull()
    expect(result.current.error).toBe('Unable to connect')
  })

  it('does not promise phone notifications when configure returns subscribed false', async () => {
    client.request.mockImplementation(async body => body.action === 'configure'
      ? status({ settings: { enabled: true, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' }, subscribed: false })
      : body.action === 'subscribe' ? { subscribed: true } : status())
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await result.current.save({ enabled: true, weekday: 3, time: '20:00' }).catch(() => undefined) })
    expect(result.current.deviceSubscribed).toBe(false)
    expect(result.current.message).not.toMatch(/this phone will be notified/i)
  })

  it('does not send an old account configure after switching accounts during subscription registration', async () => {
    const registered = deferred<{ subscribed: boolean }>()
    client.request.mockImplementation(async body => body.action === 'subscribe' ? registered.promise : status())
    const { result, rerender } = renderHook(({ owner }) => useAdvanceReminders(owner), { initialProps: { owner: 'owner-a' } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    let saved!: Promise<unknown>
    act(() => { saved = result.current.save({ enabled: true, weekday: 4, time: '22:00' }).catch(cause => cause) })
    await waitFor(() => expect(client.request.mock.calls.some(call => call[0].action === 'subscribe')).toBe(true))
    rerender({ owner: 'owner-b' })
    await act(async () => { registered.resolve({ subscribed: true }); await saved })
    expect(client.request.mock.calls.some(call => call[0].action === 'configure')).toBe(false)
    expect(client.savePreference.mock.calls.some(call => call[0] === 'owner-b' && call[1].enabled)).toBe(false)
  })

  it('loads the next account immediately even while the previous account save is still pending', async () => {
    const registered = deferred<{ subscribed: boolean }>()
    let currentOwner = 'owner-a'
    client.request.mockImplementation(async body => body.action === 'subscribe' ? registered.promise : status({ settings: { enabled: false, weekday: currentOwner === 'owner-b' ? 6 : 3, time: '20:00', timezone: 'Asia/Kolkata' } }))
    const { result, rerender } = renderHook(({ owner }) => useAdvanceReminders(owner), { initialProps: { owner: currentOwner } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    let saved!: Promise<unknown>
    act(() => { saved = result.current.save({ enabled: true, weekday: 4, time: '22:00' }).catch(cause => cause) })
    await waitFor(() => expect(client.request.mock.calls.some(call => call[0].action === 'subscribe')).toBe(true))
    currentOwner = 'owner-b'
    rerender({ owner: currentOwner })
    try {
      await waitFor(() => expect(result.current.settings.weekday).toBe(6))
      expect(result.current.ready).toBe(true)
      expect(result.current.saving).toBe(false)
    } finally {
      await act(async () => { registered.resolve({ subscribed: true }); await saved })
    }
  })

  it('ignores a late status response after logout instead of restoring enabled cached settings', async () => {
    const pending = deferred<ReminderStatus>()
    client.readPreference.mockReturnValue({ enabled: true, weekday: 1, time: '19:00' })
    client.request.mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(({ owner }) => useAdvanceReminders(owner), { initialProps: { owner: 'owner' as string | null } })
    await waitFor(() => expect(client.request).toHaveBeenCalled())
    rerender({ owner: null })
    await act(async () => { pending.resolve(status({ settings: { enabled: true, weekday: 1, time: '19:00', timezone: 'Asia/Kolkata' }, subscribed: true, subscriptionCount: 1 })); await pending.promise })
    expect(result.current.ready).toBe(false)
    expect(result.current.deviceSubscribed).toBe(false)
    expect(result.current.settings.enabled).toBe(false)
    expect(result.current.status).toBeNull()
    expect(client.savePreference).not.toHaveBeenCalled()
  })

  it('does not clear the next account connection when an earlier disconnect finishes', async () => {
    const unsubscribed = deferred<{ unsubscribed: boolean }>()
    let currentSubscription = pushSubscription()
    client.subscription.mockImplementation(async () => currentSubscription)
    client.request.mockImplementation(async body => body.action === 'unsubscribe' ? unsubscribed.promise : status({ subscribed: true, subscriptionCount: 1 }))
    const { result, rerender } = renderHook(({ owner }) => useAdvanceReminders(owner), { initialProps: { owner: 'owner-a' } })
    await waitFor(() => expect(result.current.deviceSubscribed).toBe(true))
    let disconnected!: Promise<void>
    act(() => { disconnected = result.current.disconnectDevice() })
    await waitFor(() => expect(client.request.mock.calls.some(call => call[0].action === 'unsubscribe')).toBe(true))
    currentSubscription = pushSubscription('https://push.example/device-b')
    rerender({ owner: 'owner-b' })
    await waitFor(() => expect(result.current.deviceSubscribed).toBe(true))
    await act(async () => { unsubscribed.resolve({ unsubscribed: true }); await disconnected })
    expect(result.current.deviceSubscribed).toBe(true)
    expect(currentSubscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('releases an invalidated pending operation when this account disconnects', async () => {
    const permission = deferred<NotificationPermission>()
    client.requestPermission.mockReturnValue(permission.promise)
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    let saved!: Promise<unknown>
    act(() => { saved = result.current.save({ enabled: true, weekday: 3, time: '20:00' }).catch(cause => cause) })
    await waitFor(() => expect(result.current.saving).toBe(true))
    await act(async () => { await result.current.disconnectDevice() })
    await act(async () => { permission.resolve('granted'); await saved })
    expect(result.current.saving).toBe(false)
    const before = client.request.mock.calls.length
    await act(async () => { await result.current.refreshStatus() })
    expect(client.request.mock.calls.length).toBe(before + 1)
  })

  it('marks this phone disconnected when its local subscription disappears before a test', async () => {
    client.subscription.mockResolvedValue(pushSubscription())
    client.request.mockResolvedValue(status({ settings: { enabled: true, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' }, subscribed: true, subscriptionCount: 1 }))
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.deviceSubscribed).toBe(true))
    client.subscription.mockResolvedValue(null)
    await act(async () => { await result.current.test().catch(() => undefined) })
    expect(result.current.error).toMatch(/no longer connected/i)
    expect(result.current.deviceSubscribed).toBe(false)
    expect(result.current.testing).toBe(false)
    expect(client.request.mock.calls.some(call => call[0].action === 'test')).toBe(false)
  })

  it('tests only this phone endpoint and reports acceptance without claiming delivery', async () => {
    const subscription = pushSubscription()
    client.subscription.mockResolvedValue(subscription)
    client.request.mockImplementation(async body => body.action === 'test' ? { sent: true } : status({ settings: { enabled: true, weekday: 3, time: '20:00', timezone: 'Asia/Kolkata' }, subscribed: true, subscriptionCount: 2 }))
    const { result } = renderHook(() => useAdvanceReminders('owner'))
    await waitFor(() => expect(result.current.deviceSubscribed).toBe(true))
    await act(async () => { await result.current.test() })
    expect(client.request).toHaveBeenLastCalledWith({ action: 'test', endpoint: subscription.endpoint })
    expect(result.current.message).toMatch(/accepted for delivery/i)
    expect(result.current.message).not.toMatch(/delivered|received/i)
    expect(result.current.testing).toBe(false)
  })
})
