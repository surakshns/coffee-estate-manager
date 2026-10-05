import { beforeEach, expect, it, vi } from 'vitest'
import { createDocumentVault, decryptDocument, decryptDocumentMetadata, type DocumentMetadata } from './documentVault'
import { readDocument, storeEncryptedDocument } from './documentStorage'
import type { PropertyDocument } from './types'

const api = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), remove: vi.fn(), insert: vi.fn(), update: vi.fn(), single: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {
  storage: { from: () => ({ upload: api.upload, download: api.download, remove: api.remove }) },
  from: () => ({ insert: api.insert, update: (payload: unknown) => { api.update(payload); const query = { eq: () => query, select: () => ({ single: api.single }) }; return query } })
} }))
const owner = 'account-a'
const blob = new Blob(['confidential property document'], { type: 'application/pdf' })
const metadata: DocumentMetadata = { title: 'Property deed', category: 'Land records', document_date: null, notes: 'Survey 42', file_name: 'private.pdf', file_type: blob.type, file_size: blob.size }
const original: PropertyDocument = { id: 'document-1', ...metadata, file_path: `${owner}/private.pdf`, created_at: '2026-10-05T00:00:00Z', encryption_version: 0 }
const vault = await createDocumentVault(owner, 'unique random words for this document vault')
beforeEach(() => {
  vi.clearAllMocks()
  api.upload.mockResolvedValue({ error: null })
  api.insert.mockResolvedValue({ error: null })
  api.single.mockResolvedValue({ data: { id: original.id }, error: null })
  api.remove.mockResolvedValue({ error: null })
  api.download.mockImplementation(async () => ({ data: api.upload.mock.calls.at(-1)?.[1], error: null }))
})

it('uploads only ciphertext and placeholder metadata; originals are recoverable with the key', async () => {
  await storeEncryptedDocument(blob, metadata, owner, vault.key, () => {})
  const [path, encrypted, options] = api.upload.mock.calls[0]
  expect(path).toMatch(/^account-a\/[0-9a-f-]{36}\.estateenc$/)
  expect(path).not.toContain('private.pdf')
  expect(options).toEqual({ contentType: 'application/octet-stream', cacheControl: '0', upsert: false })
  expect(await encrypted.text()).not.toContain('confidential property')
  const row = api.insert.mock.calls[0][0]
  expect(JSON.stringify(row)).not.toContain('Property deed')
  expect(JSON.stringify(row)).not.toContain('Survey 42')
  expect(row).toMatchObject({ user_id: owner, encryption_version: 1, title: 'Encrypted document', notes: '', file_name: 'encrypted.estateenc' })
  expect(await decryptDocumentMetadata(vault.key, owner, path, row.encrypted_metadata)).toEqual(metadata)
  expect(await (await decryptDocument(vault.key, owner, path, encrypted, metadata)).text()).toBe(await blob.text())
  expect(await (await readDocument({ ...original, file_path: path, encryption_version: 1 }, owner, vault.key)).text()).toBe(await blob.text())
  expect(api.download).toHaveBeenCalledWith(path, {}, { cache: 'no-store' })
})
it('verifies an encrypted legacy replacement before updating its record', async () => {
  await storeEncryptedDocument(blob, metadata, owner, vault.key, () => {}, original)
  expect(api.download).toHaveBeenCalledWith(api.upload.mock.calls[0][0], {}, { cache: 'no-store' })
  expect(api.update).toHaveBeenCalledOnce()
  expect(api.remove).not.toHaveBeenCalled() // original cleanup only after committed replacement
  expect(api.insert).not.toHaveBeenCalled()
})
it('preserves the original when upload verification fails', async () => {
  api.download.mockResolvedValue({ data: new Blob(['corrupted upload']), error: null })
  await expect(storeEncryptedDocument(blob, metadata, owner, vault.key, () => {}, original)).rejects.toThrow(/Invalid/)
  expect(api.update).not.toHaveBeenCalled()
  expect(api.remove).toHaveBeenCalledWith([api.upload.mock.calls[0][0]])
  expect(api.remove).not.toHaveBeenCalledWith([original.file_path])
})
it('preserves the original and cleans up only ciphertext if record replacement fails', async () => {
  api.single.mockResolvedValue({ error: new Error('Update denied') })
  await expect(storeEncryptedDocument(blob, metadata, owner, vault.key, () => {}, original)).rejects.toThrow(/denied/)
  expect(api.remove).toHaveBeenCalledWith([api.upload.mock.calls[0][0]])
  expect(api.remove).not.toHaveBeenCalledWith([original.file_path])
})
it('prevents upload after locking and denies foreign paths before requesting storage', async () => {
  await expect(storeEncryptedDocument(blob, metadata, owner, vault.key, () => { throw new Error('Locked') })).rejects.toThrow(/Locked/)
  expect(api.upload).not.toHaveBeenCalled()
  await expect(readDocument({ ...original, file_path: 'account-b/private.pdf' }, owner, vault.key)).rejects.toThrow(/different account/)
  expect(api.download).not.toHaveBeenCalled()
})
it('cleans up ciphertext when locking after upload, without saving a record', async () => {
  let checks = 0
  await expect(storeEncryptedDocument(blob, metadata, owner, vault.key, () => { if (++checks === 3) throw new Error('Locked') })).rejects.toThrow(/Locked/)
  expect(api.insert).not.toHaveBeenCalled()
  expect(api.remove).toHaveBeenCalledWith([api.upload.mock.calls[0][0]])
})
