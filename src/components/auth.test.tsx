// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { EstateData } from '../lib/types'
import { passwordResetRedirect } from '../lib/auth'
import { AuthScreen } from './AuthScreen'
import { PasswordForm } from './PasswordForm'
import { PasswordRecovery } from './PasswordRecovery'
import App from '../App'

const api = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn(), updateUser: vi.fn(),
  reauthenticate: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(), refresh: vi.fn(),
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: {
  signInWithPassword: api.signIn, signUp: api.signUp, resetPasswordForEmail: api.resetPassword,
  updateUser: api.updateUser, reauthenticate: api.reauthenticate, signOut: api.signOut,
  getSession: api.getSession, onAuthStateChange: api.onAuthStateChange
} } }))
vi.mock('../hooks/useEstateData', () => ({ useEstateData: () => ({
  data: { workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], categories: [], expenses: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: [] } satisfies EstateData,
  loading: false, error: '', refresh: api.refresh
}) }))
vi.mock('./Dashboard', () => ({ Dashboard: () => <h1>Estate dashboard</h1> }))
vi.mock('./EstateGuide', () => ({ EstateGuide: () => null }))

const session: Session = {
  access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer',
  user: { id: 'account-1', email: 'owner@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listener = null
  window.history.replaceState({}, '', '/')
  api.signIn.mockResolvedValue({ data: { session, user: session.user }, error: null })
  api.signUp.mockResolvedValue({ error: null })
  api.resetPassword.mockResolvedValue({ error: null })
  api.updateUser.mockResolvedValue({ data: { user: session.user }, error: null })
  api.reauthenticate.mockResolvedValue({ error: null })
  api.signOut.mockResolvedValue({ error: null })
  api.getSession.mockResolvedValue({ data: { session: null }, error: null })
  api.onAuthStateChange.mockImplementation(callback => {
    api.listener = callback
    return { data: { subscription: { unsubscribe: api.unsubscribe } } }
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState({}, '', '/') })

async function enterNewPassword(user: ReturnType<typeof userEvent.setup>, value = 'new-password-42', confirmation = value) {
  await user.type(screen.getByLabelText('New password'), value)
  await user.type(screen.getByLabelText('Confirm new password'), confirmation)
}

describe('forgot password', () => {
  it('keeps the entered email and sends a reset link without requiring a password', async () => {
    const user = userEvent.setup()
    render(<AuthScreen />)
    await user.type(screen.getByLabelText('Email'), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.queryByLabelText('Password')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(api.resetPassword).toHaveBeenCalledWith('owner@example.com', { redirectTo: `${window.location.origin}/?auth=recovery` })
    expect(screen.getByRole('status').textContent).toContain('If an account exists')
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('owner@example.com')
  })

  it('retains the email and permits another attempt after a network error', async () => {
    api.resetPassword.mockRejectedValueOnce(new Error('Connection unavailable'))
    const user = userEvent.setup()
    render(<AuthScreen initialMode="forgot-password" />)
    await user.type(screen.getByLabelText('Email'), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(screen.getByRole('alert').textContent).toBe('Connection unavailable')
    expect((screen.getByRole('button', { name: 'Send reset link' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(api.resetPassword).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('If an account exists')
  })

  it('keeps GitHub Pages base paths and excludes existing URL tokens from the redirect', () => {
    vi.stubEnv('BASE_URL', '/coffee-estate-manager/')
    window.history.replaceState({}, '', '/coffee-estate-manager/?other=value#access_token=test')
    expect(passwordResetRedirect()).toBe(`${window.location.origin}/coffee-estate-manager/?auth=recovery`)
  })
})

describe('password updates', () => {
  it('verifies the current password before updating the account password', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<PasswordForm email="owner@example.com" verifyCurrent onSuccess={onSuccess} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await enterNewPassword(user)
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(api.signIn).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'old-password' })
    expect(api.updateUser).toHaveBeenCalledWith({ password: 'new-password-42', current_password: 'old-password' })
    expect(api.signIn.mock.invocationCallOrder[0]).toBeLessThan(api.updateUser.mock.invocationCallOrder[0])
    expect(onSuccess).toHaveBeenCalledOnce()
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('')
  })

  it('blocks an incorrect current password and mismatched new passwords', async () => {
    api.signIn.mockResolvedValueOnce({ error: { message: 'Current password is incorrect' } })
    const user = userEvent.setup()
    render(<PasswordForm email="owner@example.com" verifyCurrent onSuccess={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Current password'), 'wrong-password')
    await enterNewPassword(user, 'new-password-42', 'different-password')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('alert').textContent).toBe('New passwords do not match.')
    expect(api.signIn).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-42')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('alert').textContent).toBe('Current password is incorrect')
    expect(api.updateUser).not.toHaveBeenCalled()
  })

  it('retains the new password after a server rejection and supports email verification', async () => {
    api.updateUser.mockResolvedValueOnce({ error: { code: 'reauthentication_needed', message: 'Verification required' } })
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<PasswordForm onSuccess={onSuccess} onCancel={vi.fn()} />)
    await enterNewPassword(user)
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('alert').textContent).toContain('Email verification is needed')
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('new-password-42')
    await user.click(screen.getByRole('button', { name: 'Send verification code' }))
    expect(api.reauthenticate).toHaveBeenCalledOnce()
    await user.type(screen.getByLabelText('Email verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(api.updateUser).toHaveBeenLastCalledWith({ password: 'new-password-42', nonce: '123456' })
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('does not submit duplicate changes while a request is in progress', async () => {
    let resolve!: (value: { error: null }) => void
    api.updateUser.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<PasswordForm onSuccess={onSuccess} onCancel={vi.fn()} />)
    await enterNewPassword(user)
    await user.dblClick(screen.getByRole('button', { name: 'Update password' }))
    expect(api.updateUser).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { resolve({ error: null }) })
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('updates from a recovery session without asking for the forgotten password', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<PasswordRecovery email="owner@example.com" onComplete={onComplete} />)
    expect(screen.queryByLabelText('Current password')).toBeNull()
    await enterNewPassword(user)
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(api.updateUser).toHaveBeenCalledWith({ password: 'new-password-42' })
    expect(api.signIn).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Password updated' })).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue to your estate' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })
})

describe('account navigation and recovery callbacks', () => {
  it('opens password settings from both the header and phone Menu', async () => {
    api.getSession.mockResolvedValue({ data: { session }, error: null })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Estate dashboard' })
    await user.click(screen.getByLabelText('More options'))
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(within(screen.getByRole('dialog', { name: 'Change password' })).getByLabelText('Current password')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change password' }))
    expect(screen.getByRole('dialog', { name: 'Change password' })).toBeTruthy()
  })

  it('shows the reset form on PASSWORD_RECOVERY and exits recovery after saving', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })
    await act(async () => { api.listener?.('PASSWORD_RECOVERY', session) })
    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeTruthy()
    expect(window.location.search).toBe('?auth=recovery')
    await enterNewPassword(user)
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.click(screen.getByRole('button', { name: 'Continue to your estate' }))
    expect(screen.getByRole('heading', { name: 'Estate dashboard' })).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('keeps the reset form after reloading a recovery link with an established session', async () => {
    window.history.replaceState({}, '', '/?auth=recovery')
    api.getSession.mockResolvedValue({ data: { session }, error: null })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Estate dashboard' })).toBeNull()
  })

  it('offers a fresh link for an expired reset even if an older login session exists', async () => {
    window.history.replaceState({}, '', '/?auth=recovery#error=access_denied&error_code=otp_expired')
    api.getSession.mockResolvedValue({ data: { session }, error: null })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Send reset link' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('invalid or has expired')
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(api.updateUser).not.toHaveBeenCalled()
  })

  it('cancels recovery by ending only the local recovery session', async () => {
    window.history.replaceState({}, '', '/?auth=recovery')
    api.getSession.mockResolvedValue({ data: { session }, error: null })
    api.signOut.mockImplementation(async () => {
      api.listener?.('SIGNED_OUT', null)
      return { error: null }
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Set a new password' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy())
    expect(api.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(window.location.search).toBe('')
  })
})
