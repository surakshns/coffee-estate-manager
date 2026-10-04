// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EstateData } from '../lib/types'
import { EstateGuide } from './EstateGuide'

const api = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }))

const data: EstateData = {
  workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], categories: [],
  expenses: [], prices: [], production: [], sales: [], documents: [],
  monthlyGuideEntries: [{
    id: 'guide-note-1', month_number: 9, title: 'Check drying yard',
    notes: 'Repair the cover before harvesting.', created_at: '2026-09-01T10:00:00Z'
  }]
}
const triggerName = 'Open coffee estate guide and notes'

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
})
afterEach(() => {
  cleanup()
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
})

describe('header estate guide', () => {
  it('opens the guide and saved notes from one trigger and returns focus when closed', async () => {
    const user = userEvent.setup()
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow = 'scroll'
    render(<EstateGuide data={data} refresh={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: triggerName })
    expect(screen.getAllByRole('button', { name: triggerName })).toHaveLength(1)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Coffee estate guide' })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(within(dialog).getByRole('button', { name: /^September/ }))
    expect(within(dialog).getByText('Check drying yard')).toBeTruthy()
    expect(within(dialog).getByText('Repair the cover before harvesting.')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Close estate guide' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.documentElement.style.overflow).toBe('auto')
    expect(document.body.style.overflow).toBe('scroll')
    expect(api.from).not.toHaveBeenCalled()
  })

  it('closes on Escape from a note field and restores focus to the logo', async () => {
    const user = userEvent.setup()
    render(<EstateGuide data={data} refresh={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: triggerName })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Coffee estate guide' })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await user.click(within(dialog).getByRole('textbox', { name: 'Title' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the open guide, selected month and draft note across page changes', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    const { rerender } = render(<EstateGuide data={data} refresh={refresh} page="Dashboard" />)
    const trigger = screen.getByRole('button', { name: triggerName })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Coffee estate guide' })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await user.click(within(dialog).getByRole('button', { name: /^September/ }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Our harvest checklist')
    const note = within(dialog).getByRole('textbox', { name: /Details/ }) as HTMLTextAreaElement
    await user.type(note, 'Check the cover and storage bags.')

    rerender(<EstateGuide data={data} refresh={refresh} page="Labour" />)

    expect(screen.getByRole('dialog', { name: 'Coffee estate guide' })).toBe(dialog)
    expect(screen.getByRole('button', { name: triggerName })).toBe(trigger)
    expect(within(dialog).getByRole('button', { name: /^September/ }).getAttribute('aria-pressed')).toBe('true')
    expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Our harvest checklist')
    expect(note.value).toBe('Check the cover and storage bags.')
    expect(document.activeElement).toBe(note)
    expect(api.from).not.toHaveBeenCalled()
  })

  it('prevents opening until the guide trigger is enabled', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    const { rerender } = render(<EstateGuide data={data} refresh={refresh} disabled />)
    const trigger = screen.getByRole('button', { name: triggerName }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<EstateGuide data={data} refresh={refresh} disabled={false} />)
    expect(trigger.disabled).toBe(false)
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Coffee estate guide' })).toBeTruthy()
  })
})
