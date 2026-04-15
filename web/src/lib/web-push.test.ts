import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getBrowserPushSupport,
  subscribeToBrowserPush,
  unsubscribeFromBrowserPush,
} from './web-push'

describe('web push helpers', () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
    vi.unstubAllGlobals()
  })

  it('marks the browser as unsupported when the required APIs are missing', () => {
    vi.stubGlobal('window', {})
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })

    expect(getBrowserPushSupport('public-key')).toEqual({
      available: false,
      canManageSubscription: false,
      permission: 'unsupported',
      reason: 'unsupported_browser',
    })
  })

  it('requires the public VAPID key before managing subscriptions', () => {
    vi.stubGlobal('window', {
      Notification: { permission: 'default' },
      PushManager: class PushManager {},
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {},
      },
    })

    expect(getBrowserPushSupport('')).toEqual({
      available: true,
      canManageSubscription: false,
      permission: 'default',
      reason: 'missing_vapid_public_key',
    })
  })

  it('reuses an existing browser subscription before attempting a new subscription', async () => {
    const existingSubscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.com/subscriptions/existing',
        expirationTime: null,
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    }
    const getSubscription = vi.fn(async () => existingSubscription)
    const subscribe = vi.fn()

    vi.stubGlobal('window', {
      Notification: {
        permission: 'granted',
        requestPermission: vi.fn(async () => 'granted'),
      },
      PushManager: class PushManager {},
      atob: globalThis.atob,
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: vi.fn(async () => ({
            pushManager: {
              getSubscription,
              subscribe,
            },
          })),
          register: vi.fn(),
        },
      },
    })

    await expect(subscribeToBrowserPush('AQAB')).resolves.toEqual({
      endpoint: 'https://push.example.com/subscriptions/existing',
      expirationTime: null,
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      },
    })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('unsubscribes the current browser subscription when disabling push', async () => {
    const unsubscribe = vi.fn(async () => true)

    vi.stubGlobal('window', {
      PushManager: class PushManager {},
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: vi.fn(async () => ({
            pushManager: {
              getSubscription: vi.fn(async () => ({
                unsubscribe,
              })),
            },
          })),
        },
      },
    })

    await expect(unsubscribeFromBrowserPush()).resolves.toBe(true)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
