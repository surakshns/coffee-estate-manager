import { useCallback, useEffect, useRef, useState } from 'react'
import { checkReminderStatus, connectPushDevice, currentPushSubscription, defaultReminderSchedule, notificationPermission, notificationSupport, readReminderPreference, reminderRequest, ReminderSetupError, saveReminderPreference, validReminderSchedule, type ReminderSchedule, type ReminderStatus } from '../lib/advanceReminders'

type State = {
  settings: ReminderSchedule
  loading: boolean
  saving: boolean
  ready: boolean
  deviceSubscribed: boolean
  permission: NotificationPermission
  support: 'supported' | 'unsupported'
  message: string
  error: string
  status: ReminderStatus | null
}
const initialState = (): State => ({ settings: { ...defaultReminderSchedule }, loading: false, saving: false, ready: false, deviceSubscribed: false, permission: notificationPermission(), support: notificationSupport(), message: '', error: '', status: null })

export function useAdvanceReminders(userId: string | null, recordsKey?: unknown) {
  const [state, setState] = useState<State>(initialState)
  const account = useRef(userId)
  const generation = useRef(0)
  const working = useRef(false)
  const endpoint = useRef<string | null>(null)
  const setupMissing = useRef(false)
  const lastUser = useRef<string | null>(null)
  account.current = userId

  const applyStatus = useCallback((status: ReminderStatus, owner: string) => {
    checkReminderStatus(status)
    if (account.current !== owner) return
    setupMissing.current = status.settingsStorageReady === false
    saveReminderPreference(owner, status.settings)
    setState(previous => ({ ...previous, settings: { enabled: status.settings.enabled, weekday: status.settings.weekday, time: status.settings.time }, ready: status.ready, deviceSubscribed: status.subscribed, status, loading: false, permission: notificationPermission(), support: notificationSupport(), error: '', message: status.ready ? '' : status.setupMessage || 'Schedule saved. Reminder delivery still needs setup.' }))
  }, [])

  const refreshStatus = useCallback(async () => {
    if (!userId || working.current) return
    const sequence = ++generation.current
    setState(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const subscription = await currentPushSubscription().catch(() => null)
      const status = checkReminderStatus(await reminderRequest({ action: 'status', ...(subscription ? { endpoint: subscription.endpoint } : {}) }))
      if (sequence !== generation.current || account.current !== userId) return
      endpoint.current = subscription?.endpoint ?? null
      applyStatus(status, userId)
    } catch (cause) {
      if (sequence !== generation.current || account.current !== userId) return
      const missing = cause instanceof ReminderSetupError
      setupMissing.current = missing
      setState(previous => ({ ...previous, loading: false, ready: false, deviceSubscribed: false, status: null, permission: notificationPermission(), support: notificationSupport(), error: missing ? '' : cause instanceof Error ? cause.message : 'Could not check reminder settings.', message: missing ? 'Reminder delivery needs setup. You can still choose and save your preferred day and time on this device.' : '' }))
    }
  }, [userId, applyStatus])

  useEffect(() => {
    if (lastUser.current !== userId) {
      generation.current++
      working.current = false
      endpoint.current = null
      setupMissing.current = false
      lastUser.current = userId
      setState({ ...initialState(), settings: userId ? readReminderPreference(userId) : { ...defaultReminderSchedule } })
    }
    if (userId) void refreshStatus()
  }, [userId, recordsKey, refreshStatus])

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refreshStatus() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [refreshStatus])

  async function save(schedule: ReminderSchedule) {
    if (!userId || working.current) throw new Error('Please wait and try again.')
    if (!validReminderSchedule(schedule)) throw new Error('Choose a valid day and time.')
    if (schedule.enabled && !state.ready) throw new Error('Reminder delivery needs setup before it can be enabled.')
    if (schedule.enabled && notificationSupport() !== 'supported') throw new Error('Open the installed app on iPhone, or use a browser that supports notifications.')
    // Keep permission requests directly attached to this user gesture.
    const permissionRequest = schedule.enabled ? Notification.requestPermission() : null
    working.current = true
    const sequence = ++generation.current
    const isCurrent = () => account.current === userId && generation.current === sequence
    setState(previous => ({ ...previous, saving: true, error: '', message: '' }))
    try {
      if (setupMissing.current && !state.settings.enabled && !schedule.enabled) {
        if (saveReminderPreference(userId, schedule) === false) throw new Error('This phone could not save the schedule. Allow site storage in your browser settings and try again.')
        setState(previous => ({ ...previous, settings: { ...schedule }, ready: false, error: '', message: 'Preferred schedule saved on this device. Reminder delivery still needs setup.' }))
        return
      }
      if (permissionRequest) {
        const permission = await permissionRequest
        if (!isCurrent()) throw new Error('Your account changed. Reopen reminder settings.')
        setState(previous => ({ ...previous, permission }))
        if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow them in your phone or browser settings, then try again.' : 'Allow notifications to enable reminders on this phone.')
        const publicKey = state.status?.vapidPublicKey
        if (!publicKey) throw new Error('Notification setup is not ready. Please try again later.')
        const subscription = await connectPushDevice(publicKey)
        if (!isCurrent()) throw new Error('Your account changed. Reopen reminder settings.')
        endpoint.current = subscription.endpoint
        await reminderRequest({ action: 'subscribe', subscription: subscription.toJSON() })
      }
      if (!isCurrent()) throw new Error('Your account changed. Reopen reminder settings.')
      let status: ReminderStatus
      try {
        status = checkReminderStatus(await reminderRequest({ action: 'configure', ...schedule, ...(endpoint.current ? { endpoint: endpoint.current } : {}) }))
      } catch (cause) {
        if (!(cause instanceof ReminderSetupError) || !setupMissing.current || state.settings.enabled || schedule.enabled) throw cause
        if (!isCurrent()) throw new Error('Your account changed. Reopen reminder settings.')
        if (saveReminderPreference(userId, schedule) === false) throw new Error('This phone could not save the schedule. Allow site storage in your browser settings and try again.')
        setState(previous => ({ ...previous, settings: { ...schedule }, ready: false, error: '', message: 'Preferred schedule saved on this device. Reminder delivery still needs setup.' }))
        return
      }
      if (!isCurrent()) throw new Error('Your account changed. Reopen reminder settings.')
      applyStatus(status, userId)
      setState(previous => ({ ...previous, message: status.ready ? schedule.enabled ? status.subscribed ? 'Reminder saved. This phone will be notified daily at the selected time until the full weekly payment is saved.' : 'Account reminder saved. This phone still needs to be connected.' : 'Weekly reminders are turned off for your account.' : 'Schedule saved. Reminder delivery still needs setup.' }))
    } catch (cause) {
      if (isCurrent()) setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Could not save reminder settings.' }))
      throw cause
    } finally {
      if (isCurrent()) { working.current = false; setState(previous => ({ ...previous, saving: false })) }
    }
  }

  async function disconnectDevice() {
    const sequence = ++generation.current
    const owner = userId
    const isCurrent = () => account.current === owner && generation.current === sequence
    working.current = false
    setState(previous => ({ ...previous, saving: false }))
    const subscription = await currentPushSubscription().catch(() => null)
    if (!subscription || !isCurrent()) return
    if (userId) {
      try { await reminderRequest({ action: 'unsubscribe', endpoint: subscription.endpoint }) } catch { /* Signing out must still work offline. */ }
    }
    if (!isCurrent()) return
    await subscription.unsubscribe().catch(() => false)
    if (!isCurrent()) return
    endpoint.current = null
    setState(previous => ({ ...previous, deviceSubscribed: false }))
  }

  return { ...state, save, refreshStatus, disconnectDevice }
}
