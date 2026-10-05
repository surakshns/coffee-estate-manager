import { beforeAll, describe, expect, it } from 'vitest'
import { createDocumentVault, decryptDocument, decryptDocumentMetadata, documentMime, encryptDocument, encryptDocumentMetadata, unlockDocumentVault, type DocumentMetadata } from './documentVault'

const owner = 'account-a'
const path = `${owner}/123.estateenc`
const password = 'separate random words for my property vault'
const content = '%PDF property survey number 123 — café'
const blob = new Blob([content], { type: 'application/pdf' })
const metadata: DocumentMetadata = { title: 'Land ownership', category: 'Land records', document_date: '2026-10-05', notes: 'Private survey details', file_name: 'title-deed.pdf', file_type: blob.type, file_size: blob.size }
let vault: Awaited<ReturnType<typeof createDocumentVault>>
beforeAll(async () => { vault = await createDocumentVault(owner, password) })

describe('document vault authenticated encryption', () => {
  it('round-trips contents and identifying details with a non-exportable AES-256 key', async () => {
    expect(vault.key.extractable).toBe(false)
    expect(vault.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', vault.key)).rejects.toThrow()
    const encrypted = await encryptDocument(vault.key, owner, path, blob)
    expect(encrypted.type).toBe('application/octet-stream')
    expect(encrypted.size).toBe(blob.size + 32)
    expect(await encrypted.text()).not.toContain('property survey')
    const details = await encryptDocumentMetadata(vault.key, owner, path, metadata)
    expect(details).not.toContain('Land ownership')
    expect(await decryptDocumentMetadata(vault.key, owner, path, details)).toEqual(metadata)
    const key = await unlockDocumentVault(vault.record, owner, password)
    expect(await (await decryptDocument(key, owner, path, encrypted, metadata)).text()).toBe(content)
  })
  it('rejects wrong passwords, another account, unsupported versions and weaker derivation', async () => {
    await expect(unlockDocumentVault(vault.record, owner, 'incorrect password')).rejects.toThrow(/decrypt/)
    await expect(unlockDocumentVault(vault.record, 'account-b', password)).rejects.toThrow(/configuration/)
    await expect(unlockDocumentVault({ ...vault.record, iterations: 1 }, owner, password)).rejects.toThrow()
    await expect(unlockDocumentVault({ ...vault.record, version: 2 }, owner, password)).rejects.toThrow()
    await expect(createDocumentVault(owner, 'weak')).rejects.toThrow(/16/)
  })
  it('uses fresh randomness for every encryption and vault', async () => {
    const a = await encryptDocument(vault.key, owner, path, blob)
    const b = await encryptDocument(vault.key, owner, path, blob)
    expect(new Uint8Array(await a.arrayBuffer())).not.toEqual(new Uint8Array(await b.arrayBuffer()))
    expect((await createDocumentVault(owner, password)).record.salt).not.toBe(vault.record.salt)
  })
  it('detects changed ciphertext, mismatched size and swapped file/metadata contexts', async () => {
    const encrypted = await encryptDocument(vault.key, owner, path, blob)
    const bytes = new Uint8Array(await encrypted.arrayBuffer()); bytes[bytes.length - 1] ^= 1
    await expect(decryptDocument(vault.key, owner, path, new Blob([bytes]), metadata)).rejects.toThrow(/decrypt/)
    await expect(decryptDocument(vault.key, owner, `${owner}/other.estateenc`, encrypted, metadata)).rejects.toThrow(/decrypt/)
    await expect(decryptDocument(vault.key, 'account-b', path, encrypted, metadata)).rejects.toThrow(/different account/)
    await expect(decryptDocument(vault.key, owner, path, encrypted, { ...metadata, file_size: blob.size + 1 })).rejects.toThrow(/size/)
    const details = await encryptDocumentMetadata(vault.key, owner, path, metadata)
    await expect(decryptDocument(vault.key, owner, path, new Blob([Uint8Array.from(atob(details), c => c.charCodeAt(0))]), metadata)).rejects.toThrow(/decrypt/)
  })
  it('rejects malformed envelopes, unsupported file types and MIME mismatches', async () => {
    await expect(decryptDocument(vault.key, owner, path, new Blob(['plaintext']), metadata)).rejects.toThrow(/Invalid/)
    await expect(decryptDocumentMetadata(vault.key, owner, path, '!not-base64')).rejects.toThrow(/Invalid/)
    expect(() => documentMime('deed.html', 'text/html')).toThrow()
    expect(() => documentMime('deed.pdf', 'image/png')).toThrow()
    expect(documentMime('deed.PDF')).toBe('application/pdf')
    await expect(encryptDocument(vault.key, owner, path, new Blob())).rejects.toThrow(/non-empty/)
  })
  it('never lets encrypted metadata overwrite ownership, paths or encryption flags', async () => {
    const details = await encryptDocumentMetadata(vault.key, owner, path, { ...metadata, file_path: 'other/file', encryption_version: 0 } as DocumentMetadata)
    expect(await decryptDocumentMetadata(vault.key, owner, path, details)).toEqual(metadata)
  })
})
