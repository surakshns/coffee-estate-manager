import { supabase } from './supabase'
import { decryptDocument, documentMime, encryptDocument, encryptDocumentMetadata, type DocumentMetadata } from './documentVault'
import type { PropertyDocument } from './types'

export const DOCUMENT_BUCKET = 'property-documents'
function ownPath(owner: string, path: string) {
  if (!path.startsWith(`${owner}/`) || path.slice(owner.length + 1).includes('/')) throw new Error('This document belongs to a different account.')
}
export async function readDocument(item: PropertyDocument, owner: string, key: CryptoKey, signal?: AbortSignal) {
  ownPath(owner, item.file_path)
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(item.file_path, {}, { cache: 'no-store', ...(signal ? { signal } : {}) })
  if (error || !data) throw error ?? new Error('Document unavailable.')
  if (signal?.aborted) throw new Error('Document request was cancelled.')
  const mime = documentMime(item.file_name, item.file_type ?? '')
  if (!item.encryption_version) return new Blob([data], { type: mime })
  if (item.encryption_version !== 1 || !item.file_size) throw new Error('Unsupported encrypted document.')
  return decryptDocument(key, owner, item.file_path, data, { ...item, file_type: mime, file_size: item.file_size })
}
export async function storeEncryptedDocument(blob: Blob, metadata: DocumentMetadata, owner: string, key: CryptoKey, assertUnlocked: () => void, existing?: PropertyDocument) {
  assertUnlocked()
  if (existing) ownPath(owner, existing.file_path)
  const path = `${owner}/${crypto.randomUUID()}.estateenc`
  const encrypted = await encryptDocument(key, owner, path, blob)
  const encryptedMetadata = await encryptDocumentMetadata(key, owner, path, metadata)
  assertUnlocked()
  const storage = supabase.storage.from(DOCUMENT_BUCKET)
  const uploaded = await storage.upload(path, encrypted, { contentType: 'application/octet-stream', cacheControl: '0', upsert: false })
  if (uploaded.error) throw uploaded.error
  try {
    if (existing) {
      // Verify the persisted ciphertext before replacing a legacy record. A
      // failed write/decryption never deletes the owner's original document.
      const verified = await storage.download(path, {}, { cache: 'no-store' })
      if (verified.error || !verified.data) throw verified.error ?? new Error('Could not verify the encrypted upload.')
      assertUnlocked()
      const restored = await decryptDocument(key, owner, path, verified.data, metadata)
      const [originalHash, restoredHash] = await Promise.all([blob.arrayBuffer(), restored.arrayBuffer()].map(async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', await bytes))))
      if (!originalHash.every((byte, index) => byte === restoredHash[index])) throw new Error('The encrypted copy failed verification. Your original file has been preserved.')
    }
    assertUnlocked()
    const payload = { user_id: owner, title: 'Encrypted document', category: 'Other', document_date: null, notes: '', file_path: path, file_name: 'encrypted.estateenc', file_type: 'application/octet-stream', file_size: encrypted.size, encryption_version: 1, encrypted_metadata: encryptedMetadata }
    if (existing) {
      const result = await supabase.from('property_documents').update(payload).eq('id', existing.id).eq('user_id', owner).eq('file_path', existing.file_path).select('id').single()
      if (result.error || !result.data) throw result.error ?? new Error('Document changed during encryption. Try again.')
    } else {
      const result = await supabase.from('property_documents').insert(payload)
      if (result.error) throw result.error
    }
  } catch (cause) {
    // Only ciphertext is discarded here. Original files are retained until a
    // committed metadata replacement queues durable, owner-scoped cleanup.
    await storage.remove([path]).catch(() => {})
    throw cause
  }
}
