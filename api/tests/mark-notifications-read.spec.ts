import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildMarkNotificationsReadHandler } from '../src/functions/mark-notifications-read.js'
import type {
  NotificationDocument,
  NotificationRepository,
} from '../src/lib/notifications.js'
import type { UserDocument } from '../src/lib/users.js'

function createRequest(body: unknown, options?: { invalidJson?: boolean }) {
  return {
    json: async () => {
      if (options?.invalidJson) {
        throw new Error('Invalid JSON')
      }

      return body
    },
  } as unknown as HttpRequest
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
    bio: 'Building with Azure Functions.',
    avatarUrl: 'https://cdn.example.com/nick.png',
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

function createStoredNotification(
  overrides: Partial<NotificationDocument> = {},
): NotificationDocument {
  return {
    id: 'notification-1',
    type: 'notification',
    targetUserId: 'github:abc123',
    actorUserId: 'github:actor',
    actorHandle: 'ada',
    actorDisplayName: 'Ada Lovelace',
    actorAvatarUrl: 'https://cdn.example.com/ada.png',
    eventType: 'reply',
    relatedEntityId: 'post-1',
    postId: 'post-1',
    threadId: 'thread-1',
    parentId: null,
    reactionType: null,
    reactionValues: [],
    excerpt: 'Thanks for the reply.',
    readAt: null,
    createdAt: '2026-04-15T04:00:00.000Z',
    updatedAt: '2026-04-15T04:00:00.000Z',
    ttl: 60 * 60 * 24 * 90,
    ...overrides,
  }
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

function createRepository(
  overrides: Partial<NotificationRepository> = {},
): NotificationRepository {
  return {
    getByTargetUserAndId: vi.fn(async () => null),
    listUnreadByTargetUserId: vi.fn(async () => []),
    upsert: vi.fn(async (notification) => notification),
    ...overrides,
  }
}

describe('markNotificationsReadHandler', () => {
  it('marks a single unread notification as read', async () => {
    const repository = createRepository({
      getByTargetUserAndId: vi.fn(async () => createStoredNotification()),
    })
    const handler = buildMarkNotificationsReadHandler({
      now: () => new Date('2026-04-15T08:00:00.000Z'),
      repositoryFactory: () => repository,
    })
    const context = createContext()

    const response = await handler(
      createRequest({
        notificationId: ' notification-1 ',
      }),
      context,
    )

    expect(repository.getByTargetUserAndId).toHaveBeenCalledWith(
      'github:abc123',
      'notification-1',
    )
    expect(repository.upsert).toHaveBeenCalledWith(
      createStoredNotification({
        readAt: '2026-04-15T08:00:00.000Z',
        updatedAt: '2026-04-15T08:00:00.000Z',
      }),
    )
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        read: {
          scope: 'single',
          notificationId: 'notification-1',
          updatedCount: 1,
        },
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Processed notification read request.',
      {
        actorId: 'github:abc123',
        notificationId: 'notification-1',
        scope: 'single',
        updatedCount: 1,
      },
    )
  })

  it('treats repeated single-notification reads as a successful no-op', async () => {
    const repository = createRepository({
      getByTargetUserAndId: vi.fn(async () =>
        createStoredNotification({
          readAt: '2026-04-15T06:00:00.000Z',
        }),
      ),
    })
    const handler = buildMarkNotificationsReadHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        notificationId: 'notification-1',
      }),
      createContext(),
    )

    expect(repository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        read: {
          scope: 'single',
          notificationId: 'notification-1',
          updatedCount: 0,
        },
      },
      errors: [],
    })
  })

  it('treats missing notifications as a successful no-op', async () => {
    const repository = createRepository()
    const handler = buildMarkNotificationsReadHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        notificationId: 'notification-404',
      }),
      createContext(),
    )

    expect(repository.getByTargetUserAndId).toHaveBeenCalledWith(
      'github:abc123',
      'notification-404',
    )
    expect(repository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        read: {
          scope: 'single',
          notificationId: 'notification-404',
          updatedCount: 0,
        },
      },
      errors: [],
    })
  })

  it('marks all unread notifications as read', async () => {
    const repository = createRepository({
      listUnreadByTargetUserId: vi.fn(async () => [
        createStoredNotification({
          id: 'notification-1',
        }),
        createStoredNotification({
          id: 'notification-2',
          eventType: 'follow',
        }),
      ]),
    })
    const handler = buildMarkNotificationsReadHandler({
      now: () => new Date('2026-04-15T08:05:00.000Z'),
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        all: true,
      }),
      createContext(),
    )

    expect(repository.listUnreadByTargetUserId).toHaveBeenCalledWith(
      'github:abc123',
    )
    expect(repository.upsert).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        read: {
          scope: 'all',
          notificationId: null,
          updatedCount: 2,
        },
      },
      errors: [],
    })
  })

  it('batches mark-all upserts to limit concurrent writes', async () => {
    let inFlightUpserts = 0
    let maxConcurrentUpserts = 0

    const repository = createRepository({
      listUnreadByTargetUserId: vi.fn(async () =>
        Array.from({ length: 60 }, (_, index) =>
          createStoredNotification({
            id: `notification-${index + 1}`,
          }),
        ),
      ),
      upsert: vi.fn(async (notification) => {
        inFlightUpserts += 1
        maxConcurrentUpserts = Math.max(maxConcurrentUpserts, inFlightUpserts)
        await new Promise((resolve) => setTimeout(resolve, 0))
        inFlightUpserts -= 1
        return notification
      }),
    })
    const handler = buildMarkNotificationsReadHandler({
      now: () => new Date('2026-04-15T08:05:00.000Z'),
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        all: true,
      }),
      createContext(),
    )

    expect(repository.upsert).toHaveBeenCalledTimes(60)
    expect(maxConcurrentUpserts).toBeLessThanOrEqual(25)
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        read: {
          scope: 'all',
          notificationId: null,
          updatedCount: 60,
        },
      },
      errors: [],
    })
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildMarkNotificationsReadHandler({
      repositoryFactory: () => createRepository(),
    })

    const response = await handler(
      createRequest({}, { invalidJson: true }),
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

  it('returns validation errors when the request is ambiguous', async () => {
    const handler = buildMarkNotificationsReadHandler({
      repositoryFactory: () => createRepository(),
    })

    const response = await handler(
      createRequest({
        all: true,
        notificationId: 'notification-1',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_notification_read',
          message: 'Specify either all=true or notificationId, but not both.',
          field: 'notificationId',
        },
      ],
    })
  })

  it('rejects users who do not have an active profile', async () => {
    const handler = buildMarkNotificationsReadHandler({
      repositoryFactory: () => createRepository(),
    })

    const response = await handler(
      createRequest({
        notificationId: 'notification-1',
      }),
      createContext(createStoredUser({ status: 'pending' })),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before marking notifications as read.',
        },
      ],
    })
  })
})
