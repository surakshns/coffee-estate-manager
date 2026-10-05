import { expect, it } from 'vitest'
import { contentSecurityPolicy } from '../../build/contentSecurity'

it('restricts scripts, document rendering and network connections in production', () => {
  const policy = contentSecurityPolicy('https://estate-project.supabase.co')
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
  expect(policy).not.toContain("'unsafe-eval'")
  expect(policy).toContain('https://estate-project.supabase.co wss://estate-project.supabase.co')
  expect(policy).not.toContain('*.supabase.co')
  expect(policy).toContain("object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
  expect(() => contentSecurityPolicy('http://estate-project.supabase.co')).toThrow(/HTTPS/)
})
