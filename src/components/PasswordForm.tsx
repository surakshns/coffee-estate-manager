import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { authErrorMessage } from '../lib/auth'
import { Notice } from './Workspace'

export function PasswordForm({ email, verifyCurrent = false, onSuccess, onCancel, onBusyChange }: {
  email?: string
  verifyCurrent?: boolean
  onSuccess: () => void
  onCancel: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [nonceRequired, setNonceRequired] = useState(false)
  const [nonce, setNonce] = useState('')
  const busyRef = useRef(false)

  function notify(text: string, error = false) { setMessage(text); setMessageError(error) }
  function setWorking(value: boolean) { busyRef.current = value; setBusy(value); onBusyChange?.(value) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    if (password.length < 6) { notify('Use at least 6 characters for your new password.', true); return }
    if (password !== confirmation) { notify('New passwords do not match.', true); return }
    if (verifyCurrent && password === currentPassword) { notify('Choose a password different from your current password.', true); return }
    setWorking(true); setMessage('')
    try {
      if (verifyCurrent) {
        if (!email) { notify('Please sign in again before changing your password.', true); return }
        const { error } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
        if (error) { notify(error.message, true); return }
      }
      const { error } = await supabase.auth.updateUser({ password, ...(verifyCurrent ? { current_password: currentPassword } : {}), ...(nonce ? { nonce: nonce.trim() } : {}) })
      if (error) {
        if (error.code === 'reauthentication_needed' || error.code === 'reauthentication_not_valid') {
          setNonceRequired(true)
          notify('Email verification is needed. Send a code, then enter it below to update your password.', true)
        } else notify(error.message, true)
        return
      }
      setCurrentPassword(''); setPassword(''); setConfirmation(''); setNonce('')
      onSuccess()
    } catch (error) { notify(authErrorMessage(error), true) }
    finally { setWorking(false) }
  }

  async function sendCode() {
    if (busyRef.current) return
    setWorking(true); setMessage('')
    try {
      const { error } = await supabase.auth.reauthenticate()
      notify(error ? error.message : 'A verification code has been sent to your account email.', !!error)
    } catch (error) { notify(authErrorMessage(error), true) }
    finally { setWorking(false) }
  }

  return <form className="password-form" onSubmit={event => void submit(event)}>
    {email && <p className="password-account">Account <strong>{email}</strong></p>}
    {verifyCurrent && <label className="label">Current password<input className="field" type={showPasswords ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} /></label>}
    <label className="label">New password<input className="field" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} aria-describedby="password-guidance" /></label>
    <p id="password-guidance" className="password-guidance">Use at least 6 characters.</p>
    <label className="label">Confirm new password<input className="field" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} /></label>
    <label className="password-visibility"><input type="checkbox" checked={showPasswords} onChange={event => setShowPasswords(event.target.checked)} disabled={busy} />Show passwords</label>
    {nonceRequired && <div className="password-verification"><button type="button" className="button-secondary" disabled={busy} onClick={() => void sendCode()}>Send verification code</button><label className="label">Email verification code<input className="field" autoComplete="one-time-code" inputMode="numeric" value={nonce} onChange={event => setNonce(event.target.value)} required disabled={busy} /></label></div>}
    <Notice error={messageError}>{message}</Notice>
    <div className="password-actions"><button className="button-primary" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button><button className="button-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>
}
