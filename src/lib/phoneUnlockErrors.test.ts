import { expect, it } from 'vitest'
import { phoneUnlockErrorMessage } from './phoneUnlockErrors'

it('explains which passkey step was blocked and how to retry', () => {
  const blocked = new DOMException('Not allowed', 'NotAllowedError')
  expect(phoneUnlockErrorMessage(blocked, 'create')).toContain('Click Create passkey again')
  expect(phoneUnlockErrorMessage(blocked, 'verify')).toContain('Click Verify and enable unlock again')
  expect(phoneUnlockErrorMessage(blocked, 'unlock')).toContain('vault password')
})
it('distinguishes unsupported providers, secure-context errors and interruptions', () => {
  expect(phoneUnlockErrorMessage({ name: 'NotSupportedError' }, 'create')).toContain('does not support')
  expect(phoneUnlockErrorMessage({ name: 'SecurityError' }, 'unlock')).toContain('HTTPS')
  expect(phoneUnlockErrorMessage({ name: 'AbortError' }, 'verify')).toContain('interrupted')
  expect(phoneUnlockErrorMessage(new Error('Encrypted file changed'), 'verify')).toBe('Encrypted file changed')
})
