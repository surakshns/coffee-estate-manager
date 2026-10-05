import { adminClient, json, pushConfiguration, sendPush, validCronSecret } from '../_shared/reminderRuntime.ts'
import { canSendReminder, deliveryResult, isPushEndpoint, notificationPayload, rescheduledNotificationPayload, type DeliveryLedger } from '../_shared/reminderRules.ts'

type ClaimedDelivery = { delivery_id: string; owner_id: string; week_start: string; subscription_id: string; endpoint: string; p256dh: string; auth: string }

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  if (!await validCronSecret(request)) return json({ error: 'Unauthorized scheduler.' }, 401)
  const config = await pushConfiguration()
  if (!config?.ready) return json({ error: 'Scheduled reminder delivery is not configured.' }, 503)
  const admin = adminClient()
  const { data, error } = await admin.rpc('claim_due_advance_reminders', { p_limit: 30 })
  if (error) return json({ error: 'Could not claim reminder deliveries.' }, 500)
  const counts = { claimed: (data ?? []).length, sent: 0, retry: 0, uncertain: 0, cancelled: 0, expired: 0 }
  for (const delivery of (data ?? []) as ClaimedDelivery[]) {
    let result: 'sent' | 'retry' | 'uncertain' | 'cancelled' | 'expired' = 'uncertain'
    let httpStatus: number | undefined
    try {
      // Recheck immediately before every phone, not just at enqueue time. A save,
      // disable, schedule edit or account switch cancels remaining deliveries.
      const [settings, run, subscription, workers, payments] = await Promise.all([
        admin.from('advance_reminder_settings').select('enabled,updated_at,revision,weekday,reminder_time').eq('user_id', delivery.owner_id).maybeSingle(),
        admin.from('weekly_pay_runs').select('week_start').eq('user_id', delivery.owner_id).eq('week_start', delivery.week_start).maybeSingle(),
        admin.from('advance_push_subscriptions').select('id,user_id,endpoint,p256dh,auth,expiration_time,connected_at').eq('id', delivery.subscription_id).eq('user_id', delivery.owner_id).maybeSingle(),
        admin.from('workers').select('id,active').eq('user_id', delivery.owner_id),
        admin.from('weekly_payments').select('worker_id').eq('user_id', delivery.owner_id).eq('week_start', delivery.week_start)
      ])
      const { data: ledger, error: ledgerError } = await admin.from('advance_reminder_deliveries').select('scheduled_at,status,kind,settings_revision').eq('id', delivery.delivery_id).maybeSingle()
      if (ledgerError || [settings, run, subscription, workers, payments].some(value => value.error)) throw new Error('Eligibility could not be rechecked.')
      const paid = new Set((payments.data ?? []).map(row => row.worker_id))
      const eligible = (workers.data ?? []).some(worker => worker.active || paid.has(worker.id))
      if (!canSendReminder(settings.data, ledger as DeliveryLedger | null, subscription.data, !!run.data, eligible) || !subscription.data || !settings.data || subscription.data.endpoint !== delivery.endpoint || !isPushEndpoint(delivery.endpoint)) {
        result = 'cancelled'
      } else {
        const payload = ledger?.kind === 'rescheduled'
          ? rescheduledNotificationPayload(config.appUrl, delivery.week_start, { enabled: settings.data.enabled, weekday: settings.data.weekday, time: settings.data.reminder_time.slice(0, 5), timezone: 'Asia/Kolkata' })
          : notificationPayload(config.appUrl, delivery.week_start)
        const push = await sendPush(config, { endpoint: subscription.data.endpoint, keys: { p256dh: subscription.data.p256dh, auth: subscription.data.auth }, expirationTime: null }, payload, payload.tag)
        httpStatus = push.status
        result = deliveryResult(httpStatus)
        if (httpStatus === 404 || httpStatus === 410) await admin.from('advance_push_subscriptions').delete().eq('id', delivery.subscription_id).eq('user_id', delivery.owner_id)
      }
    } catch {
      // No retry for an unknown outcome: it might already have been accepted.
      result = 'uncertain'
    }
    const { error: finishError } = await admin.rpc('finish_advance_reminder', { p_id: delivery.delivery_id, p_status: result, p_http_status: httpStatus ?? null })
    if (finishError) return json({ error: 'Could not record reminder delivery results.' }, 500)
    counts[result]++
  }
  return json(counts)
})
