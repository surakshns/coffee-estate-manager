// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EstateData } from '../lib/types'
import { Expenses } from './Expenses'
import { Documents } from './Documents'
import { Production } from './Production'
import { Labour } from './Labour'

const api = vi.hoisted(() => ({
  insert: vi.fn(), update: vi.fn(), eq: vi.fn(), download: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), getUser: vi.fn(), upsert: vi.fn()
}))
vi.mock('./PdfReader', () => ({ default: ({ title }: { title: string }) => <canvas role="img" aria-label={title + ', page 1'} /> }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: api.insert, update: api.update, delete: () => ({ eq: api.eq }), upsert: api.upsert }),
    auth: { getUser: api.getUser },
    storage: { from: () => ({ download: api.download, upload: api.upload, remove: api.remove }) }
  }
}))

const refresh = vi.fn(async () => {})
const data: EstateData = {
  workers: [{ id: 'w1', name: 'Ravi', active: true, default_weekly_amount: 2250, default_days_worked: 5 }],
  weeklyPayments: [{ id: 'pay1', worker_id: 'w1', week_start: '2026-09-02', amount: 2250, loan_deduction: 250 }],
  workerLoans: [{ id: 'loan1', worker_id: 'w1', loan_date: '2026-09-01', amount: 1000, kind: 'advance', notes: 'Festival advance' }],
  labourRates: [], jointLoans: [], jointLoanRepayments: [], prices: [], monthlyGuideEntries: [],
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
    expect(screen.getByText('Festival advance')).toBeTruthy()
    expect(screen.queryByLabelText('What are you recording?')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Advance / repayment' }))
    expect(screen.getByLabelText('What are you recording?')).toBeTruthy()
  })
})
