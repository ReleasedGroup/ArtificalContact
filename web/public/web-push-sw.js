self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open('artificialcontact-shell-v1')
      .then((cache) =>
        cache.addAll([
          '/',
          '/manifest.json',
          '/favicon.svg',
          '/icons/icon-192.png',
          '/icons/icon-512.png',
          '/icons/icon-maskable-512.png',
        ]),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== 'artificialcontact-shell-v1')
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }

  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.json'

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedResponse = await caches.match('/')
        return cachedResponse ?? Response.error()
      }),
    )
    return
  }

  if (!isStaticAsset) {
    return
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      const networkResponse = await fetch(request)
      const cache = await caches.open('artificialcontact-shell-v1')
      cache.put(request, networkResponse.clone())
      return networkResponse
    }),
  )
})

self.addEventListener('push', (event) => {
  const fallbackPayload = {
    title: 'ArtificialContact',
    body: 'You have a new notification.',
    url: '/notifications',
  }

  let payload = fallbackPayload

  if (event.data) {
    try {
      payload = {
        ...fallbackPayload,
        ...event.data.json(),
      }
    } catch {
      payload = {
        ...fallbackPayload,
        body: event.data.text(),
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: {
        url:
          typeof payload.url === 'string' && payload.url.startsWith('/')
            ? payload.url
            : '/notifications',
      },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl =
    typeof event.notification.data?.url === 'string' &&
    event.notification.data.url.startsWith('/')
      ? event.notification.data.url
      : '/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      (clientList) => {
        for (const client of clientList) {
          if (client.url.endsWith(targetUrl) && 'focus' in client) {
            return client.focus()
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }

        return undefined
      },
    ),
  )
})
