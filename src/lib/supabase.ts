import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
// VITE_SUPABASE_ANON_KEY is supported only for older Supabase projects.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !publishableKey) {
  console.warn('Supabase is not configured. Copy .env.example to .env and add your project keys.')
}

export const supabase = createClient(url || 'https://example.supabase.co', publishableKey || 'example-publishable-key')
