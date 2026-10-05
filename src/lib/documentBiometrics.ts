import { unwrapDocumentVaultKey, wrapDocumentVaultKey, type VaultRecord } from './documentVault'

export interface BiometricVaultRecord {
  version: 1; owner: string; origin: string; rpId: string; credentialId: string
  prfSalt: string; wrappingSalt: string; wrappedKey: string; vaultFingerprint: string
}
type PrfOutput = AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }
const text = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
function encode(bytes: Uint8Array<ArrayBuffer>) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function bytes(value: string, limit = 2048) {
  if (!value || value.length > limit || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid phone unlock configuration.')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}
function storageKey(owner: string) { return `estate-document-passkey:${location.origin}:${import.meta.env.BASE_URL}:${owner}` }
function binding(record: BiometricVaultRecord) { return JSON.stringify([record.version, record.owner, record.origin, record.rpId, record.credentialId, record.vaultFingerprint]) }
async function fingerprint(record: VaultRecord) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify([record.user_id, record.version, record.iterations, record.salt, record.verifier])))))
}
function directWindow() {
  try { return window.top === window.self } catch { return false }
}
function phoneUnlockSupported() {
  return !!(window.isSecureContext && directWindow() && globalThis.PublicKeyCredential && typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function' && globalThis.crypto?.subtle)
}
export async function phoneUnlockAvailable() {
  if (!phoneUnlockSupported()) return false
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}
function checkedRecord(value: unknown, owner: string, complete: boolean): BiometricVaultRecord {
  const item = value as BiometricVaultRecord
  if (!item || item.version !== 1 || item.owner !== owner || item.origin !== location.origin || item.rpId !== location.hostname || !['credentialId', 'prfSalt', 'wrappingSalt', 'wrappedKey', 'vaultFingerprint'].every(field => typeof item[field as keyof BiometricVaultRecord] === 'string')) throw new Error('Invalid phone unlock configuration.')
  bytes(item.credentialId)
  if (bytes(item.prfSalt, 64).length !== 32 || bytes(item.wrappingSalt, 64).length !== 32 || bytes(item.vaultFingerprint, 64).length !== 32) throw new Error('Invalid phone unlock configuration.')
  if (complete ? item.wrappedKey.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.wrappedKey) || atob(item.wrappedKey).length !== 64 : item.wrappedKey !== '') throw new Error('Invalid phone unlock configuration.')
  return { version: 1, owner: item.owner, origin: item.origin, rpId: item.rpId, credentialId: item.credentialId, prfSalt: item.prfSalt, wrappingSalt: item.wrappingSalt, wrappedKey: item.wrappedKey, vaultFingerprint: item.vaultFingerprint }
}
export function loadPhoneUnlock(owner: string): BiometricVaultRecord | null {
  try {
    const stored = localStorage.getItem(storageKey(owner))
    if (!stored || stored.length > 8192) return null
    return checkedRecord(JSON.parse(stored), owner, true)
  } catch { return null }
}
export function savePhoneUnlock(record: BiometricVaultRecord) {
  const checked = checkedRecord(record, record.owner, true)
  localStorage.setItem(storageKey(checked.owner), JSON.stringify(checked))
}
export function removePhoneUnlock(owner: string) { localStorage.removeItem(storageKey(owner)) }
async function wrappingKey(secret: unknown, salt: Uint8Array<ArrayBuffer>) {
  // WebAuthn permits any BufferSource here, including views with non-zero
  // offsets. Copy the exact bytes so every supported type derives one key.
  const source = secret instanceof ArrayBuffer ? new Uint8Array(secret) : ArrayBuffer.isView(secret) ? new Uint8Array(secret.buffer, secret.byteOffset, secret.byteLength) : null
  if (!source || source.byteLength !== 32) throw new Error('This phone or passkey provider cannot securely unlock encrypted documents. Use your vault password.')
  const output = new Uint8Array(source)
  try {
    const material = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: text.encode('estate-document-passkey-wrap-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally { output.fill(0); source.fill(0) }
}
function assertClientData(response: AuthenticatorResponse, challenge: Uint8Array<ArrayBuffer>, type: 'webauthn.get' | 'webauthn.create') {
  const client = JSON.parse(decode.decode(response.clientDataJSON))
  if (!client || client.type !== type || client.challenge !== encode(challenge) || client.origin !== location.origin || client.crossOrigin === true) throw new Error('Phone unlock verification failed.')
}
async function assertCredential(credential: PublicKeyCredential, record: BiometricVaultRecord, challenge: Uint8Array<ArrayBuffer>) {
  if (credential.type !== 'public-key' || encode(new Uint8Array(credential.rawId)) !== record.credentialId) throw new Error('The phone returned a different passkey.')
  const response = credential.response as AuthenticatorAssertionResponse
  assertClientData(response, challenge, 'webauthn.get')
  const auth = new Uint8Array(response.authenticatorData)
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(record.rpId)))
  if (auth.length < 37 || (auth[32] & 5) !== 5 || !rpHash.every((value, index) => auth[index] === value)) throw new Error('Phone unlock requires verified fingerprint, face recognition or device PIN.')
  const output = (credential.getClientExtensionResults() as PrfOutput).prf?.results?.first
  if (!output || output.byteLength !== 32) throw new Error('This phone or passkey provider cannot securely unlock encrypted documents. Use your vault password.')
  return wrappingKey(output, bytes(record.wrappingSalt, 64))
}
async function requestWrappingKey(record: BiometricVaultRecord, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!window.isSecureContext || !directWindow() || record.origin !== location.origin || record.rpId !== location.hostname) throw new Error('Open this app directly over HTTPS to use phone unlock.')
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.get({ signal, publicKey: {
    challenge, rpId: record.rpId, timeout: 60_000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: bytes(record.credentialId), transports: ['internal'] }],
    extensions: { prf: { eval: { first: bytes(record.prfSalt, 64).buffer } } } as AuthenticationExtensionsClientInputs
  } }) as PublicKeyCredential | null
  signal?.throwIfAborted()
  if (!credential) throw new Error('Phone unlock was cancelled. Use your vault password or try again.')
  return assertCredential(credential, record, challenge)
}
export async function beginPhoneUnlockSetup(vault: VaultRecord, owner: string, assertActive: () => void, signal?: AbortSignal) {
  if (vault.user_id !== owner) throw new Error('This document vault belongs to a different account.')
  signal?.throwIfAborted()
  if (!phoneUnlockSupported()) throw new Error('Fingerprint / face unlock is unavailable in this browser. Use your vault password.')
  assertActive()
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  // Safari requires this call to retain the button's user activation. Capability
  // probes, authentication requests and crypto digests must not run before it.
  const credential = await navigator.credentials.create({ signal, publicKey: {
    challenge, rp: { id: location.hostname, name: 'Coffee Estate document vault' },
    user: { id: text.encode(owner), name: owner, displayName: 'Private property documents' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    timeout: 60_000, attestation: 'none', extensions: { prf: {} } as AuthenticationExtensionsClientInputs
  } }) as PublicKeyCredential | null
  signal?.throwIfAborted()
  if (!credential || credential.type !== 'public-key' || (credential.getClientExtensionResults() as PrfOutput).prf?.enabled !== true) throw new Error('This phone or passkey provider cannot securely unlock encrypted documents. Use your vault password.')
  assertClientData(credential.response, challenge, 'webauthn.create')
  assertActive()
  const record: BiometricVaultRecord = {
    version: 1, owner, origin: location.origin, rpId: location.hostname,
    credentialId: encode(new Uint8Array(credential.rawId)), prfSalt: encode(crypto.getRandomValues(new Uint8Array(32))),
    wrappingSalt: encode(crypto.getRandomValues(new Uint8Array(32))), wrappedKey: '', vaultFingerprint: await fingerprint(vault)
  }
  signal?.throwIfAborted()
  assertActive()
  return record
}
export async function finishPhoneUnlockSetup(vault: VaultRecord, owner: string, password: string, pending: BiometricVaultRecord, assertActive: () => void, signal?: AbortSignal) {
  if (vault.user_id !== owner) throw new Error('This document vault belongs to a different account.')
  signal?.throwIfAborted()
  const record = checkedRecord(pending, owner, false)
  assertActive()
  // This assertion starts on a separate explicit tap. Advertised PRF support
  // alone never enables unlock: an actual verified PRF output is required.
  const key = await requestWrappingKey(record, signal)
  assertActive()
  if (record.vaultFingerprint !== await fingerprint(vault)) throw new Error('The document vault changed during phone unlock setup. Start setup again.')
  signal?.throwIfAborted()
  assertActive()
  record.wrappedKey = await wrapDocumentVaultKey(vault, owner, password, key, binding(record))
  signal?.throwIfAborted()
  assertActive()
  // Persistence belongs to the hook, after it verifies the authenticated owner
  // and checks that the active setup has not been cancelled or superseded.
  return record
}
export async function unlockWithPhone(vault: VaultRecord, owner: string, signal?: AbortSignal) {
  if (vault.user_id !== owner) throw new Error('This document vault belongs to a different account.')
  signal?.throwIfAborted()
  const record = loadPhoneUnlock(owner)
  if (!record) throw new Error('Phone unlock needs setup again. Unlock with your vault password first.')
  // Start the native prompt before awaiting a digest, so Safari receives the
  // original tap. The fingerprint still must match before any key is unwrapped.
  const key = await requestWrappingKey(record, signal)
  if (record.vaultFingerprint !== await fingerprint(vault)) throw new Error('Phone unlock needs setup again. Unlock with your vault password first.')
  signal?.throwIfAborted()
  const unlocked = await unwrapDocumentVaultKey(vault, owner, key, record.wrappedKey, binding(record))
  signal?.throwIfAborted()
  return unlocked
}
