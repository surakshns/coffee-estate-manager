// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PdfReader from './PdfReader'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), getPage: vi.fn(), render: vi.fn(), cancel: vi.fn(), destroy: vi.fn() }))
vi.mock('pdfjs-dist', () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.mjs' }))

beforeEach(() => {
  vi.clearAllMocks()
  pdf.render.mockReturnValue({ promise: Promise.resolve(), cancel: pdf.cancel })
  pdf.getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: pdf.render })
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage: pdf.getPage }), destroy: pdf.destroy })
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 324 } }]) }
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('fits pages to the reader width and supports page changes and zoom', async () => {
  const user = userEvent.setup()
  render(<PdfReader url="blob:fixture" title="Land record" />)
  await waitFor(() => expect(pdf.render).toHaveBeenCalled())
  const canvas = screen.getByRole('img', { name: 'Land record, page 1' })
  expect(canvas.style.width).toBe('300px')
  expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true)
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => expect(pdf.getPage).toHaveBeenLastCalledWith(2))
  expect(screen.getByText('Page 2 of 3')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  await waitFor(() => expect(canvas.style.width).toBe('375px'))
  await user.click(screen.getByRole('button', { name: 'Fit to width' }))
  await waitFor(() => expect(canvas.style.width).toBe('300px'))
})

it('cancels rendering and destroys the PDF when closed', async () => {
  const { unmount } = render(<PdfReader url="blob:fixture" title="Land record" />)
  await waitFor(() => expect(pdf.render).toHaveBeenCalled())
  unmount()
  expect(pdf.cancel).toHaveBeenCalled()
  expect(pdf.destroy).toHaveBeenCalled()
})

it('offers a useful fallback for password-protected documents', async () => {
  pdf.getDocument.mockReturnValueOnce({ promise: Promise.reject({ name: 'PasswordException' }), destroy: pdf.destroy })
  render(<PdfReader url="blob:fixture" title="Land record" />)
  expect((await screen.findByRole('alert')).textContent).toContain('password protected')
})
