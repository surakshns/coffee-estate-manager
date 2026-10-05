import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createDocumentVault, unlockDocumentVault, type VaultRecord } from '../lib/documentVault'
import { errorMessage } from '../lib/errors'

export const VAULT_IDLE_MS = 5 * 60 * 1000
export function useDocumentVault(owner: string) {
  const [record, setRecord] = useState<VaultRecord | null>(null)
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const generation = useRef(0)
  const currentKey = useRef<CryptoKey | null>(null)
  const expires = useRef(0)
  const submitting = useRef(false)
  const account = useRef(owner)
  const keyOwner = useRef<string | null>(null)
  account.current = owner
  const lock = useCallback(() => {
    generation.current++; currentKey.current = null; keyOwner.current = null; setKey(null); setBusy(false)
  }, [])
  const assertUnlocked = useCallback(() => {
    if (!active.current || keyOwner.current !== account.current || !currentKey.current || document.visibilityState === 'hidden' || Date.now() >= expires.current) throw new Error('The document vault is locked. Unlock it again to continue.')
  }, [])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data, error } = await supabase.from('document_vaults').select('user_id,salt,verifier,iterations,version').eq('user_id', owner).maybeSingle()
      if (error) throw error
      if (active.current && account.current === owner) setRecord(data as VaultRecord | null)
    } catch (cause) { if (active.current && account.current === owner) setError(errorMessage(cause, 'Could not load the document vault.')) }
    finally { if (active.current && account.current === owner) setLoading(false) }
  }, [owner])
  useEffect(() => {
    active.current = true
    lock(); setRecord(null); setLoading(true)
    void load()
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' || session?.user.id !== owner) lock()
    })
    return () => { active.current = false; generation.current++; currentKey.current = null; listener.subscription.unsubscribe() }
  }, [owner, load, lock])
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') lock() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', lock)
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', lock) }
  }, [lock])
  useEffect(() => {
    if (!key) return
    const touch = () => {
      // Events after a suspended timer must not extend an already expired key.
      if (Date.now() >= expires.current) lock()
      else expires.current = Date.now() + VAULT_IDLE_MS
    }
    const check = () => { if (Date.now() >= expires.current) lock() }
    const interval = window.setInterval(check, 1000)
    for (const event of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(event, touch, { capture: true, passive: true })
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(interval)
      for (const event of ['pointerdown', 'keydown', 'scroll']) window.removeEventListener(event, touch, true)
      window.removeEventListener('focus', check)
    }
  }, [key, lock])
  async function submit(password: string) {
    if (submitting.current || loading) return
    submitting.current = true; setBusy(true); setError('')
    const sequence = ++generation.current
    try {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      if (data.user?.id !== owner) throw new Error('Sign in to your own account before opening the vault.')
      let nextKey: CryptoKey
      if (record) nextKey = await unlockDocumentVault(record, owner, password)
      else {
        const result = await createDocumentVault(owner, password)
        if (!active.current || generation.current !== sequence) return
        const inserted = await supabase.from('document_vaults').insert(result.record)
        if (inserted.error) throw inserted.error
        if (active.current) setRecord(result.record)
        nextKey = result.key
      }
      if (!active.current || generation.current !== sequence || document.visibilityState === 'hidden') return
      expires.current = Date.now() + VAULT_IDLE_MS
      keyOwner.current = owner; currentKey.current = nextKey; setKey(nextKey)
    } catch (cause) { if (active.current && generation.current === sequence) setError(errorMessage(cause, 'Could not open the document vault.')) }
    finally { submitting.current = false; if (active.current && generation.current === sequence) setBusy(false) }
  }
  return { owner, record, key: keyOwner.current === owner ? key : null, loading, busy, error, submit, lock, load, assertUnlocked }
}
