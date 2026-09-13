import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    const action = mode === 'sign-in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { error } = await action
    setBusy(false)
    setMessage(error ? error.message : mode === 'sign-up' ? 'Account created. Check your email if confirmation is enabled.' : '')
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e4efde,transparent_45%),#f8f5ef] px-4 py-10">
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
      <div className="rounded-2xl bg-leaf-700 p-4 text-white"><p className="text-sm font-bold tracking-widest">COFFEE ESTATE</p><h1 className="mt-1 text-3xl font-extrabold">Manager</h1></div>
      <h2 className="mt-7 text-2xl font-extrabold">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
      <p className="mt-2 text-stone-600">Keep your estate’s costs, labour, prices and sales together.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="label">Email<input className="field" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="label">Password<input className="field" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {message && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{message}</p>}
        <button className="button-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="mt-5 w-full text-center font-bold text-leaf-700 underline" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>
        {mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
      </button>
    </section>
  </main>
}
