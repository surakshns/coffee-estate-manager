import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginPhoneUnlockSetup, finishPhoneUnlockSetup, savePhoneUnlock, loadPhoneUnlock, phoneUnlockAvailable, removePhoneUnlock, unlockWithPhone, type BiometricVaultRecord } from './documentBiometrics'
import { createDocumentVault, decryptDocumentMetadata, encryptDocumentMetadata, type VaultRecord } from './documentVault'

const owner = 'account-a'
const password = 'separate random words for my property vault'
const origin = 'https://estate.example'
const credentialId = new Uint8Array([7, 12, 63, 80, 11, 190])
const prf = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const encoder = new TextEncoder()
function base64url(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function jsonBuffer(value: unknown) { return encoder.encode(JSON.stringify(value)).buffer }
let vault: Awaited<ReturnType<typeof createDocumentVault>>
let fixture: BiometricVaultRecord
let savedKey = ''
let values: Map<string, string>
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> }
let create: ReturnType<typeof vi.fn>
let get: ReturnType<typeof vi.fn>
let available: ReturnType<typeof vi.fn>
let createMutation: (credential: any) => void
let getMutation: (credential: any) => void
let secret: BufferSource | undefined

function installBrowser() {
  values = new Map()
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) })
  }
  const windowObject: Record<string, unknown> = { isSecureContext: true }
  windowObject.self = windowObject; windowObject.top = windowObject
  available = vi.fn().mockResolvedValue(true)
  createMutation = () => {}; getMutation = () => {}; secret = undefined
  create = vi.fn(async (options: CredentialCreationOptions) => {
    const credential = {
      type: 'public-key', rawId: new Uint8Array(credentialId).buffer,
      response: { clientDataJSON: jsonBuffer({ type: 'webauthn.create', challenge: base64url(new Uint8Array(options.publicKey!.challenge as ArrayBuffer)), origin, crossOrigin: false }) },
      getClientExtensionResults: () => ({ prf: { enabled: true } })
    }
    createMutation(credential)
    return credential
  })
  get = vi.fn(async (options: CredentialRequestOptions) => {
    const authenticatorData = new Uint8Array(37)
    authenticatorData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('estate.example'))))
    authenticatorData[32] = 5
    const credential = {
      type: 'public-key', rawId: new Uint8Array(credentialId).buffer,
      response: {
        clientDataJSON: jsonBuffer({ type: 'webauthn.get', challenge: base64url(new Uint8Array(options.publicKey!.challenge as ArrayBuffer)), origin, crossOrigin: false }),
        authenticatorData: authenticatorData.buffer
      },
      getClientExtensionResults: () => ({ prf: { results: { first: secret ?? new Uint8Array(prf).buffer } } })
    }
    getMutation(credential)
    return credential
  })
  vi.stubGlobal('window', windowObject)
  vi.stubGlobal('location', { origin, hostname: 'estate.example' })
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { credentials: { create, get } })
  vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: available })
}
function setStored(change: Partial<BiometricVaultRecord>) { values.set(savedKey, JSON.stringify({ ...fixture, ...change })) }
function mutateClient(credential: any, change: Record<string, unknown>) {
  const data = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON))
  credential.response.clientDataJSON = jsonBuffer({ ...data, ...change })
}
// Tests invoke the separate phases explicitly; the UI must give each native
// prompt its own tap and verify the signed-in owner before saving the result.
async function completeSetup(record: VaultRecord, account: string, secret: string, assertActive: () => void) {
  const pending = await beginPhoneUnlockSetup(record, account, assertActive)
  const complete = await finishPhoneUnlockSetup(record, account, secret, pending, assertActive)
  savePhoneUnlock(complete)
  return complete
}
beforeAll(async () => {
  installBrowser()
  vault = await createDocumentVault(owner, password)
  fixture = await completeSetup(vault.record, owner, password, () => {})
  savedKey = [...values.keys()][0]
})
beforeEach(() => { installBrowser(); values.set(savedKey, JSON.stringify(fixture)) })
afterEach(() => { vi.unstubAllGlobals() })

