import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { authErrorMessage } from '../lib/auth'
import { AuthLayout } from './AuthLayout'
import { PasswordForm } from './PasswordForm'
import { Notice } from './Workspace'

export function PasswordRecovery({ email, onComplete }: { email?: string; onComplete: () => void }) {
  const [saved, setSaved] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  async function cancelRecovery() {
    setLeaving(true); setError('')
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) { setError(error.message); return }
      onComplete()
    } catch (error) { setError(authErrorMessage(error)) }
    finally { setLeaving(false) }
  }

  return <AuthLayout title={saved ? 'Password updated' : 'Set a new password'} detail={saved ? 'Your new password is ready to use next time you sign in.' : 'Choose a new password to get back to your estate records.'}>
    <div className="mt-6">
      <Notice error>{error}</Notice>
      {saved ? <div className="password-recovery-success"><CheckCircle2 size={40} aria-hidden="true" /><p role="status">Your password has been updated successfully.</p><button type="button" className="button-primary w-full" onClick={onComplete}>Continue to your estate</button></div> : leaving ? <p role="status">Returning to sign in…</p> : <PasswordForm email={email} onSuccess={() => setSaved(true)} onCancel={() => void cancelRecovery()} />}
    </div>
  </AuthLayout>
}
