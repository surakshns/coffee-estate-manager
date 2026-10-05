// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDocumentVault, VAULT_IDLE_MS } from './useDocumentVault'

const api = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), getUser: vi.fn(), create: vi.fn(), unlock: vi.fn(), unsubscribe: vi.fn(), authCallback: null as ((event: string, session: any) => void) | null }))
vi.mock('../lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: api.read }) }), insert: api.insert }),
  auth: { getUser: api.getUser, onAuthStateChange: (callback: typeof api.authCallback) => { api.authCallback = callback; return { data: { subscription: { unsubscribe: api.unsubscribe } } } } }
} }))
vi.mock('../lib/documentVault', () => ({ createDocumentVault: api.create, unlockDocumentVault: api.unlock }))
const record = { user_id: 'account-a', version: 1, iterations: 600000, salt: 'salt', verifier: 'ciphertext' }
const key = { type: 'secret', extractable: false } as CryptoKey
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  api.read.mockResolvedValue({ data: record, error: null })
  api.insert.mockResolvedValue({ error: null })
  api.getUser.mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null })
  api.create.mockResolvedValue({ key, record })
  api.unlock.mockResolvedValue(key)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
async function open() {
  const hook = renderHook(() => useDocumentVault('account-a'))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await act(() => hook.result.current.submit('my unique vault password'))
  expect(hook.result.current.key).toBe(key)
  return hook
}
it('verifies account identity before unlocking, and never persists the password or key', async () => {
  const { result } = await open()
  expect(api.unlock).toHaveBeenCalledWith(record, 'account-a', 'my unique vault password')
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
  expect(api.insert).not.toHaveBeenCalled()
  act(() => result.current.lock())
  expect(result.current.key).toBeNull()
  expect(() => result.current.assertUnlocked()).toThrow(/locked/)
})
it('rejects another authenticated account before attempting password derivation', async () => {
  api.getUser.mockResolvedValue({ data: { user: { id: 'account-b' } }, error: null })
  const { result } = renderHook(() => useDocumentVault('account-a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(() => result.current.submit('vault password'))
  expect(api.unlock).not.toHaveBeenCalled()
  expect(result.current.key).toBeNull()
  expect(result.current.error).toContain('own account')
})
it('locks on hiding the app and suppresses an unlock that finishes after hiding', async () => {
  const { result } = await open()
  act(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(result.current.key).toBeNull()
  let finish!: (key: CryptoKey) => void
  api.unlock.mockReturnValue(new Promise(resolve => { finish = resolve }))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  let pending!: Promise<void>
  await act(async () => { pending = result.current.submit('vault password'); await Promise.resolve() })
  act(() => result.current.lock())
  await act(async () => { finish(key); await pending })
  expect(result.current.key).toBeNull()
})
it('locks after five idle minutes and does not let late activity revive an expired key', async () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useDocumentVault('account-a'))
  await act(async () => { await Promise.resolve() })
  await act(() => result.current.submit('vault password'))
  act(() => vi.advanceTimersByTime(VAULT_IDLE_MS))
  expect(result.current.key).toBeNull()
  vi.useRealTimers()
  await act(() => result.current.submit('vault password'))
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + VAULT_IDLE_MS + 1)
  act(() => window.dispatchEvent(new Event('pointerdown')))
  expect(result.current.key).toBeNull()
})
it('extends the idle window only while active and locks on sign-out or another account', async () => {
  const { result } = await open()
  vi.useFakeTimers()
  act(() => { vi.advanceTimersByTime(VAULT_IDLE_MS - 1000); window.dispatchEvent(new Event('keydown')); vi.advanceTimersByTime(2000) })
  expect(result.current.key).toBe(key)
  act(() => api.authCallback?.('SIGNED_IN', { user: { id: 'account-b' } }))
  expect(result.current.key).toBeNull()
  vi.useRealTimers()
  await act(() => result.current.submit('vault password'))
  act(() => api.authCallback?.('SIGNED_OUT', null))
  expect(result.current.key).toBeNull()
})
it('persists only salt and ciphertext during setup and fails closed if setup cannot be stored', async () => {
  api.read.mockResolvedValue({ data: null, error: null })
  api.insert.mockResolvedValueOnce({ error: new Error('Setup denied') })
  const { result } = renderHook(() => useDocumentVault('account-a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(() => result.current.submit('my unique vault password'))
  expect(api.insert).toHaveBeenCalledWith(record)
  expect(result.current.key).toBeNull()
  expect(result.current.error).toContain('denied')
  await act(() => result.current.submit('my unique vault password'))
  expect(result.current.key).toBe(key)
})
it('drops keys and subscriptions on unmount and account changes', async () => {
  const { result, rerender, unmount } = renderHook(({ owner }) => useDocumentVault(owner), { initialProps: { owner: 'account-a' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(() => result.current.submit('my unique vault password'))
  const oldAssert = result.current.assertUnlocked
  rerender({ owner: 'account-b' })
  expect(result.current.key).toBeNull()
  expect(oldAssert).toThrow(/locked/)
  unmount()
  expect(api.unsubscribe).toHaveBeenCalledTimes(2)
  expect(oldAssert).toThrow(/locked/)
})
