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
      icon: '/favicon.svg',
      badge: '/favicon.svg',
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
