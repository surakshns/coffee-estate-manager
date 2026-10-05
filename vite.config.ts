/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { contentSecurityPolicy } from './build/contentSecurity.ts'
import { assertPublicSupabaseKey } from './src/lib/publicKey.ts'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_')
  if (command === 'build') assertPublicSupabaseKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY || environment.VITE_SUPABASE_ANON_KEY || '')
  return {
  plugins: [react(), tailwindcss(), {
    name: 'production-content-security',
    transformIndexHtml: {
      order: 'post',
      handler: () => command === 'build' ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(environment.VITE_SUPABASE_URL) }, injectTo: 'head-prepend' }] : []
    }
  }],
  // GitHub Pages serves a project under /repository-name/. Local development stays at /.
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
  test: { environment: 'node' }
  }
})
