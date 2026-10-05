export type PhoneUnlockPhase = 'create' | 'verify' | 'unlock'
export function phoneUnlockErrorMessage(cause: unknown, phase: PhoneUnlockPhase) {
  const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : ''
  if (name === 'NotAllowedError') {
    if (phase === 'create') return 'Passkey creation was cancelled or blocked by the browser. Click Create passkey again. If no prompt appears, check that passkeys and Touch ID or a device PIN are enabled on your device.'
    if (phase === 'verify') return 'Passkey verification was cancelled or blocked by the browser. Click Verify and enable unlock again and choose the passkey you just created. Your vault password is still available.'
    return 'Device verification was cancelled or blocked by the browser. Try again or unlock with your vault password.'
  }
  if (name === 'AbortError') return 'Device unlock was interrupted. Try again while keeping this app open, or use your vault password.'
  if (name === 'NotSupportedError') return 'This browser or passkey provider does not support encrypted document unlock. Use your vault password or a supported passkey provider.'
  if (name === 'SecurityError') return 'Open the app directly at its HTTPS address to use device unlock. Embedded browsers and mismatched site addresses cannot use this passkey.'
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message
  return 'Could not use device unlock. Your vault password is still available.'
}
