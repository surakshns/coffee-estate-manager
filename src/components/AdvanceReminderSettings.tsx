import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bell, BellOff, CalendarDays, Smartphone } from 'lucide-react'
import type { ReminderSchedule } from '../lib/advanceReminders'
import { Notice, Sheet } from './Workspace'
import './advance-reminder.css'

export interface AdvanceReminderSettingsProps {
  open: boolean
  onClose: () => void
  settings: ReminderSchedule
  loading?: boolean
  saving?: boolean
  testing?: boolean
  support: 'supported' | 'unsupported'
  permission: NotificationPermission
  deviceSubscribed: boolean
  setupReady: boolean
  message?: string
  error?: string
  onSave: (schedule: ReminderSchedule) => Promise<void>
  onTest: () => Promise<void>
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const validSchedule = (schedule: ReminderSchedule) => Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
const scheduleLabel = (schedule: ReminderSchedule) => {
  if (!validSchedule(schedule)) return 'Choose a day and time'
  const [hour, minute] = schedule.time.split(':').map(Number)
  return `${weekdays[schedule.weekday]} at ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

// Unmount on close so the next opening starts with the saved account settings.
export function AdvanceReminderSettings({ open, ...props }: AdvanceReminderSettingsProps) {
  return open ? <ReminderSettingsForm {...props} /> : null
}

function ReminderSettingsForm({ onClose, settings, loading = false, saving = false, testing = false, support, permission, deviceSubscribed, setupReady, message = '', error = '', onSave, onTest }: Omit<AdvanceReminderSettingsProps, 'open'>) {
  const [draft, setDraft] = useState(() => ({ ...settings }))
  const [dirty, setDirty] = useState(false)
  const [operation, setOperation] = useState<'save' | 'connect' | 'test' | null>(null)
  const [localError, setLocalError] = useState('')
  const [localMessage, setLocalMessage] = useState('')
  const working = useRef(false)
  const guidanceId = useId()
  const busy = saving || testing || operation !== null

  useEffect(() => {
    // A fetch may refresh these props; only an untouched or accepted draft can reset.
    if (!dirty && !busy) setDraft({ enabled: settings.enabled, weekday: settings.weekday, time: settings.time })
  }, [settings.enabled, settings.weekday, settings.time, dirty, busy])

  function edit(change: Partial<ReminderSchedule>) {
    setDraft(previous => ({ ...previous, ...change }))
    setDirty(true)
    setLocalError('')
    setLocalMessage('')
  }

  async function save(schedule: ReminderSchedule, connectOnly = false) {
    if (working.current || busy || loading) return
    if (!validSchedule(schedule)) { setLocalError('Choose a valid day and time.'); return }
    working.current = true
    setOperation(connectOnly ? 'connect' : 'save')
    setLocalError(''); setLocalMessage('')
    try {
      await onSave({ ...schedule })
      if (!connectOnly) setDirty(false)
      setLocalMessage('Reminder settings saved.')
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Could not save your reminder. Please try again.')
    } finally {
      working.current = false
      setOperation(null)
    }
  }

  async function testNotification() {
    if (working.current || busy || !canTest) return
    working.current = true
    setOperation('test')
    setLocalError(''); setLocalMessage('')
    try {
      await onTest()
      setLocalMessage('Test requested. Check this phone for the notification.')
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Could not request a test notification. Please try again.')
    } finally {
      working.current = false
      setOperation(null)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(draft)
  }

  const canConnect = setupReady && support === 'supported' && permission !== 'denied' && settings.enabled && !deviceSubscribed
  const canTest = !loading && setupReady && support === 'supported' && permission === 'granted' && deviceSubscribed && settings.enabled
  const status = loading ? 'Checking reminders…'
    : !setupReady && error ? 'Unable to check reminders'
      : !setupReady ? 'Setup required'
      : permission === 'denied' ? 'Notifications blocked'
        : !settings.enabled ? 'Not enabled'
          : support === 'unsupported' ? 'Not supported on this device'
            : !deviceSubscribed || permission !== 'granted' ? 'Enable on this device'
              : 'Enabled on this device'
  const active = !loading && setupReady && settings.enabled && support === 'supported' && permission === 'granted' && deviceSubscribed
  const permissionLabel = support === 'unsupported' ? 'Not supported' : permission === 'granted' ? 'Allowed' : permission === 'denied' ? 'Blocked' : 'Not requested'
  const toggleDisabled = loading || busy || (!setupReady && !draft.enabled)

  return <Sheet open title="Weekly advance reminder" className="advance-reminder-sheet" onClose={onClose} busy={busy}>
    <form className="advance-reminder-form" onSubmit={submit} aria-busy={loading || busy}>
      <div className={`advance-reminder-status${active ? ' is-active' : ''}`} role="status">
        {active ? <Bell size={22} aria-hidden="true" /> : <BellOff size={22} aria-hidden="true" />}
        <div><strong>{status}</strong><p>{loading ? 'Loading your saved schedule.' : active ? 'This phone is connected to your account reminder.' : !setupReady && error ? 'Your saved schedule could not be checked. Try again before enabling notifications.' : !setupReady ? 'You can save a schedule now. Notifications need setup before they can be enabled.' : permission === 'denied' ? 'Allow notifications in your phone or browser settings, then reopen this panel.' : support === 'unsupported' ? 'Use a browser that supports notifications. On iPhone, open the app from your Home Screen.' : settings.enabled ? 'Connect this phone to receive the saved account reminder.' : 'Choose your schedule and enable reminders when ready.'}</p></div>
      </div>

      <label className="advance-reminder-switch">
        <span className="advance-reminder-switch-copy"><strong>Enable weekly reminders</strong><span>One schedule for all your connected phones</span></span>
        <span className="advance-reminder-switch-control"><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} disabled={toggleDisabled} aria-describedby={guidanceId} /><span className="advance-reminder-switch-track" aria-hidden="true" /></span>
      </label>

      <div className="advance-reminder-schedule">
        <label className="label">Reminder day<select className="field" value={draft.weekday} disabled={loading || busy} onChange={event => edit({ weekday: Number(event.target.value) })}>{weekdays.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
        <label className="label">Time<input className="field" type="time" value={draft.time} step={60} required disabled={loading || busy} onChange={event => edit({ time: event.target.value })} /></label>
      </div>
      <div className="advance-reminder-preview"><CalendarDays size={20} aria-hidden="true" /><div><strong>{scheduleLabel(draft)}</strong><span>India time (IST · Asia/Kolkata)</span></div></div>
      <p id={guidanceId} className="advance-reminder-guidance">Checks the latest Wednesday’s advance. Changing the reminder day keeps the Wednesday pay date. Sends once per week only if the advance is incomplete.</p>

      <div className="advance-reminder-device">
        <div className="advance-reminder-device-heading"><Smartphone size={19} aria-hidden="true" /><strong>This phone</strong></div>
        <dl><div><dt>Notification permission</dt><dd>{permissionLabel}</dd></div><div><dt>Connection</dt><dd>{deviceSubscribed ? 'Connected' : 'Not connected'}</dd></div></dl>
        <p>On iPhone, add this app to your Home Screen first. Allow notifications on each phone you want to use.</p>
        {canConnect && <button type="button" className="button-secondary" disabled={busy || loading} onClick={() => void save({ ...settings, enabled: true }, true)}>{operation === 'connect' ? 'Connecting…' : 'Enable on this device'}</button>}
        <button type="button" className="button-secondary advance-reminder-test" disabled={!canTest || busy} onClick={() => void testNotification()}>{testing || operation === 'test' ? 'Requesting test…' : 'Send test notification'}</button>
      </div>

      <Notice error>{localError || error}</Notice>
      <Notice>{localMessage && !localError && !error ? message || localMessage : message && !localError && !error ? message : ''}</Notice>
      <div className="sheet-footer advance-reminder-footer"><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>Close</button><button type="submit" className="button-primary" disabled={loading || busy}>{saving || operation === 'save' ? 'Saving…' : !setupReady ? 'Save schedule' : 'Save changes'}</button></div>
    </form>
  </Sheet>
}
