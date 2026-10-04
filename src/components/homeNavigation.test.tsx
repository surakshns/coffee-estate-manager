// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EstateData } from '../lib/types'
import App from '../App'

const api = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn(), insert: vi.fn(), refresh: vi.fn(), data: null as EstateData | null }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: api.getSession, onAuthStateChange: api.onAuthStateChange, signOut: api.signOut }, from: () => ({ insert: api.insert }) } }))
vi.mock('../hooks/useEstateData', () => ({ useEstateData: () => ({ data: api.data, loading: false, error: '', refresh: api.refresh }) }))
vi.mock('./EstateGuide', () => ({ EstateGuide: () => null }))
vi.mock('./Labour', () => ({ Labour: ({ year, initialAdvanceDate }: { year: number; initialAdvanceDate?: string }) => <section><h1>Weekly advance editor</h1><p>{initialAdvanceDate ?? 'Regular labour view'} · {year}</p></section> }))
vi.mock('./Documents', () => ({ Documents: () => <h1>Estate documents</h1> }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
  api.data = {
    workers: [{ id: 'w1', name: 'Ravi', active: true, default_weekly_amount: 2250 }],
    categories: [{ id: 'c1', name: 'Repairs', archived: false }],
    expenses: [], weeklyPayments: [], workerLoans: [], labourRates: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: []
  }
  api.getSession.mockResolvedValue({ data: { session: { user: { id: 'user', email: 'owner@example.com' } } }, error: null })
  api.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  api.insert.mockResolvedValue({ error: null })
  api.refresh.mockResolvedValue(undefined)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  window.scrollTo = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('home entries and phone menu', () => {
  it('adds an expense from Home and returns to the dashboard after saving', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add expense' }))
    const form = screen.getByRole('dialog', { name: 'Add expense' })
    expect(screen.getByRole('heading', { name: 'Estate overview' })).toBeTruthy()
    await user.type(within(form).getByLabelText('Amount (₹)'), '750')
    await user.selectOptions(within(form).getByLabelText('Category'), 'c1')
    await user.click(within(form).getByRole('button', { name: 'Save expense' }))
    expect(api.insert).toHaveBeenCalledWith({ expense_date: '2026-01-01', category_id: 'c1', description: '', amount: 750 })
    expect(api.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Estate overview' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Expense added.')
  })

  it('selects the requested advance year when the current week begins in the previous year', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start this week’s advance' }))
    expect(screen.getByRole('heading', { name: 'Weekly advance editor' })).toBeTruthy()
    expect(screen.getByText('2025-12-31 · 2025')).toBeTruthy()
    expect((screen.getByLabelText('Record year') as HTMLSelectElement).value).toBe('2025')
  })

  it('keeps the three common destinations and a menu with every remaining section and account action', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Estate overview' })
    const nav = view.container.querySelector('.mobile-nav') as HTMLElement
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['Home', 'Labour', 'Expenses', 'Menu'])
    await user.click(within(nav).getByRole('button', { name: 'Menu' }))
    const menu = screen.getByRole('dialog', { name: 'Menu' })
    for (const name of ['Documents', 'Harvest & sales', 'Rainfall', 'Coffee prices', 'Backup & import', 'Change password', 'Sign out']) expect(within(menu).getByRole('button', { name })).toBeTruthy()
    await user.click(within(menu).getByRole('button', { name: 'Documents' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Estate documents' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Menu' }).classList.contains('is-active')).toBe(true)
    await user.click(within(nav).getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: 'Estate overview' })).toBeTruthy()
  })
})
