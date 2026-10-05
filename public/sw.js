const APP_ROOT = new URL(self.registration.scope)
const CACHE_PREFIX = `coffee-estate-manager:${APP_ROOT.pathname}:`
const CACHE_NAME = `${CACHE_PREFIX}v2`
const APP_SHELL = [APP_ROOT.href, new URL('index.html', APP_ROOT).href]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) || name === 'coffee-estate-manager-v1').map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return
  const path = url.pathname.slice(APP_ROOT.pathname.length)
  const shell = path === '' || path === 'index.html'
  const asset = /^(assets\/[^/]+\.(js|css|woff2?)|icons\/[^/]+\.(png|svg)|market-data\/[^/]+\.csv|manifest\.webmanifest)$/.test(path)
  // Only public app files enter the cache. Auth/reset query strings, private
  // endpoints and external data sources are never persisted here.
  if (!shell && !asset) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME).catch(() => null)
    try {
      const response = await fetch(event.request)
      const cacheControl = response.headers.get('Cache-Control') || ''
      if (cache && response.ok && response.type !== 'opaque' && !url.search && event.request.cache !== 'no-store' && !/no-store|private/i.test(cacheControl) && !event.request.headers.has('Authorization')) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}))
      }
      return response
    } catch {
      // A reset URL can fall back to the generic shell without caching its URL.
      return (cache && !url.search && await cache.match(event.request).catch(() => null)) || (cache && shell && event.request.mode === 'navigate' ? await cache.match(APP_SHELL[1]).catch(() => null) : null) || Response.error()
    }
  })())
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
