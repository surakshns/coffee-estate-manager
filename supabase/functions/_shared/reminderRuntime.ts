import { createClient } from 'supabase'
import { ApplicationServer, exportApplicationServerKey, importVapidKeys, PushMessageError, Urgency } from 'webpush'
import type { StoredSubscription } from './reminderRules.ts'

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Reminder server configuration is missing.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type PushConfiguration = { server: ApplicationServer; publicKey: string; appUrl: string; ready: boolean }
let configuration: Promise<PushConfiguration | null> | null = null

export function pushConfiguration() {
  configuration ??= (async () => {
    const exportedKeys = Deno.env.get('REMINDER_VAPID_KEYS')
    const contact = Deno.env.get('REMINDER_VAPID_CONTACT')
    const appUrl = Deno.env.get('REMINDER_APP_URL')
    const cronSecret = Deno.env.get('REMINDER_CRON_SECRET')
    if (!exportedKeys || !contact || !appUrl || !cronSecret || cronSecret.length < 32) return null
    try {
      const url = new URL(appUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
      if (!contact.startsWith('mailto:') && !contact.startsWith('https:')) return null
      const vapidKeys = await importVapidKeys(JSON.parse(exportedKeys))
      const server = await ApplicationServer.new({ vapidKeys, contactInformation: contact })
      return { server, publicKey: await exportApplicationServerKey(vapidKeys), appUrl: url.href, ready: Deno.env.get('REMINDER_DELIVERY_ENABLED') === 'true' }
    } catch { return null }
  })()
  return configuration
}

export async function sendPush(config: PushConfiguration, subscription: StoredSubscription, payload: unknown, topic: string) {
  try {
    await config.server.subscribe(subscription).pushTextMessage(JSON.stringify(payload), { ttl: 300, urgency: Urgency.Normal, topic })
    return { status: 201 }
  } catch (error) {
    // Only an explicit push-service response proves a failed, retryable send.
    // An ambiguous network failure is not retried automatically.
    return { status: error instanceof PushMessageError ? error.response.status : undefined }
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

export async function readBody(request: Request) {
  const text = await request.text()
  if (text.length > 8192) throw new Error('Reminder request is too large.')
  const value = JSON.parse(text || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reminder request.')
  return value as Record<string, unknown>
}

export async function validCronSecret(request: Request) {
  const expected = Deno.env.get('REMINDER_CRON_SECRET')
  const supplied = request.headers.get('x-reminder-secret')
  if (!expected || expected.length < 32 || !supplied) return false
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [a, b] = await Promise.all([digest(expected), digest(supplied)])
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}
