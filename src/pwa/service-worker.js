const CACHE_PREFIX = 'live-timetable-'
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_VERSION__`
const APP_ROOT = new URL('./', self.registration.scope).toString()
const INITIAL_ASSETS = __PRECACHE_ASSETS__
const CORE_ASSETS = [
  APP_ROOT,
  new URL('app.webmanifest', APP_ROOT).toString(),
  new URL('app-icon-192.png', APP_ROOT).toString(),
  new URL('app-icon-512.png', APP_ROOT).toString(),
  ...INITIAL_ASSETS.map((path) => new URL(path, APP_ROOT).toString()),
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (!response.ok) {
            return (await caches.match(APP_ROOT)) ?? response
          }
          const cache = await caches.open(CACHE_NAME)
          await cache.put(APP_ROOT, response.clone())
          return response
        })
        .catch(async () =>
          (await caches.match(request)) ??
          (await caches.match(APP_ROOT)) ??
          Response.error(),
        ),
    )
    return
  }

  if (!url.href.startsWith(APP_ROOT)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (!response.ok) return response
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })
    }),
  )
})
