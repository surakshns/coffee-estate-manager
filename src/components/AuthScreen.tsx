import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { authErrorMessage, passwordResetRedirect } from '../lib/auth'
import { AuthLayout } from './AuthLayout'
import { Notice } from './Workspace'

type Mode = 'sign-in' | 'sign-up' | 'forgot-password'

export function AuthScreen({ initialMode = 'sign-in', initialMessage = '', onReturnToSignIn }: { initialMode?: Mode; initialMessage?: string; onReturnToSignIn?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>(initialMode)
  const [message, setMessage] = useState(initialMessage)
  const [messageError, setMessageError] = useState(!!initialMessage)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  function switchMode(next: Mode) {
    setMode(next); setPassword(''); setMessage(''); setMessageError(false)
    if (next === 'sign-in') onReturnToSignIn?.()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setMessage(''); setMessageError(false)
    try {
      const address = email.trim()
      const { error } = mode === 'forgot-password'
        ? await supabase.auth.resetPasswordForEmail(address, { redirectTo: passwordResetRedirect() })
        : mode === 'sign-in'
          ? await supabase.auth.signInWithPassword({ email: address, password })
          : await supabase.auth.signUp({ email: address, password })
      if (error) { setMessage(error.message); setMessageError(true); return }
      setMessage(mode === 'forgot-password'
        ? 'If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.'
        : mode === 'sign-up' ? 'Account created. Check your email if confirmation is enabled.' : '')
    } catch (error) { setMessage(authErrorMessage(error)); setMessageError(true) }
    finally { busyRef.current = false; setBusy(false) }
  }

  return <AuthLayout title={mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create your account' : 'Forgot your password?'} detail={mode === 'forgot-password' ? 'Enter your account email and we’ll send you a link to reset your password.' : 'Keep your estate’s costs, labour, prices and sales together.'}>
    <form className="mt-6 space-y-4" onSubmit={event => void submit(event)}>
      <label className="label">Email<input className="field" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>
      {mode !== 'forgot-password' && <label className="label">Password<input className="field" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>}
      {mode === 'sign-in' && <button type="button" className="auth-link" disabled={busy} onClick={() => switchMode('forgot-password')}>Forgot password?</button>}
      <Notice error={messageError}>{message}</Notice>
      <button className="button-primary w-full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'forgot-password' ? 'Send reset link' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button type="button" className="auth-link mt-4 w-full text-center" disabled={busy} onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>{mode === 'forgot-password' ? 'Back to sign in' : mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
  </AuthLayout>
}
