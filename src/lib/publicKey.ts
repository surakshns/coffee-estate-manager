export function assertPublicSupabaseKey(key: string) {
  key = key.trim()
  let privileged = key.startsWith('sb_secret_')
  const payload = key.split('.')[1]
  if (payload) {
    try { privileged ||= JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role' } catch { /* Invalid credentials are rejected by Supabase. */ }
  }
  if (privileged) throw new Error('A private Supabase key was supplied to the browser app. Remove it from VITE_* configuration, rotate it, and use a publishable or anon key.')
}
