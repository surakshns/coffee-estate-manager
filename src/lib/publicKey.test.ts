import { expect, it } from 'vitest'
import { assertPublicSupabaseKey } from './publicKey'

it('rejects both secret key formats before constructing an API client', () => {
  const jwt = (role: string) => `header.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.signature`
  expect(() => assertPublicSupabaseKey('sb_secret_private')).toThrow(/private Supabase key/)
  expect(() => assertPublicSupabaseKey(jwt('service_role'))).toThrow(/private Supabase key/)
  expect(() => assertPublicSupabaseKey('sb_publishable_public')).not.toThrow()
  expect(() => assertPublicSupabaseKey(jwt('anon'))).not.toThrow()
  expect(() => assertPublicSupabaseKey('')).not.toThrow()
})
