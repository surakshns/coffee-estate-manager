// Versioned, authenticated encryption using the browser's native Web Crypto.
// The password and non-exportable key are never sent to Supabase or persisted.
export const VAULT_ITERATIONS = 600_000
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
export const ENCRYPTION_OVERHEAD = 32
const magic = new Uint8Array([69, 83, 84, 65]) // ESTA, version 1
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const documentFileTypes: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}
export interface DocumentMetadata {
  title: string; category: string; document_date: string | null; notes: string
  file_name: string; file_type: string; file_size: number
}
export interface VaultRecord { user_id: string; salt: string; verifier: string; iterations: number; version: number }

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('Document encryption requires HTTPS and a browser with Web Crypto support.')
  return crypto.subtle
}
function toBase64(bytes: Uint8Array<ArrayBuffer>) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
function fromBase64(value: string, maximum = 32768) {
  if (!value || value.length > maximum || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid encrypted document data.')
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
function context(owner: string, path: string, purpose: string) {
  if (!owner || (path && (!path.startsWith(`${owner}/`) || path.slice(owner.length + 1).includes('/')))) throw new Error('This document belongs to a different account.')
  return encoder.encode(JSON.stringify(['estate-document-vault', 1, owner, path, purpose]))
}
async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>, additionalData: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, data)
  const envelope = new Uint8Array(16 + encrypted.byteLength)
  envelope.set(magic); envelope.set(iv, 4); envelope.set(new Uint8Array(encrypted), 16)
  return envelope
}
async function open(key: CryptoKey, envelope: Uint8Array<ArrayBuffer>, additionalData: Uint8Array<ArrayBuffer>) {
  if (envelope.length < ENCRYPTION_OVERHEAD || !magic.every((value, index) => value === envelope[index])) throw new Error('Invalid encrypted document data.')
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: envelope.slice(4, 16), additionalData, tagLength: 128 }, key, envelope.slice(16)))
  } catch { throw new Error('Could not decrypt this document. The vault password may be wrong, or the file was changed.') }
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const bytes = await deriveBytes(password, salt)
  try { return await subtle().importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']) }
  finally { bytes.fill(0) }
}
async function deriveBytes(password: string, salt: Uint8Array<ArrayBuffer>) {
  const bytes = encoder.encode(password)
  try {
    const material = await subtle().importKey('raw', bytes, 'PBKDF2', false, ['deriveBits'])
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: VAULT_ITERATIONS, hash: 'SHA-256' }, material, 256))
  } finally { bytes.fill(0) }
}
export async function createDocumentVault(owner: string, password: string) {
  if (password.length < 16 || password.length > 1024) throw new Error('Use a unique vault password of 16–1,024 characters. Several random words work well.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await derive(password, salt)
  const verifier = await seal(key, encoder.encode('estate-document-vault-key-v1'), context(owner, '', 'verifier'))
  return { key, record: { user_id: owner, salt: toBase64(salt), verifier: toBase64(verifier), iterations: VAULT_ITERATIONS, version: 1 } satisfies VaultRecord }
}
export async function unlockDocumentVault(record: VaultRecord, owner: string, password: string) {
  if (record.user_id !== owner || record.version !== 1 || record.iterations !== VAULT_ITERATIONS || password.length > 1024) throw new Error('Unsupported document vault configuration.')
  const salt = fromBase64(record.salt, 24)
  if (salt.length !== 16) throw new Error('Invalid document vault salt.')
  const key = await derive(password, salt)
  await verifyKey(record, owner, key)
  return key
}
async function verifyKey(record: VaultRecord, owner: string, key: CryptoKey) {
  if (record.user_id !== owner || record.version !== 1 || record.iterations !== VAULT_ITERATIONS) throw new Error('Unsupported document vault configuration.')
  const verified = await open(key, fromBase64(record.verifier, 256), context(owner, '', 'verifier'))
  try { if (decoder.decode(verified) !== 'estate-document-vault-key-v1') throw new Error('Invalid document vault verifier.') }
  finally { verified.fill(0) }
}
export async function wrapDocumentVaultKey(record: VaultRecord, owner: string, password: string, wrappingKey: CryptoKey, binding: string) {
  if (record.user_id !== owner || record.version !== 1 || record.iterations !== VAULT_ITERATIONS || password.length > 1024) throw new Error('Unsupported document vault configuration.')
  const salt = fromBase64(record.salt, 24)
  if (salt.length !== 16) throw new Error('Invalid document vault salt.')
  const raw = await deriveBytes(password, salt)
  try {
    const key = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    await verifyKey(record, owner, key)
    return toBase64(await seal(wrappingKey, raw, context(owner, '', `passkey:${binding}`)))
  } finally { raw.fill(0) }
}
export async function unwrapDocumentVaultKey(record: VaultRecord, owner: string, wrappingKey: CryptoKey, wrapped: string, binding: string) {
  const raw = await open(wrappingKey, fromBase64(wrapped, 128), context(owner, '', `passkey:${binding}`))
  try {
    if (raw.length !== 32) throw new Error('Invalid wrapped document key.')
    const key = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    await verifyKey(record, owner, key)
    return key
  } finally { raw.fill(0) }
}
export function documentMime(name: string, suppliedType = '') {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const mime = documentFileTypes[extension]
  if (!mime || (suppliedType && suppliedType !== mime && suppliedType !== 'application/octet-stream')) throw new Error('Choose a PDF, JPG, PNG, WebP, Word or Excel file with its matching file type.')
  return mime
}
export async function encryptDocument(key: CryptoKey, owner: string, path: string, blob: Blob) {
  if (!blob.size || blob.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a non-empty document up to 20 MB.')
  const plaintext = new Uint8Array(await blob.arrayBuffer())
  try { return new Blob([await seal(key, plaintext, context(owner, path, 'file'))], { type: 'application/octet-stream' }) }
  finally { plaintext.fill(0) }
}
export async function decryptDocument(key: CryptoKey, owner: string, path: string, blob: Blob, metadata: DocumentMetadata) {
  if (blob.size > MAX_DOCUMENT_BYTES + ENCRYPTION_OVERHEAD) throw new Error('Encrypted document exceeds the size limit.')
  const plaintext = await open(key, new Uint8Array(await blob.arrayBuffer()), context(owner, path, 'file'))
  try {
    if (plaintext.length !== metadata.file_size) throw new Error('Document size does not match its encrypted details.')
    return new Blob([plaintext], { type: metadata.file_type })
  } finally { plaintext.fill(0) }
}
export async function encryptDocumentMetadata(key: CryptoKey, owner: string, path: string, metadata: DocumentMetadata) {
  return toBase64(await seal(key, encoder.encode(JSON.stringify(metadata)), context(owner, path, 'metadata')))
}
export async function decryptDocumentMetadata(key: CryptoKey, owner: string, path: string, value: string): Promise<DocumentMetadata> {
  const bytes = await open(key, fromBase64(value), context(owner, path, 'metadata'))
  try {
    const item = JSON.parse(decoder.decode(bytes)) as DocumentMetadata
    if (!item || !['title', 'category', 'notes', 'file_name', 'file_type'].every(field => typeof item[field as keyof DocumentMetadata] === 'string') || !item.title.trim() || !item.category.trim() || !Number.isInteger(item.file_size) || item.file_size < 1 || item.file_size > MAX_DOCUMENT_BYTES || (item.document_date !== null && (typeof item.document_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.document_date)))) throw new Error('Invalid encrypted document details.')
    documentMime(item.file_name, item.file_type)
    // Return only permitted fields. Never let an encrypted JSON object override
    // record ownership, paths, encryption version or IDs when merged in the UI.
    return { title: item.title, category: item.category, notes: item.notes, file_name: item.file_name, file_type: item.file_type, file_size: item.file_size, document_date: item.document_date }
  } finally { bytes.fill(0) }
}
