import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from './notification-preferences'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('notification preferences client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the stored notification preferences payload', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          preferences: {
            userId: 'github:abc123',
            events: {
              follow: { inApp: true, email: false, webPush: false },
              reply: { inApp: true, email: false, webPush: false },
              reaction: { inApp: true, email: false, webPush: false },
              mention: { inApp: true, email: false, webPush: false },
              followeePost: { inApp: false, email: false, webPush: false },
            },
            webPush: {
              supported: true,
              subscription: {
                endpoint: 'https://push.example.com/subscriptions/123',
                expirationTime: null,
                keys: {
                  p256dh: 'p256dh-key',
                  auth: 'auth-key',
                },
              },
            },
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T01:00:00.000Z',
          },
        },
        errors: [],
      }),
    )

    await expect(getNotificationPreferences()).resolves.toMatchObject({
      userId: 'github:abc123',
      webPush: {
        supported: true,
      },
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/me/notifications', {
      headers: {
        Accept: 'application/json',
      },
      signal: undefined,
    })
  })

  it('persists browser push updates through the notification preferences endpoint', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          preferences: {
            userId: 'github:abc123',
            events: {
              follow: { inApp: true, email: false, webPush: false },
              reply: { inApp: true, email: false, webPush: false },
              reaction: { inApp: true, email: false, webPush: false },
              mention: { inApp: true, email: false, webPush: false },
              followeePost: { inApp: false, email: false, webPush: false },
            },
            webPush: {
              supported: true,
              subscription: {
                endpoint: 'https://push.example.com/subscriptions/abc123',
                expirationTime: null,
                keys: {
                  p256dh: 'next-p256dh',
                  auth: 'next-auth',
                },
              },
            },
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T02:00:00.000Z',
          },
        },
        errors: [],
      }),
    )

    await updateNotificationPreferences({
      webPush: {
        supported: true,
        subscription: {
          endpoint: 'https://push.example.com/subscriptions/abc123',
          expirationTime: null,
          keys: {
            p256dh: 'next-p256dh',
            auth: 'next-auth',
          },
        },
      },
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/me/notifications', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webPush: {
          supported: true,
          subscription: {
            endpoint: 'https://push.example.com/subscriptions/abc123',
            expirationTime: null,
            keys: {
              p256dh: 'next-p256dh',
              auth: 'next-auth',
            },
          },
        },
      }),
      signal: undefined,
    })
  })
})
