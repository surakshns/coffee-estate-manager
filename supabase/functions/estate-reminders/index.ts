import { adminClient, corsHeaders, json, pushConfiguration, readBody, sendPush } from '../_shared/reminderRuntime.ts'
import { DEFAULT_REMINDER, isPushEndpoint, latestWednesday, notificationPayload, readSchedule, readSubscription } from '../_shared/reminderRules.ts'

const SETUP_MESSAGE = 'Phone reminder delivery needs server setup. You can still save your preferred day and time.'
type Admin = ReturnType<typeof adminClient>
const schemaMissing = (error: { code?: string } | null) => error?.code === '42P01' || error?.code === 'PGRST205'

async function statusFor(admin: Admin, userId: string, endpoint?: unknown) {
  const weekStart = latestWednesday()
  const [settings, subscriptions, run, payments, workers, config] = await Promise.all([
    admin.from('advance_reminder_settings').select('enabled,weekday,reminder_time,timezone').eq('user_id', userId).maybeSingle(),
    admin.from('advance_push_subscriptions').select('endpoint,expiration_time').eq('user_id', userId),
    admin.from('weekly_pay_runs').select('week_start').eq('user_id', userId).eq('week_start', weekStart).maybeSingle(),
    admin.from('weekly_payments').select('worker_id').eq('user_id', userId).eq('week_start', weekStart),
    admin.from('workers').select('id,active').eq('user_id', userId),
    pushConfiguration()
  ])
  const missingSchema = [settings, subscriptions, run].some(result => schemaMissing(result.error))
  if (payments.error || workers.error || (!missingSchema && [settings, subscriptions, run].some(result => result.error))) throw new Error('Could not load your reminder settings. Please try again.')
  const paidWorkers = new Set((payments.data ?? []).map(row => row.worker_id))
  const eligible = (workers.data ?? []).some(worker => worker.active || paidWorkers.has(worker.id))
  const currentSubscriptions = (subscriptions.data ?? []).filter(subscription => !subscription.expiration_time || new Date(subscription.expiration_time).getTime() > Date.now())
  const reminderSettings = settings.data ? { enabled: settings.data.enabled, weekday: settings.data.weekday, time: settings.data.reminder_time.slice(0, 5), timezone: 'Asia/Kolkata' } : DEFAULT_REMINDER
  return {
    ready: !missingSchema && !!config?.ready,
    settingsStorageReady: !missingSchema,
    settings: reminderSettings,
    vapidPublicKey: config?.publicKey ?? null,
    subscribed: typeof endpoint === 'string' && currentSubscriptions.some(subscription => subscription.endpoint === endpoint),
    subscriptionCount: currentSubscriptions.length,
    weekStart,
    weekStatus: run.data ? 'complete' : !eligible ? 'no_workers' : paidWorkers.size ? 'needs_review' : 'not_saved',
    ...((missingSchema || !config?.ready) ? { setupMessage: SETUP_MESSAGE } : {})
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST for reminder actions.' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Please sign in again.' }, 401)
    const admin = adminClient()
    // Validate with Supabase Auth; never trust a locally decoded JWT/user_id.
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7))
    if (authError || !user) return json({ error: 'Please sign in again.' }, 401)
    const input = await readBody(request)
    const action = input.action ?? 'status'
    if (action === 'status') return json(await statusFor(admin, user.id, input.endpoint))

    if (action === 'configure') {
      let settings
      try { settings = readSchedule(input) } catch (error) { return json({ error: (error as Error).message }, 400) }
      const config = await pushConfiguration()
      if (settings.enabled && !config?.ready) return json({ error: SETUP_MESSAGE }, 409)
      if (settings.enabled) {
        const { count, error } = await admin.from('advance_push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).or(`expiration_time.is.null,expiration_time.gt.${new Date().toISOString()}`)
        if (error) throw new Error('Reminder setup is not complete yet.')
        if (!count) return json({ error: 'Connect notifications on this phone before enabling reminders.' }, 400)
      }
      const { data: existing, error: settingsError } = await admin.from('advance_reminder_settings').select('enabled,weekday,reminder_time,timezone').eq('user_id', user.id).maybeSingle()
      if (schemaMissing(settingsError)) return json({ error: SETUP_MESSAGE, code: 'REMINDER_SETUP_REQUIRED' }, 409)
      if (settingsError) throw new Error('Could not save your reminder settings. Please try again.')
      // Connecting another phone or saving unchanged preferences must not reset
      // the effective timestamp and cancel a due/catch-up occurrence.
      const unchanged = existing && existing.enabled === settings.enabled && existing.weekday === settings.weekday && existing.reminder_time.slice(0, 5) === settings.time && existing.timezone === settings.timezone
      if (!unchanged) {
        const { error } = await admin.from('advance_reminder_settings').upsert({ user_id: user.id, enabled: settings.enabled, weekday: settings.weekday, reminder_time: settings.time, timezone: settings.timezone }, { onConflict: 'user_id' })
        if (schemaMissing(error)) return json({ error: SETUP_MESSAGE, code: 'REMINDER_SETUP_REQUIRED' }, 409)
        if (error) throw new Error('Could not save your reminder settings. Please try again.')
      }
      return json(await statusFor(admin, user.id, input.endpoint))
    }

    if (action === 'subscribe') {
      const config = await pushConfiguration()
      if (!config?.ready) return json({ error: SETUP_MESSAGE }, 409)
      let subscription
      try { subscription = readSubscription(input.subscription) } catch (error) { return json({ error: (error as Error).message }, 400) }
      const { count, error: countError } = await admin.from('advance_push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).neq('endpoint', subscription.endpoint)
      if (countError) throw new Error('Could not connect phone notifications. Please try again.')
      if ((count ?? 0) >= 10) return json({ error: 'Ten phones are already connected. Disconnect an unused phone first.' }, 400)
      const { data: existing, error: existingError } = await admin.from('advance_push_subscriptions').select('user_id,p256dh,auth').eq('endpoint', subscription.endpoint).maybeSingle()
      if (existingError) throw new Error('Could not connect phone notifications. Please try again.')
      if (existing && existing.user_id !== user.id && (existing.p256dh !== subscription.keys.p256dh || existing.auth !== subscription.keys.auth)) return json({ error: 'This notification endpoint belongs to a different subscription.' }, 400)
      // A browser endpoint follows its currently signed-in account. Reusing it
      // cannot leave the previous account sending notifications to this phone.
      const { error } = await admin.from('advance_push_subscriptions').upsert({ user_id: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, expiration_time: subscription.expirationTime === null ? null : new Date(subscription.expirationTime).toISOString() }, { onConflict: 'endpoint' })
      if (error) throw new Error('Could not connect phone notifications. Please try again.')
      return json(await statusFor(admin, user.id, subscription.endpoint))
    }

    if (action === 'unsubscribe') {
      if (!isPushEndpoint(input.endpoint)) return json({ error: 'Choose a valid phone notification subscription.' }, 400)
      const { error } = await admin.from('advance_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', input.endpoint)
      if (error) throw new Error('Could not disconnect this phone. Please try again.')
      return json(await statusFor(admin, user.id, input.endpoint))
    }

    if (action === 'test') {
      const config = await pushConfiguration()
      if (!config?.ready) return json({ error: SETUP_MESSAGE }, 409)
      if (!isPushEndpoint(input.endpoint)) return json({ error: 'Connect notifications on this phone first.' }, 400)
      const { data: subscription, error } = await admin.from('advance_push_subscriptions').select('id,endpoint,p256dh,auth,expiration_time').eq('user_id', user.id).eq('endpoint', input.endpoint).maybeSingle()
      if (error) throw new Error('Could not check this phone. Please try again.')
      if (!subscription || (subscription.expiration_time && new Date(subscription.expiration_time).getTime() <= Date.now())) return json({ error: 'Connect notifications on this phone first.' }, 400)
      const { data: allowed, error: claimError } = await admin.rpc('claim_advance_reminder_test', { p_user_id: user.id, p_endpoint: input.endpoint })
      if (claimError) throw new Error('Reminder setup is not complete yet.')
      if (!allowed) return json({ error: 'Wait a minute before sending another test.' }, 429)
      const result = await sendPush(config, { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth }, expirationTime: null }, notificationPayload(config.appUrl, latestWednesday(), true), 'advance-reminder-test')
      if (result.status === 404 || result.status === 410) await admin.from('advance_push_subscriptions').delete().eq('id', subscription.id).eq('user_id', user.id)
      if (result.status !== 201) return json({ error: 'The test could not reach this phone. Check notification permission and reconnect it.' }, 502)
      return json({ sent: true })
    }

    return json({ error: 'Unknown reminder action.' }, 400)
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid reminder request.' : error instanceof Error ? error.message : 'Could not update reminders. Please try again.'
    return json({ error: message }, error instanceof SyntaxError ? 400 : 500)
  }
})
