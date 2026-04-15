import type { NotificationWebPushSubscription } from './notification-preferences'

const serviceWorkerPath = '/web-push-sw.js'

export interface BrowserPushSupport {
  available: boolean
  canManageSubscription: boolean
  permission: NotificationPermission | 'unsupported'
  reason: 'supported' | 'unsupported_browser' | 'missing_vapid_public_key'
}

function normalizeVapidPublicKey(value: string | undefined): string | null {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

export function getBrowserPushSupport(
  vapidPublicKey: string | undefined,
): BrowserPushSupport {
  const hasBrowserApis =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator

  if (!hasBrowserApis) {
    return {
      available: false,
      canManageSubscription: false,
      permission: 'unsupported',
      reason: 'unsupported_browser',
    }
  }

  if (normalizeVapidPublicKey(vapidPublicKey) === null) {
    return {
      available: true,
      canManageSubscription: false,
      permission: window.Notification.permission,
      reason: 'missing_vapid_public_key',
    }
  }

  return {
    available: true,
    canManageSubscription: true,
    permission: window.Notification.permission,
    reason: 'supported',
  }
}

function decodeBase64Url(value: string): string {
  const normalizedValue = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddedValue = normalizedValue.padEnd(
    normalizedValue.length + ((4 - (normalizedValue.length % 4)) % 4),
    '=',
  )

  return window.atob(paddedValue)
}

function vapidPublicKeyToUint8Array(value: string): Uint8Array {
  const decodedValue = decodeBase64Url(value)
  const output = new Uint8Array(decodedValue.length)

  for (let index = 0; index < decodedValue.length; index += 1) {
    output[index] = decodedValue.charCodeAt(index)
  }

  return output
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  const existingRegistration = await navigator.serviceWorker.getRegistration()
  if (existingRegistration) {
    return existingRegistration
  }

  return navigator.serviceWorker.register(serviceWorkerPath)
}

function normalizePushSubscription(
  subscription: PushSubscription,
): NotificationWebPushSubscription {
  const payload = subscription.toJSON()

  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    throw new Error(
      'The browser returned an incomplete push subscription payload.',
    )
  }

  return {
    endpoint: payload.endpoint,
    expirationTime:
      typeof payload.expirationTime === 'number'
        ? payload.expirationTime
        : null,
    keys: {
      p256dh: payload.keys.p256dh,
      auth: payload.keys.auth,
    },
  }
}

export async function subscribeToBrowserPush(
  vapidPublicKey: string,
): Promise<NotificationWebPushSubscription> {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications.')
  }

  const permission =
    window.Notification.permission === 'granted'
      ? 'granted'
      : await window.Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(
      'Browser notifications are blocked for this site. Allow notifications and try again.',
    )
  }

  const registration = await getPushRegistration()
  const existingSubscription = await registration.pushManager.getSubscription()

  if (existingSubscription) {
    return normalizePushSubscription(existingSubscription)
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey:
      vapidPublicKeyToUint8Array(vapidPublicKey) as BufferSource,
  })

  return normalizePushSubscription(subscription)
}

export async function unsubscribeFromBrowserPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }

  const registration = await navigator.serviceWorker.getRegistration()
  const existingSubscription = await registration?.pushManager.getSubscription()

  if (!existingSubscription) {
    return false
  }

  return existingSubscription.unsubscribe()
}
