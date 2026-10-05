const CACHE_NAME = 'coffee-estate-manager-v1'
const APP_SHELL = ['./', './index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone()
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
    }
    return response
  }).catch(async () => {
    return (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
  }))
})

function validAdvanceWeek(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 3
}

function advanceTarget(data) {
  if (!validAdvanceWeek(data?.weekStart)) return null
  const app = new URL(self.registration.scope)
  const target = new URL(app.href)
  target.searchParams.set('advanceWeek', data.weekStart)
  // Build the URL from this worker's scope; never navigate to a payload-supplied host.
  return target.href
}

self.addEventListener('push', (event) => {
  let payload
  try { payload = event.data?.json() } catch { return }
  const url = advanceTarget(payload?.data)
  if (!url) return
  const data = payload.data
  const rescheduled = data.kind === 'rescheduled'
  if (rescheduled && (!Number.isInteger(data.weekday) || data.weekday < 0 || data.weekday > 6 || typeof data.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))) return
  const [hour, minute] = rescheduled ? data.time.split(':').map(Number) : []
  const day = rescheduled ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][data.weekday] : ''
  // Use validated schedule fields and fixed text, never arbitrary push content.
  event.waitUntil(self.registration.showNotification(rescheduled ? 'Weekly reminder rescheduled' : 'Weekly advance reminder', {
    body: rescheduled ? `Reminder moved to ${day} at ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'} IST. Repeats daily until the weekly payment is saved.` : 'Your weekly payment still needs saving. Tap to finish it.',
    icon: new URL('icons/coffee-estate-192.png', self.registration.scope).href,
    badge: new URL('icons/coffee-estate-192.png', self.registration.scope).href,
    tag: rescheduled ? 'advance-schedule' : `advance-${data.weekStart}`,
    renotify: true,
    data: { weekStart: data.weekStart, url }
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const url = advanceTarget(data)
  if (!url) return
  event.waitUntil((async () => {
    const app = new URL(self.registration.scope)
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => {
      const current = new URL(client.url)
      return current.origin === app.origin && current.pathname === app.pathname
    })
    if (existing) {
      // Let the app protect an open unsaved advance rather than reload the page.
      existing.postMessage({ type: 'OPEN_ADVANCE', weekStart: data.weekStart })
      await existing.focus()
      return
    }
    await self.clients.openWindow(url)
  })())
})
