import type { Container } from '@azure/cosmos'
import { describe, expect, it } from 'vitest'
import {
  applyNotificationRead,
  buildMarkNotificationsReadRequestSchema,
  createNotificationRepositoryForContainer,
  isNotificationRead,
  type NotificationDocument,
} from '../src/lib/notifications.js'

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
    createdAt: '2026-04-15T01:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ttl: 60 * 60 * 24 * 90,
    ...overrides,
  }
}

describe('buildMarkNotificationsReadRequestSchema', () => {
  it('accepts a single notification target with trimmed id', () => {
    const schema = buildMarkNotificationsReadRequestSchema()

    const result = schema.safeParse({
      notificationId: '  notification-1  ',
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      scope: 'single',
      notificationId: 'notification-1',
    })
  })

  it('accepts the mark-all command', () => {
    const schema = buildMarkNotificationsReadRequestSchema()

    const result = schema.safeParse({
      all: true,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      scope: 'all',
    })
  })

  it('rejects ambiguous requests', () => {
    const schema = buildMarkNotificationsReadRequestSchema()

    const result = schema.safeParse({
      all: true,
      notificationId: 'notification-1',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        message: 'Specify either all=true or notificationId, but not both.',
        path: ['notificationId'],
      }),
    ])
  })
})

describe('applyNotificationRead', () => {
  it('marks an unread notification as read', () => {
    const result = applyNotificationRead(
      createStoredNotification(),
      new Date('2026-04-15T09:00:00.000Z'),
    )

    expect(result).toEqual({
      changed: true,
      notification: createStoredNotification({
        readAt: '2026-04-15T09:00:00.000Z',
        updatedAt: '2026-04-15T09:00:00.000Z',
      }),
    })
  })

  it('treats notifications with readAt as already read', () => {
    const notification = createStoredNotification({
      readAt: '2026-04-15T05:00:00.000Z',
    })

    expect(isNotificationRead(notification)).toBe(true)
    expect(
      applyNotificationRead(notification, new Date('2026-04-15T09:00:00.000Z')),
    ).toEqual({
      changed: false,
      notification,
    })
  })

  it('treats blank readAt values as unread and normalizes them on write', () => {
    const notification = createStoredNotification({
      readAt: '   ',
    })

    expect(isNotificationRead(notification)).toBe(false)
    expect(
      applyNotificationRead(notification, new Date('2026-04-15T09:00:00.000Z')),
    ).toEqual({
      changed: true,
      notification: createStoredNotification({
        readAt: '2026-04-15T09:00:00.000Z',
        updatedAt: '2026-04-15T09:00:00.000Z',
      }),
    })
  })
})

describe('createNotificationRepositoryForContainer', () => {
  it('treats string-coded 404 Cosmos reads as missing notifications', async () => {
    const container = {
      item: () => ({
        read: async () => {
          throw Object.assign(new Error('Not found'), {
            code: '404',
          })
        },
      }),
    } as unknown as Container

    const repository = createNotificationRepositoryForContainer(container)

    await expect(
      repository.getByTargetUserAndId('github:abc123', 'notification-404'),
    ).resolves.toBeNull()
  })

  it('pages unread notification queries and matches legacy unread fields', async () => {
    const queryPages = [
      [
        createStoredNotification({
          id: 'notification-1',
        }),
      ],
      [
        createStoredNotification({
          id: 'notification-2',
          readAt: '   ',
        }),
      ],
    ]

    let capturedQuery:
      | {
          parameters?: Array<{ name: string; value: string }>
          query?: string
        }
      | undefined
    let capturedOptions:
      | {
          maxItemCount?: number
          partitionKey?: string
        }
      | undefined

    const container = {
      items: {
        query: (
          query: {
            parameters?: Array<{ name: string; value: string }>
            query?: string
          },
          options: {
            maxItemCount?: number
            partitionKey?: string
          },
        ) => {
          capturedQuery = query
          capturedOptions = options

          return {
            hasMoreResults: () => queryPages.length > 0,
            fetchNext: async () => ({
              resources: queryPages.shift() ?? [],
            }),
          }
        },
      },
    } as unknown as Container

    const repository = createNotificationRepositoryForContainer(container)

    await expect(
      repository.listUnreadByTargetUserId('github:abc123'),
    ).resolves.toEqual([
      createStoredNotification({
        id: 'notification-1',
      }),
      createStoredNotification({
        id: 'notification-2',
        readAt: '   ',
      }),
    ])

    expect(capturedOptions).toEqual({
      maxItemCount: 100,
      partitionKey: 'github:abc123',
    })
    expect(capturedQuery?.parameters).toEqual([
      { name: '@type', value: 'notification' },
    ])
    expect(capturedQuery?.query).toContain('OR IS_NULL(c.read)')
    expect(capturedQuery?.query).toContain('OR c.read = false')
    expect(capturedQuery?.query).toContain('OR LENGTH(TRIM(c.readAt)) = 0')
  })
})
