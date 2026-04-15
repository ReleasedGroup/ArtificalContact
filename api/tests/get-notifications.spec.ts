import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetNotificationsHandler } from '../src/functions/get-notifications.js'
import {
  DEFAULT_NOTIFICATIONS_PAGE_SIZE,
  lookupNotifications,
  type NotificationReadStore,
  type StoredNotificationDocument,
} from '../src/lib/notifications.js'
import type { UserDocument } from '../src/lib/users.js'

function createStoredNotification(
  overrides: Partial<StoredNotificationDocument> = {},
): StoredNotificationDocument {
  return {
    id: 'notif-1',
    type: 'notification',
    targetUserId: 'github:abc123',
    eventType: 'reply',
    actorUserId: 'github:def456',
    actorHandle: 'ada',
    actorDisplayName: 'Ada Lovelace',
    actorAvatarUrl: 'https://cdn.example.com/ada.png',
    relatedEntityId: 'post-1',
    postId: 'post-1',
    threadId: 'thread-1',
    parentId: 'parent-1',
    reactionType: null,
    reactionValues: [],
    excerpt: 'replied to your post in #evals',
    readAt: null,
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:00.000Z',
    ttl: 7776000,
    ...overrides,
  }
}

function createStoredUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'github:abc123',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'abc123',
    email: 'nick@example.com',
    emailLower: 'nick@example.com',
    handle: 'nick',
    handleLower: 'nick',
    displayName: 'Nick Beaugeard',
    expertise: ['llm'],
    links: {
      website: 'https://example.com',
    },
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 3,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createRequest(query = ''): HttpRequest {
  return {
    query: new URLSearchParams(query),
  } as unknown as HttpRequest
}

function createContext(user: UserDocument | null = createStoredUser()) {
  return {
    auth: user
      ? {
          isAuthenticated: true,
          principal: null,
          user,
          roles: user.roles,
        }
      : undefined,
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('lookupNotifications', () => {
  it('returns a normalized notification page with unread count and cursor', async () => {
    const store = {
      listNotifications: vi.fn(async () => ({
        notifications: [
          createStoredNotification({
            eventType: 'reply',
            actorHandle: ' ada ',
            excerpt: ' replied to your post ',
          }),
          createStoredNotification({
            id: '  ',
            eventType: 'follow',
          }),
          createStoredNotification({
            id: 'notif-2',
            readAt: null,
            actorDisplayName: '',
            actorAvatarUrl: '   ',
            threadId: '',
            parentId: '',
            excerpt: '',
          }),
        ],
        cursor: 'next-page-token',
      })),
      countUnreadNotifications: vi.fn(async () => 4),
    } satisfies NotificationReadStore

    const result = await lookupNotifications(
      {
        targetUserId: ' github:abc123 ',
        limit: '10',
        cursor: ' opaque-token ',
      },
      store,
    )

    expect(store.listNotifications).toHaveBeenCalledWith('github:abc123', {
      limit: 10,
      cursor: 'opaque-token',
    })
    expect(store.countUnreadNotifications).toHaveBeenCalledWith('github:abc123')
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          notifications: [
            {
              id: 'notif-1',
              eventType: 'reply',
              actorUserId: 'github:def456',
              actorHandle: 'ada',
              actorDisplayName: 'Ada Lovelace',
              actorAvatarUrl: 'https://cdn.example.com/ada.png',
              relatedEntityId: 'post-1',
              postId: 'post-1',
              threadId: 'thread-1',
              parentId: 'parent-1',
              reactionType: null,
              reactionValues: [],
              excerpt: 'replied to your post',
              read: false,
              readAt: null,
              createdAt: '2026-04-15T09:00:00.000Z',
              updatedAt: '2026-04-15T09:00:00.000Z',
              eventCount: 1,
              coalesced: false,
              coalescedWindowStart: null,
            },
            {
              id: 'notif-2',
              eventType: 'reply',
              actorUserId: 'github:def456',
              actorHandle: 'ada',
              actorDisplayName: null,
              actorAvatarUrl: null,
              relatedEntityId: 'post-1',
              postId: 'post-1',
              threadId: null,
              parentId: null,
              reactionType: null,
              reactionValues: [],
              excerpt: null,
              read: false,
              readAt: null,
              createdAt: '2026-04-15T09:00:00.000Z',
              updatedAt: '2026-04-15T09:00:00.000Z',
              eventCount: 1,
              coalesced: false,
              coalescedWindowStart: null,
            },
          ],
          unreadCount: 4,
        },
        cursor: 'next-page-token',
        errors: [],
      },
    })
  })

  it('uses the default page size and allows empty pages', async () => {
    const store = {
      listNotifications: vi.fn(async () => ({
        notifications: [],
      })),
      countUnreadNotifications: vi.fn(async () => 0),
    } satisfies NotificationReadStore

    const result = await lookupNotifications(
      {
        targetUserId: 'github:abc123',
      },
      store,
    )

    expect(store.listNotifications).toHaveBeenCalledWith('github:abc123', {
      limit: DEFAULT_NOTIFICATIONS_PAGE_SIZE,
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          notifications: [],
          unreadCount: 0,
        },
        cursor: null,
        errors: [],
      },
    })
  })

  it('returns a validation error when the authenticated user id is missing', async () => {
    const result = await lookupNotifications(
      {
        targetUserId: '  ',
      },
      {
        listNotifications: vi.fn(async () => ({
          notifications: [],
        })),
        countUnreadNotifications: vi.fn(async () => 0),
      },
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        cursor: null,
        errors: [
          {
            code: 'invalid_target_user_id',
            message:
              'The authenticated user id is required to load notifications.',
            field: 'targetUserId',
          },
        ],
      },
    })
  })

  it('returns a validation error when the limit is invalid', async () => {
    const store = {
      listNotifications: vi.fn(async () => ({
        notifications: [],
      })),
      countUnreadNotifications: vi.fn(async () => 0),
    } satisfies NotificationReadStore

    const result = await lookupNotifications(
      {
        targetUserId: 'github:abc123',
        limit: '500',
      },
      store,
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        cursor: null,
        errors: [
          {
            code: 'invalid_limit',
            message:
              'The limit query parameter must be an integer between 1 and 100.',
            field: 'limit',
          },
        ],
      },
    })
    expect(store.listNotifications).not.toHaveBeenCalled()
    expect(store.countUnreadNotifications).not.toHaveBeenCalled()
  })
})

