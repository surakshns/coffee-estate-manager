// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvanceReminderSettings, type AdvanceReminderSettingsProps } from './AdvanceReminderSettings'

const props = (overrides: Partial<AdvanceReminderSettingsProps> = {}): AdvanceReminderSettingsProps => ({
  open: true,
  onClose: vi.fn(),
  settings: { enabled: false, weekday: 3, time: '20:00' },
  support: 'supported',
  permission: 'default',
  deviceSubscribed: false,
  setupReady: true,
  onSave: vi.fn(async () => {}),
  onTest: vi.fn(async () => {}),
  ...overrides,
})

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => cleanup())

describe('weekly advance reminder settings', () => {
  it('starts with Wednesday at 8 PM and submits the chosen account schedule', async () => {
    const options = props()
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...options} />)
    expect(screen.getByText('Not enabled')).toBeTruthy()
    expect(screen.getByText('Wednesday at 8:00 PM')).toBeTruthy()
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('3')
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('20:00')
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)

    await user.selectOptions(screen.getByLabelText('Reminder day'), '4')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:15' } })
    await user.click(screen.getByRole('switch', { name: /Enable weekly reminders/ }))
    expect(screen.getByText('Thursday at 9:15 PM')).toBeTruthy()
    expect(screen.getByText(/Changing the reminder day keeps the Wednesday pay date/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(options.onSave).toHaveBeenCalledWith({ enabled: true, weekday: 4, time: '21:15' }))
    expect(options.onClose).not.toHaveBeenCalled()
  })

  it('keeps an edited draft through a settings refresh and unsuccessful save', async () => {
    const options = props({ onSave: vi.fn(async () => { throw new Error('Unable to connect') }) })
    const user = userEvent.setup()
    const view = render(<AdvanceReminderSettings {...options} />)
    await user.selectOptions(screen.getByLabelText('Reminder day'), '1')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '19:30' } })
    view.rerender(<AdvanceReminderSettings {...options} settings={{ enabled: false, weekday: 5, time: '18:00' }} />)
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('19:30')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to connect')
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('19:30')
    expect(options.onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(options.onSave).toHaveBeenCalledTimes(2)
  })

  it('loads untouched saved settings without letting the loading defaults be edited', async () => {
    const options = props({ loading: true })
    const view = render(<AdvanceReminderSettings {...options} />)
    expect(screen.getByLabelText('Reminder day')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
    view.rerender(<AdvanceReminderSettings {...options} loading={false} settings={{ enabled: true, weekday: 0, time: '00:00' }} permission="granted" deviceSubscribed />)
    await waitFor(() => expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('0'))
    expect(screen.getByText('Sunday at 12:00 AM')).toBeTruthy()
    expect(screen.getByText('Enabled on this device')).toBeTruthy()
  })

  it('can store a preferred schedule while setup is unavailable without offering enabled delivery', async () => {
    const options = props({ setupReady: false })
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...options} />)
    expect(screen.getByText('Setup required')).toBeTruthy()
    expect(screen.getByRole('switch', { name: /Enable weekly reminders/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)
    await user.selectOptions(screen.getByLabelText('Reminder day'), '6')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '18:45' } })
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(options.onSave).toHaveBeenCalledWith({ enabled: false, weekday: 6, time: '18:45' })
    expect(screen.queryByText('Enabled on this device')).toBeNull()
  })

  it('distinguishes an unavailable connection from notification setup that is missing', () => {
    render(<AdvanceReminderSettings {...props({ setupReady: false, error: 'Could not connect to reminder settings.' })} />)
    expect(screen.getByText('Unable to check reminders')).toBeTruthy()
    expect(screen.queryByText('Setup required')).toBeNull()
    expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Could not connect to reminder settings.')
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)
  })

  it('connects a second phone using the saved account schedule without discarding local edits', async () => {
    const options = props({ settings: { enabled: true, weekday: 3, time: '20:00' } })
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...options} />)
    expect(screen.queryByText('Enabled on this device')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Reminder day'), '2')
    await user.click(screen.getByRole('button', { name: 'Enable on this device' }))
    expect(options.onSave).toHaveBeenCalledWith({ enabled: true, weekday: 3, time: '20:00' })
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('2')
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)
  })

  it('shows blocked permission and still lets the owner turn the account reminder off', async () => {
    const options = props({ settings: { enabled: true, weekday: 3, time: '20:00' }, permission: 'denied', deviceSubscribed: true })
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...options} />)
    expect(screen.getByText('Notifications blocked')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: 'Enable on this device' })).toBeNull()
    await user.click(screen.getByRole('switch', { name: /Enable weekly reminders/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(options.onSave).toHaveBeenCalledWith({ enabled: false, weekday: 3, time: '20:00' })
  })

  it('does not offer a test on unsupported browsers and explains iPhone installation', () => {
    render(<AdvanceReminderSettings {...props({ settings: { enabled: true, weekday: 3, time: '20:00' }, support: 'unsupported' })} />)
    expect(screen.getByText('Not supported on this device')).toBeTruthy()
    expect(screen.getByText(/On iPhone, add this app to your Home Screen first/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveProperty('disabled', true)
  })

  it('keeps a failed test retryable and reports a request rather than confirmed delivery', async () => {
    const onTest = vi.fn().mockRejectedValueOnce(new Error('Test service unavailable')).mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...props({ settings: { enabled: true, weekday: 3, time: '20:00' }, permission: 'granted', deviceSubscribed: true, onTest })} />)
    await user.click(screen.getByRole('button', { name: 'Send test notification' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Test service unavailable')
    await user.click(screen.getByRole('button', { name: 'Send test notification' }))
    expect(onTest).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Test requested. Check this phone for the notification.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/delivered/i)).toBeNull()
  })

  it('blocks duplicate saves and closing while a request is in progress', async () => {
    let finishSave!: () => void
    const options = props({ onSave: vi.fn(() => new Promise<void>(resolve => { finishSave = resolve })) })
    const user = userEvent.setup()
    render(<AdvanceReminderSettings {...options} />)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Reminder day')).toHaveProperty('disabled', true)
    await user.click(screen.getByRole('button', { name: 'Saving…' }))
    expect(options.onSave).toHaveBeenCalledTimes(1)
    finishSave()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false))
  })

  it('keeps accepted settings on reopening and returns focus to its opener', async () => {
    const saved = vi.fn()
    function Entry() {
      const [open, setOpen] = useState(false)
      const [settings, setSettings] = useState({ enabled: false, weekday: 3, time: '20:00' })
      return <><button onClick={() => setOpen(true)}>Reminder settings</button><AdvanceReminderSettings {...props()} open={open} settings={settings} onClose={() => setOpen(false)} onSave={async schedule => { saved(schedule); setSettings(schedule) }} /></>
    }
    const user = userEvent.setup()
    render(<Entry />)
    await user.click(screen.getByRole('button', { name: 'Reminder settings' }))
    await user.selectOptions(screen.getByLabelText('Reminder day'), '2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saved).toHaveBeenCalledWith({ enabled: false, weekday: 2, time: '20:00' })
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('2')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reminder settings' }))
    await user.click(screen.getByRole('button', { name: 'Reminder settings' }))
    expect((screen.getByLabelText('Reminder day') as HTMLSelectElement).value).toBe('2')
  })
})
