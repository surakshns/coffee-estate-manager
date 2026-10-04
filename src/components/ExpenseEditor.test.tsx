// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EstateData } from '../lib/types'
import { ExpenseEditor } from './ExpenseEditor'
import { Expenses } from './Expenses'

const api = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), eq: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ insert: api.insert, update: api.update }) } }))

const data: EstateData = {
  workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], expenses: [], prices: [],
  monthlyGuideEntries: [], production: [], sales: [], documents: [],
  categories: [{ id: 'repairs', name: 'Repairs', archived: false }, { id: 'old', name: 'Old category', archived: true }]
}
const refresh = vi.fn(async () => {})
const saved = vi.fn()

function HomeEntry() {
  const [open, setOpen] = useState(false)
  return <main><h1>Home</h1><button onClick={() => setOpen(true)}>Add expense</button><ExpenseEditor data={data} refresh={refresh} open={open} onClose={() => setOpen(false)} onSaved={saved} /></main>
}

beforeEach(() => {
  vi.clearAllMocks()
  api.insert.mockResolvedValue({ error: null })
  api.eq.mockResolvedValue({ error: null })
  api.update.mockReturnValue({ eq: api.eq })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('expense quick entry', () => {
  it('saves from a standalone editor and returns focus to Home without leaving it', async () => {
    const user = userEvent.setup()
    render(<HomeEntry />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.queryByRole('option', { name: 'Old category (archived)' })).toBeNull()
    await user.type(screen.getByLabelText('Amount (₹)'), '850.50')
    await user.selectOptions(screen.getByLabelText('Category'), 'repairs')
    await user.type(screen.getByLabelText(/Description/), 'Pump service')
    const expenseDate = (screen.getByLabelText('Date') as HTMLInputElement).value
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(api.insert).toHaveBeenCalledWith({ expense_date: expenseDate, category_id: 'repairs', description: 'Pump service', amount: 850.5 }))
    expect(saved).toHaveBeenCalledWith('Expense added.')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add expense' }))
  })

  it('defaults to the estate date when India has moved to the next day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T20:00:00Z'))
    render(<ExpenseEditor data={data} refresh={refresh} open onClose={() => {}} />)
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-05')
  })

  it('keeps an unsuccessful entry open for retry and starts fresh after a successful save', async () => {
    api.insert.mockResolvedValueOnce({ error: new Error('Unable to connect') })
    const user = userEvent.setup()
    render(<HomeEntry />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Amount (₹)'), '400')
    await user.selectOptions(screen.getByLabelText('Category'), 'repairs')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to connect')
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).value).toBe('400')
    expect(refresh).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers category setup from quick entry when no active category exists', async () => {
    const onClose = vi.fn()
    const onManageCategories = vi.fn()
    const user = userEvent.setup()
    render(<ExpenseEditor data={{ ...data, categories: [] }} refresh={refresh} open onClose={onClose} onManageCategories={onManageCategories} />)
    await user.click(screen.getByRole('button', { name: 'Add a category first' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onManageCategories).toHaveBeenCalledTimes(1)
    expect(api.insert).not.toHaveBeenCalled()
  })

  it('can open the expense workspace directly at category setup', () => {
    render(<Expenses data={data} year={2026} refresh={refresh} initialView="categories" />)
    expect(screen.getByRole('heading', { name: 'Expense categories' })).toBeTruthy()
    expect(screen.getByLabelText('New category')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
