// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Backup } from './Backup'
import type { EstateData } from '../lib/types'
const api = vi.hoisted(() => ({ insert: vi.fn(), upsert: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ insert: api.insert, upsert: api.upsert }), rpc: api.rpc } }))
const data: EstateData = { workers: [{ id: 'w', name: 'Asha', active: true, default_weekly_amount: 1000 }], categories: [{ id: 'c', name: 'Repairs', archived: false }], expenses: [], weeklyPayments: [], workerLoans: [], labourRates: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: [] }
beforeEach(() => {
  vi.resetAllMocks()
  api.insert.mockResolvedValue({ error: null }); api.upsert.mockResolvedValue({ error: null }); api.rpc.mockResolvedValue({ error: null })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(cleanup)
function choose(container: HTMLElement, csv: string) {
  const file = new File([csv], 'estate.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => csv })
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
}
describe('reviewed CSV imports', () => {
  it('previews without writing, allows cancellation and imports only after review', async () => {
    const user = userEvent.setup(), refresh = vi.fn(async () => {})
    const { container } = render(<Backup data={data} refresh={refresh} />)
    const csv = 'expense_date,category,amount,description\n2026-10-05,Repairs,12.50,"line 1\nline 2"'
    choose(container, csv)
    const dialog = await screen.findByRole('dialog', { name: 'Review import' })
    expect(within(dialog).getByRole('cell', { name: /line 1/ }).textContent).toBe('line 1\nline 2')
    expect(api.insert).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.insert).not.toHaveBeenCalled()
    choose(container, csv)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import 1 records' }))
    expect(api.insert).toHaveBeenCalledOnce()
    expect(api.insert).toHaveBeenCalledWith([{ expense_date: '2026-10-05', category_id: 'c', amount: 12.5, description: 'line 1\nline 2' }])
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('rejects an invalid later row without writing any earlier records', async () => {
    const { container } = render(<Backup data={data} refresh={async () => {}} />)
    choose(container, 'expense_date,category,amount\n2026-10-05,Repairs,10\n2026-10-05,Repairs,NaN')
    expect((await screen.findByRole('alert')).textContent).toContain('Row 3')
    expect(api.insert).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('keeps the review open with a useful backend error and does not double-submit', async () => {
    let resolve!: (result: { error: { message: string } }) => void
    api.insert.mockReturnValue(new Promise(done => { resolve = done }))
    const user = userEvent.setup(), refresh = vi.fn(async () => {})
    const { container } = render(<Backup data={data} refresh={refresh} />)
    choose(container, 'expense_date,category,amount\n2026-10-05,Repairs,10')
    const panel = within(await screen.findByRole('dialog'))
    await user.dblClick(panel.getByRole('button', { name: 'Import 1 records' }))
    expect(api.insert).toHaveBeenCalledOnce()
    resolve({ error: { message: 'Database unavailable' } })
    await waitFor(() => expect(panel.getByRole('alert').textContent).toBe('Database unavailable'))
    expect(refresh).not.toHaveBeenCalled()
  })
  it('uses the atomic wage import to reconcile linked repayments', async () => {
    const user = userEvent.setup(), refresh = vi.fn(async () => {})
    const { container } = render(<Backup data={data} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Record type'), 'weeklyPayments')
    choose(container, 'worker_name,week_start,amount,loan_deduction\nAsha,2026-10-07,1000,100')
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import 1 records' }))
    expect(api.rpc).toHaveBeenCalledWith('import_weekly_payments', { p_rows: [expect.objectContaining({ worker_id: 'w', loan_deduction: 100, amount: 1000 })] })
    expect(api.upsert).not.toHaveBeenCalled()
  })
})
