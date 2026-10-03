// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { EstateData } from '../lib/types'
import { Expenses } from './Expenses'
import { Documents } from './Documents'
import { Production } from './Production'
import { Labour } from './Labour'

const api = vi.hoisted(() => ({
  insert: vi.fn(), update: vi.fn(), eq: vi.fn(), download: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), getUser: vi.fn(), upsert: vi.fn(), rpc: vi.fn()
}))
vi.mock('./PdfReader', () => ({ default: ({ title }: { title: string }) => <canvas role="img" aria-label={title + ', page 1'} /> }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: api.insert, update: api.update, delete: () => ({ eq: api.eq }), upsert: api.upsert }),
    rpc: api.rpc,
    auth: { getUser: api.getUser },
    storage: { from: () => ({ download: api.download, upload: api.upload, remove: api.remove }) }
  }
}))

const refresh = vi.fn(async () => {})
const data: EstateData = {
  workers: [{ id: 'w1', name: 'Ravi', active: true, default_weekly_amount: 2250, default_days_worked: 5 }],
  weeklyPayments: [{ id: 'pay1', worker_id: 'w1', week_start: '2026-09-02', amount: 2250, loan_deduction: 250 }],
  workerLoans: [{ id: 'loan1', worker_id: 'w1', loan_date: '2026-09-01', amount: 1000, kind: 'advance', notes: 'Festival advance' }],
  labourRates: [], prices: [], monthlyGuideEntries: [],
  categories: [{ id: 'c1', name: 'Repairs', archived: false }, { id: 'c2', name: 'Fertiliser', archived: true }],
  expenses: [
    { id: 'e1', expense_date: '2026-09-04', category_id: 'c1', description: 'Pump repair', amount: 1000 },
    { id: 'e2', expense_date: '2026-08-14', category_id: 'c2', description: 'Field nutrition', amount: 500 },
    { id: 'e3', expense_date: '2025-07-02', category_id: 'c1', description: 'Old motor', amount: 800 }
  ],
  production: [
    { id: 'p1', production_year: 2026, bags_produced: 100, bag_weight_kg: 50, notes: 'North block' },
    { id: 'p2', production_year: 2025, bags_produced: 80, bag_weight_kg: 50, notes: 'South block' }
  ],
  sales: [{ id: 's1', production_year: 2026, sale_date: '2026-09-04', bags_sold: 10, selling_price_per_bag: 2000, buyer: 'Coorg Coffee' }],
  documents: [
    { id: 'd1', title: 'Land survey', category: 'Maps', document_date: '2026-08-01', notes: 'Survey number 123', file_path: 'user/map.jpg', file_name: 'survey.jpg', file_type: null, file_size: 1024, created_at: '2026-09-02T00:00:00Z' },
    { id: 'd2', title: 'Tax receipt', category: 'Tax receipts', document_date: '2026-07-01', notes: '', file_path: 'user/tax.pdf', file_name: 'tax.pdf', file_type: null, file_size: 2048, created_at: '2026-09-01T00:00:00Z' },
    { id: 'd3', title: 'Lease agreement', category: 'Agreements', document_date: null, notes: '', file_path: 'user/lease.docx', file_name: 'lease.docx', file_type: null, file_size: 4096, created_at: '2026-08-01T00:00:00Z' }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  api.insert.mockResolvedValue({ error: null })
  api.eq.mockResolvedValue({ error: null })
  api.update.mockReturnValue({ eq: api.eq })
  api.upsert.mockResolvedValue({ error: null })
  api.rpc.mockResolvedValue({ error: null })
  api.download.mockResolvedValue({ data: new Blob(['fixture'], { type: 'application/octet-stream' }), error: null })
  api.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null })
  api.upload.mockResolvedValue({ error: null })
  api.remove.mockResolvedValue({ error: null })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  URL.createObjectURL = vi.fn(() => 'blob:document-preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('expense workspace', () => {
  it('shows records next to search, with no entry form until Add expense is pressed', async () => {
    const user = userEvent.setup()
    render(<Expenses data={data} year={2026} refresh={refresh} />)
    expect(screen.getByText('Pump repair')).toBeTruthy()
    expect(screen.queryByText('Old motor')).toBeNull()
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.getByRole('dialog', { name: 'Add expense' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add expense' }))
  })

  it('keeps search, category results, and expense totals in sync', async () => {
    const user = userEvent.setup()
    const { container } = render(<Expenses data={data} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Filter expense category'), 'c1')
    expect(screen.queryByText('Field nutrition')).toBeNull()
    expect(container.querySelector('.expense-result-summary')?.textContent).toContain('1,000')
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.getByText('No expenses in this view')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByText('Field nutrition')).toBeTruthy()
    expect(container.querySelector('.expense-result-summary')?.textContent).toContain('1,500')
  })

  it('preserves the archived category when editing a historical expense', async () => {
    const user = userEvent.setup()
    render(<Expenses data={data} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Edit Field nutrition' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('c2')
    await user.click(within(dialog).getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ expense_date: '2026-08-14', category_id: 'c2', description: 'Field nutrition', amount: 500 }))
    expect(api.eq).toHaveBeenCalledWith('id', 'e2')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('retains entered values and displays a save error inside the form', async () => {
    api.insert.mockResolvedValueOnce({ error: new Error('Connection unavailable') })
    const user = userEvent.setup()
    render(<Expenses data={data} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Amount (₹)'), '750')
    await user.selectOptions(screen.getByLabelText('Category'), 'c1')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection unavailable')
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).value).toBe('750')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps labour take-home separate from filtered expenses in the breakdown', async () => {
    const user = userEvent.setup()
    render(<Expenses data={data} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Filter expense category'), 'c1')
    await user.click(screen.getByRole('button', { name: 'Breakdown' }))
    expect(screen.getByText("Workers' take-home pay").parentElement?.textContent).toContain('2,000')
    expect(screen.getByText('Expenses + take-home pay').parentElement?.textContent).toContain('3,000')
  })
})

describe('document workspace', () => {
  it('filters the adjacent list without an upload form between search and results', async () => {
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    expect(screen.queryByLabelText('Document file')).toBeNull()
    await user.type(screen.getByRole('searchbox'), 'survey')
    expect(screen.getByRole('button', { name: 'Open Land survey' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Tax receipt' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.selectOptions(screen.getByLabelText('Filter document category'), 'Tax receipts')
    expect(screen.getByRole('button', { name: 'Open Tax receipt' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Land survey' })).toBeNull()
  })

  it('previews images with missing MIME metadata and releases the URL on close', async () => {
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Open Land survey' }))
    const img = await screen.findByRole('img', { name: 'Land survey' })
    expect(img.getAttribute('src')).toBe('blob:document-preview')
    expect(screen.getByText('Survey number 123')).toBeTruthy()
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toHaveProperty('type', 'image/jpeg')
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-preview')
  })

  it('sets a PDF MIME type for PDF records and keeps the original download available', async () => {
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Open Tax receipt' }))
    expect(await screen.findByRole('img', { name: 'Tax receipt, page 1' })).toHaveProperty('tagName', 'CANVAS')
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toHaveProperty('type', 'application/pdf')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('gives Office files a details view and download action', async () => {
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Open Lease agreement' }))
    expect(screen.getByText('Preview unavailable for this file type')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download' })).toBeTruthy()
    expect(api.download).not.toHaveBeenCalled()
  })

  it('does not create a preview after the reader is closed during a download', async () => {
    let resolve!: (value: { data: Blob; error: null }) => void
    api.download.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Open Land survey' }))
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    resolve({ data: new Blob(['late']), error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('uploads a document with its title, category, and notes from the focused form', async () => {
    const user = userEvent.setup()
    render(<Documents data={data} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Add document' }))
    await user.upload(screen.getByLabelText('Document file'), new File(['pdf'], 'record.pdf', { type: 'application/pdf' }))
    await user.type(screen.getByLabelText(/Title/), 'Land record')
    await user.type(screen.getByLabelText(/Notes/), 'Survey 42')
    await user.click(screen.getByRole('button', { name: 'Save document' }))
    await waitFor(() => expect(api.insert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Land record', category: 'Land records', notes: 'Survey 42', file_type: 'application/pdf' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('phone weekly-pay cards', () => {
  afterEach(() => vi.unstubAllGlobals())

  function phoneViewport() {
    let matches = true
    const listeners = new Set<() => void>()
    const media = { get matches() { return matches }, media: '(max-width: 639px)', addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
    vi.stubGlobal('matchMedia', (query: string) => query === media.media ? media : { matches: false })
    return (phone: boolean) => act(() => { matches = phone; listeners.forEach(listener => listener()) })
  }

  const phoneData: EstateData = { ...data, weeklyPayments: [],
    workers: [...data.workers, { id: 'w2', name: 'Meena', active: true, default_weekly_amount: 2250, default_days_worked: 5 }],
    workerLoans: [...data.workerLoans, { id: 'loan2', worker_id: 'w2', loan_date: '2026-09-01', amount: 1000, kind: 'advance', notes: '' }]
  }
  const swipe = (target: HTMLElement, dy = -110, dx = 0, cancel = false) => {
    const origin = { clientX: 30, clientY: 160 }
    const end = { clientX: 30 + dx, clientY: 160 + dy }
    fireEvent.touchStart(target, { touches: [origin] })
    fireEvent.touchMove(target, { touches: [end], cancelable: true })
    if (cancel) fireEvent.touchCancel(target)
    else fireEvent.touchEnd(target, { touches: [], changedTouches: [end] })
  }

  it('shows one worker, retains entries after swiping and returning, and saves the full week only on review', async () => {
    phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    expect(screen.queryByRole('searchbox', { name: 'Find worker in weekly pay' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save weekly pay' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    const dialog = screen.getByRole('dialog')
    const deck = within(dialog)
    expect(deck.getByText('Worker 1 of 2')).toBeTruthy()
    expect(deck.queryByRole('heading', { name: 'Meena' })).toBeNull()
    swipe(deck.getByRole('heading', { name: 'Ravi' }), 110)
    expect(dialog.querySelector('.labour-deck-motion.is-leaving')).toBeNull()
    await user.click(deck.getByRole('button', { name: '1 day for Ravi' }))
    await user.clear(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }))
    await user.type(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '200')
    swipe(deck.getByRole('heading', { name: 'Ravi' }))
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Meena' })).toBeTruthy())
    await user.click(deck.getByRole('button', { name: '2 days for Meena' }))
    await user.clear(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Meena' }))
    await user.type(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Meena' }), '150')
    swipe(deck.getByRole('heading', { name: 'Meena' }), 110)
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Ravi' })).toBeTruthy())
    expect(deck.getByRole('button', { name: '1 day for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect((deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement).value).toBe('200')
    await user.click(deck.getByRole('button', { name: 'Next worker' }))
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Meena' })).toBeTruthy())
    expect((deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Meena' }) as HTMLInputElement).value).toBe('150')
    await user.click(deck.getByRole('button', { name: 'Review week' }))
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Ready to save this week' })).toBeTruthy())
    expect(deck.getByText('Take-home to pay').parentElement?.textContent).toContain('₹1,000')
    swipe(deck.getByRole('heading', { name: 'Ready to save this week' }), 110)
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Meena' })).toBeTruthy())
    expect((deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Meena' }) as HTMLInputElement).value).toBe('150')
    swipe(deck.getByRole('heading', { name: 'Meena' }))
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Ready to save this week' })).toBeTruthy())
    expect(api.rpc).not.toHaveBeenCalled()
    await user.click(deck.getByRole('button', { name: 'Save weekly pay' }))
    expect(api.rpc).toHaveBeenCalledWith('save_weekly_labour', { p_week_start: '2026-09-02', p_rows: [
      { worker_id: 'w1', days_worked: 1, daily_rate: 450, excluded: false, personal_deduction: 200 },
      { worker_id: 'w2', days_worked: 2, daily_rate: 450, excluded: false, personal_deduction: 150 }
    ] })
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ignores input gestures, scrolling, short or horizontal drags and cancellation, and blocks an invalid loan deduction', async () => {
    phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    const dialog = screen.getByRole('dialog')
    const deck = within(dialog)
    const heading = deck.getByRole('heading', { name: 'Ravi' })
    swipe(heading, -40)
    swipe(heading, -40, 120)
    swipe(heading, -110, 0, true)
    swipe(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }))
    const scroller = dialog.querySelector('.labour-deck-card-scroll')!
    scroller.scrollTop = 50
    swipe(heading)
    scroller.scrollTop = 0
    expect(dialog.querySelector('.labour-deck-motion.is-leaving')).toBeNull()
    await user.clear(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }))
    await user.type(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '1001')
    swipe(heading)
    expect(deck.getByRole('alert').textContent).toContain('exceeds the amount still owed')
    expect(deck.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
    expect(api.rpc).not.toHaveBeenCalled()
    await user.clear(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }))
    await user.type(deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '250')
    expect(deck.queryByRole('alert')).toBeNull()
    swipe(heading)
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Meena' })).toBeTruthy())
  })

  it('lets long cards scroll and supports both swipe directions from the handle', async () => {
    phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    const dialog = screen.getByRole('dialog')
    const deck = within(dialog)
    const scroller = dialog.querySelector('.labour-deck-card-scroll')!
    Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 300 } })
    swipe(deck.getByRole('heading', { name: 'Ravi' }))
    expect(dialog.querySelector('.labour-deck-motion.is-leaving')).toBeNull()
    scroller.scrollTop = 200
    swipe(dialog.querySelector<HTMLElement>('.labour-deck-swipe-handle')!)
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Meena' })).toBeTruthy())
    swipe(dialog.querySelector<HTMLElement>('.labour-deck-swipe-handle')!, 110)
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Ravi' })).toBeTruthy())
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('keeps drafts on close and restores the desktop list on a wider viewport', async () => {
    const resize = phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '3 days for Ravi' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close panel' }))
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '3 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    resize(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start advance' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Meena' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '3 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('keeps failed saves and their errors inside the deck so the draft can be corrected or retried', async () => {
    phoneViewport()
    api.rpc.mockResolvedValueOnce({ error: new Error('Connection unavailable') })
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    const deck = within(screen.getByRole('dialog'))
    await user.click(deck.getByRole('button', { name: '3 days for Ravi' }))
    await user.selectOptions(deck.getByLabelText('Jump to worker'), 'review')
    await user.click(deck.getByRole('button', { name: 'Save weekly pay' }))
    expect(await deck.findByRole('alert')).toHaveProperty('textContent', 'Connection unavailable')
    await user.selectOptions(deck.getByLabelText('Jump to worker'), 'w1')
    expect(deck.getByRole('button', { name: '3 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('opens a saved week directly for editing and records the updated advances', async () => {
    phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={data} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    expect(screen.queryByRole('button', { name: 'Start advance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit this week' })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: 'Find worker in weekly pay' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit advance' }))
    const deck = within(screen.getByRole('dialog'))
    expect(deck.getByRole('button', { name: '5 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    const deduction = deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement
    expect(deduction.disabled).toBe(false)
    expect(deduction.value).toBe('250')
    await user.click(deck.getByRole('button', { name: '3 days for Ravi' }))
    await user.clear(deduction)
    await user.type(deduction, '100')
    await user.click(deck.getByRole('button', { name: 'Review week' }))
    await waitFor(() => expect(deck.getByRole('heading', { name: 'Ready to save this week' })).toBeTruthy())
    expect(deck.getByText('Take-home to pay').parentElement?.textContent).toContain('₹1,250')
    await user.click(deck.getByRole('button', { name: 'Save updates' }))
    expect(api.rpc).toHaveBeenCalledWith('save_weekly_labour', { p_week_start: '2026-09-02', p_rows: [
      { worker_id: 'w1', days_worked: 3, daily_rate: 450, excluded: false, personal_deduction: 100 }
    ] })
    expect(refresh).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can discard phone edits and restores the saved attendance and deduction', async () => {
    phoneViewport()
    const user = userEvent.setup()
    render(<Labour data={data} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    await user.click(screen.getByRole('button', { name: 'Edit advance' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '3 days for Ravi' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close panel' }))
    expect(screen.getByText('Draft take-home')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByText('Saved take-home')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel editing' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit advance' }))
    const deck = within(screen.getByRole('dialog'))
    expect(deck.getByRole('button', { name: '5 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect((deck.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement).value).toBe('250')
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('sizes the deck to the visible viewport when the phone keyboard opens', async () => {
    phoneViewport()
    let height = 844
    const listeners = new Set<() => void>()
    vi.stubGlobal('visualViewport', { get height() { return height }, offsetTop: 0, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) })
    const user = userEvent.setup()
    render(<Labour data={phoneData} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Start advance' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.getPropertyValue('--labour-deck-height')).toBe('844px')
    act(() => { height = 480; listeners.forEach(listener => listener()) })
    expect(dialog.style.getPropertyValue('--labour-deck-height')).toBe('480px')
    expect(within(dialog).getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Close panel' }))
    expect(listeners.size).toBe(0)
  })
})

describe('harvest and labour workflows', () => {
  it('uses the selected crop year in records and supports all years', async () => {
    const user = userEvent.setup()
    render(<Production data={data} year={2026} refresh={refresh} />)
    expect(screen.getByText('North block')).toBeTruthy()
    expect(screen.queryByText('South block')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Record years'), 'all')
    expect(screen.getByText('South block')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Add harvest' }))
    expect((screen.getByLabelText('Production year') as HTMLInputElement).value).toBe('2026')
  })

  it('opens the sale form with a calculated total and saves the existing contract', async () => {
    const user = userEvent.setup()
    render(<Production data={data} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Sales' }))
    await user.click(screen.getByRole('button', { name: 'Add sale' }))
    await user.type(screen.getByLabelText('Buyer'), 'Local buyer')
    await user.type(screen.getByLabelText('Bags sold'), '5')
    await user.type(screen.getByLabelText('Price per bag (₹)'), '3000')
    expect(screen.getByText('Sale total').parentElement?.textContent).toContain('15,000')
    await user.click(screen.getByRole('button', { name: 'Save sale' }))
    await waitFor(() => expect(api.insert).toHaveBeenCalledWith(expect.objectContaining({ production_year: 2026, buyer: 'Local buyer', bags_sold: 5, selling_price_per_bag: 3000 })))
  })

  it('shows workers before their forms and opens the correct worker to edit', async () => {
    const user = userEvent.setup()
    render(<Labour data={data} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: /Workers/ }))
    expect(screen.queryByLabelText('Worker name')).toBeNull()
    expect(screen.getByText('Ravi')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit Ravi' }))
    expect(screen.getByRole('dialog', { name: 'Edit worker' })).toBeTruthy()
    expect((screen.getByLabelText('Worker name') as HTMLInputElement).value).toBe('Ravi')
  })

  it('shows loan history separately from the loan-entry panel', async () => {
    const user = userEvent.setup()
    render(<Labour data={data} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: /Loans/ }))
    expect(screen.queryByText('Festival advance')).toBeNull()
    expect(screen.queryByLabelText('What are you recording?')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View statement for Ravi' }))
    expect(within(screen.getByRole('dialog')).getByText('Festival advance')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    await user.click(screen.getByRole('button', { name: 'Give advance' }))
    expect(screen.getByLabelText('What are you recording?')).toBeTruthy()
  })

  it('shows zero saved work days for an unsaved week even when defaults total sixty', async () => {
    const user = userEvent.setup()
    const workers = Array.from({ length: 12 }, (_, i) => ({ ...data.workers[0], id: `w${i + 1}`, name: `Worker ${i + 1}` }))
    const { container, rerender } = render(<Labour data={{ ...data, workers, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    await user.click(screen.getByText('Payment & loan overview'))
    const summary = () => screen.getByText('This week’s work days').parentElement!
    expect(within(summary()).getByText('0')).toBeTruthy()
    expect(within(summary()).getByText('No saved payment for this week')).toBeTruthy()
    expect(container.querySelector('.labour-total-detail')?.textContent).toContain('60 days')
    await user.click(screen.getByRole('button', { name: '4 days for Worker 1' }))
    expect(within(summary()).getByText('0')).toBeTruthy()
    expect(container.querySelector('.labour-total-detail')?.textContent).toContain('59 days')
    // Simulate the refreshed records after saving the draft.
    rerender(<Labour data={{ ...data, workers, weeklyPayments: workers.map((worker, i) => ({ id: `pay-${i}`, worker_id: worker.id, week_start: '2026-09-02', amount: (i === 0 ? 4 : 5) * 450, days_worked: i === 0 ? 4 : 5, daily_rate: 450 })) }} year={2026} refresh={refresh} />)
    expect(within(summary()).getByText('59')).toBeTruthy()
    rerender(<Labour data={{ ...data, workers, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    expect(within(summary()).getByText('0')).toBeTruthy()
  })

  it('keeps the work-day summary on saved attendance while editing and excludes skipped payments', async () => {
    const user = userEvent.setup()
    const workers = [...data.workers, { ...data.workers[0], id: 'w2', name: 'Meena' }]
    render(<Labour data={{ ...data, workers, weeklyPayments: [
      { ...data.weeklyPayments[0], days_worked: 3, daily_rate: 450, amount: 1350 },
      { id: 'pay2', worker_id: 'w2', week_start: '2026-09-02', amount: 2250, days_worked: 5, excluded: true }
    ] }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    await user.click(screen.getByText('Payment & loan overview'))
    const summary = screen.getByText('This week’s work days').parentElement!
    expect(within(summary).getByText('3')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit this week' }))
    await user.click(screen.getByRole('button', { name: '6 days for Ravi' }))
    expect(within(summary).getByText('3')).toBeTruthy()
  })

  it('updates attendance with phone controls and saves hidden workers too', async () => {
    const user = userEvent.setup()
    const workers = [...data.workers, { id: 'w2', name: 'Meena', active: true, default_weekly_amount: 2250, default_days_worked: 5 }]
    const { container } = render(<Labour data={{ ...data, workers, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    expect(screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Meena' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' })).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Find worker in weekly pay' }), 'Ravi')
    expect(screen.queryByRole('heading', { name: 'Meena' })).toBeNull()
    for (const day of [4, 5, 6, 1, 2, 3]) {
      const shortcut = screen.getByRole('button', { name: `${day} ${day === 1 ? 'day' : 'days'} for Ravi` })
      await user.click(shortcut)
      expect(shortcut.getAttribute('aria-pressed')).toBe('true')
      expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain(`₹${(day * 450).toLocaleString('en-IN')}`)
    }
    await user.type(screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '250')
    expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain('₹1,100')
    await user.click(screen.getByRole('button', { name: 'Save weekly pay' }))
    expect(api.rpc).toHaveBeenCalledWith('save_weekly_labour', {
      p_week_start: expect.stringMatching(/^2026-09-/),
      p_rows: [
        { worker_id: 'w1', days_worked: 3, daily_rate: 450, excluded: false, personal_deduction: 250 },
        { worker_id: 'w2', days_worked: 5, daily_rate: 450, excluded: false, personal_deduction: 0 }
      ]
    })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('skips a worker without losing their attendance or loan deduction when included again', async () => {
    const user = userEvent.setup()
    const { container } = render(<Labour data={{ ...data, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: '6 days for Ravi' }))
    await user.type(screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '250')
    const skipButton = screen.getByRole('button', { name: 'Skip this week for Ravi' })
    expect(skipButton.textContent).toBe('Skip this week')
    await user.click(skipButton)
    expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain('₹0')
    expect(screen.getByRole('article', { name: 'Ravi' }).textContent).toContain('0 days')
    expect((screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement).value).toBe('0')
    const restoreButton = screen.getByRole('button', { name: 'Add to this week for Ravi' })
    expect(restoreButton.textContent).toBe('Add to this week')
    await user.click(restoreButton)
    expect(screen.getByRole('button', { name: '6 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement).value).toBe('250')
    expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain('₹2,450')
  })

  it('keeps saved fractional attendance and its rate when saving without selecting a different day count', async () => {
    const user = userEvent.setup()
    render(<Labour data={{ ...data, weeklyPayments: [{ ...data.weeklyPayments[0], amount: 1250, days_worked: 2.5, daily_rate: 500, loan_deduction: 0 }] }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    await user.click(screen.getByRole('button', { name: 'Edit this week' }))
    expect(screen.getByText('Current attendance: 2.5 days. Choose a day count to update it.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save updates' }))
    expect(api.rpc).toHaveBeenCalledWith('save_weekly_labour', {
      p_week_start: '2026-09-02',
      p_rows: [{ worker_id: 'w1', days_worked: 2.5, daily_rate: 500, excluded: false, personal_deduction: 0 }]
    })
  })

  it('keeps saved weeks locked and restores wages and deductions when editing is cancelled', async () => {
    const user = userEvent.setup()
    const { container } = render(<Labour data={{ ...data,
      weeklyPayments: [{ ...data.weeklyPayments[0], days_worked: 5, daily_rate: 450 }],
      workerLoans: [...data.workerLoans, { id: 'rep1', worker_id: 'w1', loan_date: '2026-09-02', amount: 250, kind: 'repayment', notes: 'Repayment recorded with weekly payment' }]
    }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    expect(screen.queryByRole('group', { name: 'Days worked by Ravi' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }) as HTMLInputElement).disabled).toBe(true)
    expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain('₹2,000')
    await user.click(screen.getByRole('button', { name: 'Edit this week' }))
    await user.click(screen.getByRole('button', { name: '6 days for Ravi' }))
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('group', { name: 'Days worked by Ravi' })).toBeNull()
    expect(within(screen.getByRole('article', { name: 'Ravi' })).getByText('5 days')).toBeTruthy()
    expect(container.querySelector('.labour-calculated-pay')?.textContent).toContain('₹2,000')
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('preserves the payment draft when a save fails or a week change is cancelled', async () => {
    api.rpc.mockResolvedValueOnce({ error: new Error('Connection unavailable') })
    const user = userEvent.setup()
    render(<Labour data={{ ...data, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: '3 days for Ravi' }))
    await user.click(screen.getByRole('button', { name: 'Save weekly pay' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection unavailable')
    expect(screen.getByRole('button', { name: '3 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    await user.selectOptions(screen.getByLabelText('Month'), '7')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('8')
    expect(screen.getByRole('button', { name: '3 days for Ravi' }).getAttribute('aria-pressed')).toBe('true')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('blocks a deduction beyond the worker’s outstanding loan', async () => {
    const user = userEvent.setup()
    render(<Labour data={{ ...data, weeklyPayments: [] }} year={2026} refresh={refresh} />)
    await user.type(screen.getByRole('textbox', { name: 'Personal loan deduction in rupees for Ravi' }), '1001')
    await user.click(screen.getByRole('button', { name: 'Save weekly pay' }))
    expect(screen.getByRole('alert').textContent).toContain('exceeds the amount still owed')
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('prefills the correct worker for repayments and directs weekly deductions back to their saved week', async () => {
    const user = userEvent.setup()
    render(<Labour data={{ ...data, workerLoans: [...data.workerLoans,
      { id: 'rep1', worker_id: 'w1', loan_date: '2026-09-02', amount: 250, kind: 'repayment', notes: 'Repayment recorded with weekly payment' }
    ] }} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Loans' }))
    expect(screen.queryByRole('button', { name: /Joint loan/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Record repayment for Ravi' }))
    expect((screen.getByLabelText('Worker') as HTMLSelectElement).value).toBe('w1')
    expect((screen.getByLabelText('What are you recording?') as HTMLSelectElement).value).toBe('repayment')
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    await user.click(screen.getByRole('button', { name: 'View statement for Ravi' }))
    expect(screen.getByText('Weekly pay deduction')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Delete repayment/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View weekly pay' }))
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('8')
    expect(screen.getByRole('button', { name: 'Edit this week' })).toBeTruthy()
  })

  it('separates outstanding, settled, and credit accounts without hiding their statements', async () => {
    const user = userEvent.setup()
    render(<Labour data={{ ...data, workers: [...data.workers,
      { id: 'w2', name: 'Meena', active: false, default_weekly_amount: 2250 },
      { id: 'w3', name: 'Lakshmi', active: true, default_weekly_amount: 2250 }
    ], workerLoans: [...data.workerLoans,
      { id: 'a2', worker_id: 'w2', loan_date: '2025-09-01', amount: 1000, kind: 'advance', notes: '' },
      { id: 'r2', worker_id: 'w2', loan_date: '2026-09-01', amount: 1000, kind: 'repayment', notes: '' },
      { id: 'r3', worker_id: 'w3', loan_date: '2026-09-01', amount: 200, kind: 'repayment', notes: '' }
    ] }} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Loans' }))
    expect(screen.getByText('Total outstanding').parentElement?.textContent).toContain('₹1,000')
    expect(screen.queryByRole('heading', { name: 'Meena' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Settled/ }))
    expect(screen.getByRole('heading', { name: 'Meena' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Ravi' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^All accounts/ }))
    expect(screen.getByRole('heading', { name: 'Lakshmi' })).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Search loan accounts' }), 'Festival')
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Lakshmi' })).toBeNull()
  })

  it('shows recent statement entries first and reveals older entries on request', async () => {
    const user = userEvent.setup()
    const records = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, worker_id: 'w1', loan_date: `2026-09-${String(i + 2).padStart(2, '0')}`, amount: 10, kind: 'repayment' as const, notes: `Cash receipt ${i + 1}` }))
    render(<Labour data={{ ...data, workerLoans: [...data.workerLoans, ...records] }} year={2026} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Loans' }))
    expect(screen.queryByText('Cash receipt 12')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View statement for Ravi' }))
    expect(screen.getByText('Cash receipt 12')).toBeTruthy()
    expect(screen.queryByText('Cash receipt 1')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Show older entries/ }))
    expect(screen.getByText('Cash receipt 1')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Statement transaction type'), 'advance')
    expect(screen.getByText('Festival advance')).toBeTruthy()
    expect(screen.queryByText('Cash receipt 12')).toBeNull()
  })

  it('clears a saved week through one transaction and preserves it on failure', async () => {
    const user = userEvent.setup()
    api.rpc.mockResolvedValueOnce({ error: new Error('Could not clear this week') })
    render(<Labour data={data} year={2026} refresh={refresh} />)
    await user.selectOptions(screen.getByLabelText('Month'), '8')
    await user.click(screen.getByRole('button', { name: /Wed.*2 Sept/ }))
    await user.click(screen.getByText('Correct a saved week'))
    await user.click(screen.getByRole('button', { name: 'Clear saved payments for this week' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear saved payments' }))
    expect(api.rpc).toHaveBeenCalledWith('clear_weekly_labour', { p_week_start: '2026-09-02' })
    expect(screen.getByRole('alert').textContent).toContain('Could not clear this week')
    expect(screen.getByRole('button', { name: 'Edit this week' })).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('opens weekly deductions from earlier years on the exact saved date', async () => {
    const user = userEvent.setup()
    const previousData: EstateData = { ...data,
      weeklyPayments: [{ ...data.weeklyPayments[0], week_start: '2025-09-03' }],
      workerLoans: [
        { ...data.workerLoans[0], loan_date: '2025-09-01' },
        { id: 'r1', worker_id: 'w1', loan_date: '2025-09-03', amount: 250, kind: 'repayment', notes: 'Repayment recorded with weekly payment' }
      ]
    }
    function YearHarness() {
      const [year, setYear] = useState(2026)
      return <Labour data={previousData} year={year} refresh={refresh} onYearChange={setYear} />
    }
    render(<YearHarness />)
    await user.click(screen.getByRole('button', { name: 'Loans' }))
    await user.click(screen.getByRole('button', { name: 'View statement for Ravi' }))
    await user.click(screen.getByRole('button', { name: 'View weekly pay' }))
    expect(screen.getByRole('heading', { name: 'Wednesday, 3 Sept' })).toBeTruthy()
    expect((screen.getByLabelText('Month') as HTMLSelectElement).selectedOptions[0].textContent).toContain('2025')
    expect(screen.getByRole('button', { name: 'Edit this week' })).toBeTruthy()
  })
})