describe('encrypted phone vault unlock', () => {
  it('enrolls a platform passkey with verification and persists only an encrypted vault key', async () => {
    values.clear()
    const active = vi.fn()
    const result = await completeSetup(vault.record, owner, password, active)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({
      rp: expect.objectContaining({ id: 'estate.example' }),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      attestation: 'none'
    }) }))
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({
      userVerification: 'required', rpId: 'estate.example',
      allowCredentials: [{ type: 'public-key', id: credentialId, transports: ['internal'] }]
    }) }))
    expect(active).toHaveBeenCalled()
    expect(result.wrappedKey).not.toBe(fixture.wrappedKey)
    expect(result.prfSalt).not.toBe(fixture.prfSalt)
    expect(result.wrappingSalt).not.toBe(fixture.wrappingSalt)
    const stored = [...values.values()][0]
    expect(stored).not.toContain(password)
    expect(stored).not.toContain(base64url(prf))
    expect(JSON.parse(stored)).toEqual(loadPhoneUnlock(owner))
  })
  it('opens the real encrypted vault with a non-exportable active key', async () => {
    const key = await unlockWithPhone(vault.record, owner)
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
    const metadata = { title: 'Land ownership', category: 'Land records', document_date: null, notes: 'Private survey', file_name: 'deed.pdf', file_type: 'application/pdf', file_size: 123 }
    const encrypted = await encryptDocumentMetadata(vault.key, owner, `${owner}/one.estateenc`, metadata)
    expect(await decryptDocumentMetadata(key, owner, `${owner}/one.estateenc`, encrypted)).toEqual(metadata)
  })
  it.each(['Uint8Array', 'DataView', 'Uint32Array'] as const)('accepts an exact PRF %s view at a non-zero offset and clears secret bytes', async type => {
    const bytes = new Uint8Array(40); bytes.set(prf, 4)
    secret = type === 'Uint8Array' ? bytes.subarray(4, 36) : type === 'DataView' ? new DataView(bytes.buffer, 4, 32) : new Uint32Array(bytes.buffer, 4, 8)
    const key = await unlockWithPhone(vault.record, owner)
    expect(key.extractable).toBe(false)
    expect(bytes.subarray(4, 36)).toEqual(new Uint8Array(32))
  })
  it('never enables unlock on registration advertising support without a usable PRF assertion', async () => {
    getMutation = credential => { credential.getClientExtensionResults = () => ({ prf: {} }) }
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow(/cannot securely unlock/)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
    secret = new Uint8Array(31)
    getMutation = () => {}
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/cannot securely unlock/)
  })
  it('fails closed on cancellation, abortion and unsupported registration', async () => {
    create.mockResolvedValueOnce(null)
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow()
    createMutation = credential => { credential.getClientExtensionResults = () => ({}) }
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow(/cannot securely unlock/)
    get.mockResolvedValueOnce(null)
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/cancelled/)
    const controller = new AbortController(); controller.abort()
    await expect(unlockWithPhone(vault.record, owner, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('discards an assertion that resolves after cancellation', async () => {
    const controller = new AbortController()
    getMutation = () => controller.abort()
    await expect(unlockWithPhone(vault.record, owner, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects invalid registration origin and challenge before wrapping', async () => {
    createMutation = credential => mutateClient(credential, { origin: 'https://attacker.example' })
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow(/verification failed/)
    createMutation = credential => mutateClient(credential, { challenge: 'wrong-challenge' })
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow(/verification failed/)
    expect(get).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it.each([
    ['origin', 'https://attacker.example'], ['challenge', 'wrong-challenge'],
    ['type', 'webauthn.create'], ['crossOrigin', true]
  ])('rejects an assertion with wrong client %s', async (field, value) => {
    getMutation = credential => mutateClient(credential, { [field]: value })
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/verification failed/)
  })
  it('rejects the wrong credential, RP hash, or missing user presence/verification', async () => {
    getMutation = credential => { credential.rawId = new Uint8Array([99]).buffer }
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/different passkey/)
    getMutation = credential => { new Uint8Array(credential.response.authenticatorData)[0] ^= 1 }
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/requires verified/)
    for (const flag of [0, 1, 4]) {
      getMutation = credential => { new Uint8Array(credential.response.authenticatorData)[32] = flag }
      await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/requires verified/)
    }
  })
  it('cannot unwrap altered ciphertext or a different PRF secret', async () => {
    const changed = Uint8Array.from(atob(fixture.wrappedKey), value => value.charCodeAt(0)); changed[changed.length - 1] ^= 1
    setStored({ wrappedKey: btoa(String.fromCharCode(...changed)) })
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/decrypt/)
    setStored({})
    secret = new Uint8Array(32)
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/decrypt/)
  })
  it('rejects account changes before prompting and vault changes before unwrapping', async () => {
    expect(loadPhoneUnlock('account-b')).toBeNull()
    await expect(unlockWithPhone(vault.record, 'account-b')).rejects.toThrow(/different account/)
    await expect(completeSetup(vault.record, 'account-b', password, () => {})).rejects.toThrow(/different account/)
    expect(get).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    await expect(unlockWithPhone({ ...vault.record, verifier: 'changed' }, owner)).rejects.toThrow(/setup again/)
    expect(get).toHaveBeenCalledTimes(1)
    setStored({ origin: 'https://other.example' }); expect(loadPhoneUnlock(owner)).toBeNull()
    setStored({ owner: 'account-b' }); expect(loadPhoneUnlock(owner)).toBeNull()
  })
  it('requires the correct vault password and an active session to finish enrollment', async () => {
    await expect(completeSetup(vault.record, owner, 'incorrect vault password', () => {})).rejects.toThrow(/decrypt/)
    const assertActive = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('Vault locked') })
    await expect(completeSetup(vault.record, owner, password, assertActive)).rejects.toThrow(/Vault locked/)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('handles denied browser storage and fails setup rather than claiming it was saved', async () => {
    storage.getItem.mockImplementationOnce(() => { throw new Error('Storage denied') })
    expect(loadPhoneUnlock(owner)).toBeNull()
    storage.setItem.mockImplementationOnce(() => { throw new Error('Storage denied') })
    await expect(completeSetup(vault.record, owner, password, () => {})).rejects.toThrow(/Storage denied/)
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
    storage.removeItem.mockImplementationOnce(() => { throw new Error('Storage denied') })
    expect(() => removePhoneUnlock(owner)).toThrow(/Storage denied/)
    removePhoneUnlock(owner)
    expect(loadPhoneUnlock(owner)).toBeNull()
  })
  it('rejects malformed or oversized stored configuration and ignores unknown properties', () => {
    for (const stored of ['null', '{}', 'invalid JSON', ' '.repeat(8193), JSON.stringify({ ...fixture, wrappedKey: {} }), JSON.stringify({ ...fixture, prfSalt: 'bad' })]) {
      values.set(savedKey, stored)
      expect(loadPhoneUnlock(owner)).toBeNull()
    }
    values.set(savedKey, JSON.stringify({ ...fixture, extra: 'untrusted' }))
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
  })
  it('requires HTTPS, a top-level window and a verified platform authenticator', async () => {
    expect(await phoneUnlockAvailable()).toBe(true)
    available.mockResolvedValue(false)
    expect(await phoneUnlockAvailable()).toBe(false)
    available.mockRejectedValue(new Error('Unsupported'))
    expect(await phoneUnlockAvailable()).toBe(false)
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(await phoneUnlockAvailable()).toBe(false)
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/directly over HTTPS/)
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(window, 'top', { value: {}, configurable: true })
    expect(await phoneUnlockAvailable()).toBe(false)
    await expect(unlockWithPhone(vault.record, owner)).rejects.toThrow(/directly over HTTPS/)
  })
  it('starts registration in the tap call stack without awaiting a platform capability probe or digest', async () => {
    available.mockImplementation(() => new Promise(() => {}))
    const pending = beginPhoneUnlockSetup(vault.record, owner, () => {})
    // A direct observation before yielding catches even one extra microtask
    // before create(), which breaks older Safari gesture propagation.
    expect(create).toHaveBeenCalledTimes(1)
    expect(available).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    const result = await pending
    expect(result.wrappedKey).toBe('')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
  })
  it('starts finish and unlock assertions in the tap call stack before any asynchronous fingerprint check', async () => {
    const pending = await beginPhoneUnlockSetup(vault.record, owner, () => {})
    const finishing = finishPhoneUnlockSetup(vault.record, owner, password, pending, () => {})
    expect(get).toHaveBeenCalledTimes(1)
    const complete = await finishing
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
    savePhoneUnlock(complete)
    const unlocking = unlockWithPhone(vault.record, owner)
    expect(get).toHaveBeenCalledTimes(2)
    expect((await unlocking).extractable).toBe(false)
  })
  it('does not save an unfinished, cancelled or vault-mismatched setup or replace an existing shortcut', async () => {
    const pending = await beginPhoneUnlockSetup(vault.record, owner, () => {})
    expect(() => savePhoneUnlock(pending)).toThrow(/Invalid phone unlock/)
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
    const controller = new AbortController(); controller.abort()
    await expect(finishPhoneUnlockSetup(vault.record, owner, password, pending, () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(get).not.toHaveBeenCalled()
    await expect(finishPhoneUnlockSetup({ ...vault.record, verifier: 'changed' }, owner, password, pending, () => {})).rejects.toThrow(/vault changed/)
    await expect(finishPhoneUnlockSetup(vault.record, owner, password, { ...pending, owner: 'account-b' }, () => {})).rejects.toThrow(/Invalid phone unlock/)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(loadPhoneUnlock(owner)).toEqual(fixture)
  })
})