describe('getNotificationsHandler', () => {
  it('reads the authenticated notifications and returns the JSON envelope', async () => {
    const store = {
      listNotifications: vi.fn(async () => ({
        notifications: [createStoredNotification()],
        cursor: 'next-page-token',
      })),
      countUnreadNotifications: vi.fn(async () => 3),
    } satisfies NotificationReadStore
    const handler = buildGetNotificationsHandler({
      storeFactory: () => store,
    })

    const response = await handler(
      createRequest('limit=10&cursor=opaque-token'),
      createContext(),
    )

    expect(store.listNotifications).toHaveBeenCalledWith('github:abc123', {
      limit: 10,
      cursor: 'opaque-token',
    })
    expect(store.countUnreadNotifications).toHaveBeenCalledWith('github:abc123')
    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        notifications: [
          {
            id: 'notif-1',
            eventType: 'reply',
            actorUserId: 'github:def456',
            actorHandle: 'ada',
            actorDisplayName: 'Ada Lovelace',
            actorAvatarUrl: 'https://cdn.example.com/ada.png',
            relatedEntityId: 'post-1',
            postId: 'post-1',
            threadId: 'thread-1',
            parentId: 'parent-1',
            reactionType: null,
            reactionValues: [],
            excerpt: 'replied to your post in #evals',
            read: false,
            readAt: null,
            createdAt: '2026-04-15T09:00:00.000Z',
            updatedAt: '2026-04-15T09:00:00.000Z',
            eventCount: 1,
            coalesced: false,
            coalescedWindowStart: null,
          },
        ],
        unreadCount: 3,
      },
      cursor: 'next-page-token',
      errors: [],
    })
  })

  it('rejects requests without an authenticated profile in context', async () => {
    const handler = buildGetNotificationsHandler({
      storeFactory: () => ({
        listNotifications: vi.fn(async () => ({
          notifications: [],
        })),
        countUnreadNotifications: vi.fn(async () => 0),
      }),
    })

    const response = await handler(createRequest(), createContext(null))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have a provisioned profile before reading notifications.',
        },
      ],
    })
  })

  it('returns a configuration error when the notifications store cannot be created', async () => {
    const handler = buildGetNotificationsHandler({
      storeFactory: () => {
        throw new Error('Missing notifications configuration')
      },
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The notifications store is not configured.',
        },
      ],
    })
  })

  it('returns a server error when the notifications lookup fails', async () => {
    const handler = buildGetNotificationsHandler({
      storeFactory: () => ({
        listNotifications: async () => {
          throw new Error('Cosmos unavailable')
        },
        countUnreadNotifications: async () => 0,
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'server.notifications_lookup_failed',
          message: "Unable to load the authenticated user's notifications.",
        },
      ],
    })
  })
})
