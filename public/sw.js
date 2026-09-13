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
