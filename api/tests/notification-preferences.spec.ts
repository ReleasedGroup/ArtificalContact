import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import {
  buildGetNotificationPreferencesHandler,
  buildUpdateNotificationPreferencesHandler,
} from '../src/functions/notification-preferences.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import type { NotificationPreferenceStore } from '../src/lib/cosmos-notification-preference-store.js'
import type { NotificationPreferencesDocument } from '../src/lib/notification-preferences.js'

function createPrincipalRequest(
  principal: Record<string, unknown>,
  body?: unknown,
): HttpRequest {
  const encodedPrincipal = Buffer.from(JSON.stringify(principal)).toString(
    'base64',
  )

  return {
    headers: {
      get(name: string) {
        if (name.toLowerCase() !== CLIENT_PRINCIPAL_HEADER) {
          return null
        }

        return encodedPrincipal
      },
    },
    json:
      body instanceof Error
        ? async () => {
            throw body
          }
        : async () => body,
  } as unknown as HttpRequest
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createStoredPreferences(
  overrides: Partial<NotificationPreferencesDocument> = {},
): NotificationPreferencesDocument {
  return {
    id: 'github:abc123',
    type: 'notificationPrefs',
    userId: 'github:abc123',
    events: {
      follow: {
        inApp: true,
        email: false,
        webPush: false,
      },
      reply: {
        inApp: true,
        email: false,
        webPush: false,
      },
      reaction: {
        inApp: true,
        email: false,
        webPush: false,
      },
      mention: {
        inApp: true,
        email: true,
        webPush: false,
      },
      followeePost: {
        inApp: false,
        email: false,
        webPush: false,
      },
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
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

describe('notification preference handlers', () => {
  it('returns default preferences when the caller has no stored document', async () => {
    const store: NotificationPreferenceStore = {
      getByUserId: vi.fn(async () => null),
      upsert: vi.fn(async (document) => document),
    }

    const handler = buildGetNotificationPreferencesHandler({
      storeFactory: () => store,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [{ typ: 'emails', val: 'nick@example.com' }],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
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
            supported: false,
            subscription: null,
          },
          createdAt: '2026-04-15T02:00:00.000Z',
          updatedAt: '2026-04-15T02:00:00.000Z',
        },
      },
      errors: [],
    })
  })

  it('returns a 401 when notification preferences are requested anonymously', async () => {
    const handler = buildGetNotificationPreferencesHandler({
      storeFactory: () => ({
        getByUserId: async () => null,
        upsert: async (document) => document,
      }),
    })

    const response = await handler(
      { headers: { get: () => null } } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(401)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.missing_principal',
          message: 'Authentication is required.',
        },
      ],
    })
  })

  it('merges a partial update into stored preferences and clears stale subscriptions when push is disabled', async () => {
    const existingDocument = createStoredPreferences()
    const store: NotificationPreferenceStore = {
      getByUserId: vi.fn(async () => existingDocument),
      upsert: vi.fn(async (document) => document),
    }

    const handler = buildUpdateNotificationPreferencesHandler({
      storeFactory: () => store,
      now: () => new Date('2026-04-15T03:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          events: {
            mention: {
              email: false,
            },
            followeePost: {
              email: true,
              webPush: true,
            },
          },
          webPush: {
            supported: false,
          },
        },
      ),
      createContext(),
    )

    expect(store.upsert).toHaveBeenCalledWith({
      ...existingDocument,
      events: {
        ...existingDocument.events,
        mention: {
          inApp: true,
          email: false,
          webPush: false,
        },
        followeePost: {
          inApp: false,
          email: true,
          webPush: true,
        },
      },
      webPush: {
        supported: false,
        subscription: null,
      },
      updatedAt: '2026-04-15T03:00:00.000Z',
    })
    expect(response.status).toBe(200)
  })

  it('ignores a replacement subscription when the same update disables web push', async () => {
    const existingDocument = createStoredPreferences()
    const store: NotificationPreferenceStore = {
      getByUserId: vi.fn(async () => existingDocument),
      upsert: vi.fn(async (document) => document),
    }

    const handler = buildUpdateNotificationPreferencesHandler({
      storeFactory: () => store,
      now: () => new Date('2026-04-15T03:30:00.000Z'),
    })

    await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          webPush: {
            supported: false,
            subscription: {
              endpoint: 'https://push.example.com/subscriptions/new',
              expirationTime: null,
              keys: {
                p256dh: 'new-p256dh',
                auth: 'new-auth',
              },
            },
          },
        },
      ),
      createContext(),
    )

    expect(store.upsert).toHaveBeenCalledWith({
      ...existingDocument,
      webPush: {
        supported: false,
        subscription: null,
      },
      updatedAt: '2026-04-15T03:30:00.000Z',
    })
  })

  it('creates a new document when the caller updates preferences for the first time', async () => {
    const store: NotificationPreferenceStore = {
      getByUserId: vi.fn(async () => null),
      upsert: vi.fn(async (document) => document),
    }

    const handler = buildUpdateNotificationPreferencesHandler({
      storeFactory: () => store,
      now: () => new Date('2026-04-15T04:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          events: {
            followeePost: {
              inApp: true,
            },
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
        },
      ),
      createContext(),
    )

    expect(store.upsert).toHaveBeenCalledWith({
      id: 'github:abc123',
      type: 'notificationPrefs',
      userId: 'github:abc123',
      events: {
        follow: { inApp: true, email: false, webPush: false },
        reply: { inApp: true, email: false, webPush: false },
        reaction: { inApp: true, email: false, webPush: false },
        mention: { inApp: true, email: false, webPush: false },
        followeePost: { inApp: true, email: false, webPush: false },
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
      createdAt: '2026-04-15T04:00:00.000Z',
      updatedAt: '2026-04-15T04:00:00.000Z',
    })
    expect(response.status).toBe(200)
  })

  it('rejects malformed JSON when updating notification preferences', async () => {
    const handler = buildUpdateNotificationPreferencesHandler({
      storeFactory: () => ({
        getByUserId: async () => null,
        upsert: async (document) => document,
      }),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [],
        },
        new Error('Invalid JSON'),
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_json',
          message: 'The request body must be valid JSON.',
        },
      ],
    })
  })

  it('returns validation issues for invalid notification preference payloads', async () => {
    const handler = buildUpdateNotificationPreferencesHandler({
      storeFactory: () => ({
        getByUserId: async () => null,
        upsert: async (document) => document,
      }),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [],
        },
        {
          webPush: {
            subscription: {
              endpoint: 'not-a-url',
              expirationTime: null,
              keys: {
                p256dh: '',
                auth: '',
              },
            },
          },
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_notification_preferences',
          message: 'Invalid URL',
          field: 'webPush.subscription.endpoint',
        },
        {
          code: 'invalid_notification_preferences',
          message: 'Too small: expected string to have >=1 characters',
          field: 'webPush.subscription.keys.p256dh',
        },
        {
          code: 'invalid_notification_preferences',
          message: 'Too small: expected string to have >=1 characters',
          field: 'webPush.subscription.keys.auth',
        },
      ],
    })
  })

  it('returns a configuration error when the notification preference store cannot be created', async () => {
    const context = createContext()
    const handler = buildGetNotificationPreferencesHandler({
      storeFactory: () => {
        throw new Error('Missing Cosmos config')
      },
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [],
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The notification preference store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the notification preference store.',
      {
        error: 'Missing Cosmos config',
      },
    )
  })
})
