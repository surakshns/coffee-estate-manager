// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Documents, DocumentWorkspace } from './Documents'
import { emptyEstateData } from '../hooks/useEstateData'
import type { PropertyDocument } from '../lib/types'

const api = vi.hoisted(() => ({ state: null as any, submit: vi.fn(), lock: vi.fn(), load: vi.fn(), assert: vi.fn(), read: vi.fn(), store: vi.fn(), decryptMetadata: vi.fn(), remove: vi.fn(), queue: vi.fn(), clear: vi.fn() }))
vi.mock('../hooks/useDocumentVault', () => ({ useDocumentVault: () => api.state }))
vi.mock('../lib/documentVault', async importOriginal => ({ ...await importOriginal<typeof import('../lib/documentVault')>(), decryptDocumentMetadata: api.decryptMetadata }))
vi.mock('../lib/documentStorage', () => ({ DOCUMENT_BUCKET: 'property-documents', readDocument: api.read, storeEncryptedDocument: api.store }))
vi.mock('../lib/supabase', () => ({ supabase: {
  storage: { from: () => ({ remove: api.remove }) },
  from: () => ({ select: () => ({ eq: () => ({ limit: api.queue }) }), delete: () => ({ eq: () => ({ eq: api.clear }) }) })
} }))
vi.mock('./PdfReader', () => ({ default: () => <canvas /> }))
const legacy: PropertyDocument = { id: 'document-a', title: 'Secret land title', category: 'Land records', notes: 'Survey 123', document_date: null, file_path: 'account-a/original.pdf', file_name: 'deed.pdf', file_type: 'application/pdf', file_size: 14, created_at: '2026-10-05T00:00:00Z', encryption_version: 0 }
const key = {} as CryptoKey
const data = { ...emptyEstateData, documents: [legacy] }
const refresh = vi.fn(async () => {})
beforeEach(() => {
  vi.clearAllMocks()
  api.state = { owner: 'account-a', record: { user_id: 'account-a' }, key: null, loading: false, busy: false, error: '', submit: api.submit, lock: api.lock, load: api.load, assertUnlocked: api.assert }
  api.queue.mockResolvedValue({ data: [], error: null })
  api.clear.mockResolvedValue({ error: null })
  api.remove.mockResolvedValue({ error: null })
  api.store.mockResolvedValue(undefined)
  api.read.mockResolvedValue(new Blob(['original file'], { type: 'application/pdf' }))
  api.submit.mockResolvedValue(undefined)
  URL.createObjectURL = vi.fn(() => 'blob:private-preview')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(cleanup)
it('hides document titles, notes and actions while locked and does not download files', () => {
  render(<Documents userId="account-a" data={data} refresh={refresh} />)
  expect(screen.getByRole('heading', { name: 'Unlock your documents' })).toBeTruthy()
  expect(screen.queryByText(legacy.title)).toBeNull()
  expect(screen.queryByText(legacy.notes)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Download Secret land title' })).toBeNull()
  expect(api.read).not.toHaveBeenCalled()
})
it('requires matching setup passwords and a saved-password acknowledgement', async () => {
  api.state.record = null
  const user = userEvent.setup()
  render(<Documents userId="account-a" data={data} refresh={refresh} />)
  await user.type(screen.getByLabelText('Vault password'), 'unique random password words')
  await user.type(screen.getByLabelText('Confirm vault password'), 'different password words')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Create encrypted vault' }))
  expect((await screen.findByRole('alert')).textContent).toContain('do not match')
  expect(api.submit).not.toHaveBeenCalled()
  await user.clear(screen.getByLabelText('Confirm vault password'))
  await user.type(screen.getByLabelText('Confirm vault password'), 'unique random password words')
  await user.click(screen.getByRole('button', { name: 'Create encrypted vault' }))
  expect(api.submit).toHaveBeenCalledWith('unique random password words')
  expect((screen.getByLabelText('Vault password') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Confirm vault password') as HTMLInputElement).value).toBe('')
})
it('fails closed if the server vault configuration could not be loaded', async () => {
  api.state.record = null; api.state.error = 'Vault storage unavailable'
  const user = userEvent.setup()
  render(<Documents userId="account-a" data={data} refresh={refresh} />)
  expect(screen.queryByLabelText('Vault password')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Create encrypted vault' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Retry vault loading' }))
  expect(api.load).toHaveBeenCalledOnce()
})
it('releases a decrypted preview and removes file details immediately when locked', async () => {
  api.state.key = key
  const user = userEvent.setup()
  const view = render(<Documents userId="account-a" data={data} refresh={refresh} />)
  await user.click(await screen.findByRole('button', { name: 'Open Secret land title' }))
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
  api.state = { ...api.state, key: null }
  view.rerender(<Documents userId="account-a" data={data} refresh={refresh} />)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText(legacy.title)).toBeNull()
})
it('does not show decrypted details if ciphertext verification fails', async () => {
  api.state.key = key
  api.decryptMetadata.mockRejectedValue(new Error('Tampered ciphertext'))
  render(<Documents userId="account-a" data={{ ...data, documents: [{ ...legacy, encryption_version: 1, encrypted_metadata: 'ciphertext' }] }} refresh={refresh} />)
  expect((await screen.findByRole('alert')).textContent).toContain('could not be verified')
  expect(screen.queryByText(legacy.title)).toBeNull()
  expect(api.read).not.toHaveBeenCalled()
})
it('converts existing files and removes originals only after a successful encrypted replacement', async () => {
  const user = userEvent.setup()
  render(<DocumentWorkspace data={data} refresh={refresh} vault={{ owner: 'account-a', key, lock: api.lock, assertUnlocked: api.assert }} />)
  await user.click(screen.getByRole('button', { name: 'Encrypt existing documents' }))
  expect(api.store).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ title: legacy.title, notes: legacy.notes }), 'account-a', key, api.assert, legacy)
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith([legacy.file_path]))
  expect(api.store.mock.invocationCallOrder[0]).toBeLessThan(api.remove.mock.invocationCallOrder[0])
  expect(refresh).toHaveBeenCalled()
})
it('retains originals after conversion failure and retries durable cleanup on another visit', async () => {
  api.store.mockRejectedValue(new Error('Encrypted upload verification failed'))
  const user = userEvent.setup()
  const view = render(<DocumentWorkspace data={data} refresh={refresh} vault={{ owner: 'account-a', key, lock: api.lock, assertUnlocked: api.assert }} />)
  await user.click(screen.getByRole('button', { name: 'Encrypt existing documents' }))
  expect((await screen.findByRole('alert')).textContent).toContain('verification failed')
  expect(api.remove).not.toHaveBeenCalled()
  view.unmount()
  api.queue.mockResolvedValueOnce({ data: [{ file_path: legacy.file_path }], error: null })
  render(<DocumentWorkspace data={{ ...data, documents: [] }} refresh={refresh} vault={{ owner: 'account-a', key, lock: api.lock, assertUnlocked: api.assert }} />)
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith([legacy.file_path]))
  expect(api.clear).toHaveBeenCalledWith('file_path', legacy.file_path)
})
it('never creates a plaintext URL for a download that completes after locking', async () => {
  let complete!: (blob: Blob) => void
  api.read.mockReturnValue(new Promise(resolve => { complete = resolve }))
  api.state.key = key
  const user = userEvent.setup()
  const view = render(<Documents userId="account-a" data={data} refresh={refresh} />)
  await user.click(await screen.findByRole('button', { name: 'Download Secret land title' }))
  api.state = { ...api.state, key: null }
  view.rerender(<Documents userId="account-a" data={data} refresh={refresh} />)
  await act(async () => { complete(new Blob(['private contents'])); await Promise.resolve() })
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
