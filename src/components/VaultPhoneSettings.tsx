import { useEffect, useState, type FormEvent } from 'react'
import { Fingerprint } from 'lucide-react'
import type { useDocumentVault } from '../hooks/useDocumentVault'
import { Notice, Sheet } from './Workspace'

export function VaultPhoneSettings({ vault }: { vault: ReturnType<typeof useDocumentVault> }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  useEffect(() => { if (vault.phoneReady) { setOpen(false); setPassword('') } }, [vault.phoneReady])
  async function enable(event: FormEvent) {
    event.preventDefault()
    const secret = password; setPassword('')
    await vault.enablePhone(secret)
  }
  function close() { setOpen(false); setPassword(''); vault.cancelPhoneSetup() }
  return <div className="vault-phone-settings">
    {vault.phoneReady ? <button className="button-secondary" disabled={vault.busy} onClick={vault.forgetPhone}>Disable phone unlock</button> : vault.phoneAvailable && <button className="button-secondary" disabled={vault.busy} onClick={() => setOpen(true)}><Fingerprint size={17} />Enable fingerprint / face unlock</button>}
    {!open && <Notice error>{vault.error}</Notice>}
    <Sheet open={open} title="Set up device unlock" busy={vault.busy} onClose={close}>
      <form className="workspace-form" onSubmit={enable}>
        <p>Use this only on your personal device. It can use Touch ID, fingerprint, face recognition or its device PIN to unlock the encrypted key.</p>
        <p className="section-detail">Some passkey providers sync your passkey between devices. Keep your vault password in your password manager as a recovery option. Clearing this browser’s data removes the saved shortcut.</p>
        <Notice error>{vault.error}</Notice>
        {vault.phoneSetup ? <><p className="section-detail"><strong>Step 2 of 2: Verify your passkey.</strong> Confirm your vault password, then click below to open a new verification prompt.</p><label className="label">Confirm your vault password<input className="field" type="password" autoComplete="off" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={vault.busy} /></label></> : <p className="section-detail"><strong>Step 1 of 2: Create a passkey.</strong> Complete your device’s passkey prompt, then return here to verify it.</p>}
        <div className="sheet-footer"><button type="button" className="button-secondary" disabled={vault.busy} onClick={close}>Cancel</button>{vault.phoneSetup ? <button className="button-primary" disabled={vault.busy}>{vault.busy ? 'Verifying device...' : 'Verify and enable unlock'}</button> : <button type="button" className="button-primary" disabled={vault.busy} onClick={() => void vault.beginPhoneSetup()}>{vault.busy ? 'Creating passkey...' : 'Create passkey'}</button>}</div>
      </form>
    </Sheet>
  </div>
}
