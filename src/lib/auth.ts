export function passwordResetRedirect() {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  url.searchParams.set('auth', 'recovery')
  return url.href
}

export function isPasswordRecovery() {
  const url = new URL(window.location.href)
  return url.searchParams.get('auth') === 'recovery' || new URLSearchParams(url.hash.slice(1)).get('type') === 'recovery'
}

export function passwordRecoveryError() {
  if (!isPasswordRecovery()) return ''
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  return ['error', 'error_code', 'error_description'].some(key => url.searchParams.has(key) || fragment.has(key))
    ? 'This reset link is invalid or has expired. Request a new link below.'
    : ''
}

export function setPasswordRecoveryUrl(recovery: boolean) {
  const url = new URL(window.location.href)
  if (recovery) url.searchParams.set('auth', 'recovery')
  else {
    url.searchParams.delete('auth')
    url.hash = ''
  }
  window.history.replaceState(window.history.state, '', url)
}

export function authErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not connect. Please try again.'
}
