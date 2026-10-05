export function contentSecurityPolicy(supabaseUrl: string) {
  const endpoint = new URL(supabaseUrl || 'https://example.supabase.co')
  if (endpoint.protocol !== 'https:') throw new Error('Production Supabase connections must use HTTPS.')
  const realtime = new URL(endpoint.origin); realtime.protocol = 'wss:'
  return [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", "font-src 'self' data:", "worker-src 'self' blob:",
    `connect-src 'self' blob: ${endpoint.origin} ${realtime.origin} https://geocoding-api.open-meteo.com https://archive-api.open-meteo.com https://api.open-meteo.com https://buonmathuotcoffee.com https://open.er-api.com`,
    "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"
  ].join('; ')
}
