import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNotificationsPage,
  markAllNotificationsRead,
  markAllNotificationsReadInCache,
  markNotificationRead,
  markNotificationReadInCache,
  NOTIFICATION_BELL_QUERY_KEY,
  NOTIFICATION_FEED_QUERY_KEY,
  restoreNotificationsCache,
  type NotificationsPage,
} from './notifications'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function createNotificationsPage(
  overrides?: Partial<NotificationsPage>,
): NotificationsPage {
  return {
    notifications: [
      {
        id: 'notif-1',
        eventType: 'reply',
        text: null,
        read: false,
        createdAt: '2026-04-15T08:00:00.000Z',
        targetUrl: null,
        postId: 'post-1',
        threadId: 'thread-1',
        excerpt: 'Thanks for the detailed write-up.',
        eventCount: 1,
        coalesced: false,
        actor: {
          id: 'user-2',
          handle: 'grace',
          displayName: 'Grace Hopper',
          avatarUrl: null,
        },
      },
      {
        id: 'notif-2',
        eventType: 'follow',
        text: 'started following you.',
        read: false,
        createdAt: '2026-04-15T07:30:00.000Z',
        targetUrl: null,
        postId: null,
        threadId: null,
        excerpt: null,
        eventCount: 1,
        coalesced: false,
        actor: {
          id: 'user-3',
          handle: 'linus',
          displayName: 'Linus Torvalds',
          avatarUrl: 'https://cdn.example.com/avatars/linus.png',
        },
      },
    ],
    cursor: 'cursor-2',
    unreadCount: 2,
    ...overrides,
  }
}

describe('notifications client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes notifications from the nested API envelope', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          notifications: [
            {
              id: 'notif-1',
              eventType: 'mention',
              excerpt: 'You should look at the shipping draft.',
              readAt: null,
              createdAt: '2026-04-15T08:00:00.000Z',
              postId: 'post-1',
              actorUserId: 'user-2',
              actorHandle: 'grace',
              actorDisplayName: 'Grace Hopper',
            },
            {
              id: 'notif-2',
              eventType: 'reaction',
              excerpt: 'Shipped the notifications work.',
              readAt: null,
              createdAt: '2026-04-15T07:30:00.000Z',
              actor: {
                id: 'user-3',
                handle: 'linus',
                displayName: 'Linus Torvalds',
                avatarUrl: 'https://cdn.example.com/avatars/linus.png',
              },
              eventCount: 3,
              coalesced: true,
            },
          ],
          unreadCount: 7,
        },
        cursor: 'cursor-2',
        errors: [],
      }),
    )

    await expect(getNotificationsPage()).resolves.toEqual({
      notifications: [
        {
          id: 'notif-1',
          eventType: 'mention',
          text: null,
          read: false,
          createdAt: '2026-04-15T08:00:00.000Z',
          targetUrl: null,
          postId: 'post-1',
          threadId: null,
          excerpt: 'You should look at the shipping draft.',
          eventCount: 1,
          coalesced: false,
          actor: {
            id: 'user-2',
            handle: 'grace',
            displayName: 'Grace Hopper',
            avatarUrl: null,
          },
        },
        {
          id: 'notif-2',
          eventType: 'reaction',
          text: null,
          read: false,
          createdAt: '2026-04-15T07:30:00.000Z',
          targetUrl: null,
          postId: null,
          threadId: null,
          excerpt: 'Shipped the notifications work.',
          eventCount: 3,
          coalesced: true,
          actor: {
            id: 'user-3',
            handle: 'linus',
            displayName: 'Linus Torvalds',
            avatarUrl: 'https://cdn.example.com/avatars/linus.png',
          },
        },
      ],
      cursor: 'cursor-2',
      unreadCount: 7,
    })
  })

  it('still accepts the legacy flat envelope while tests catch up', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'notif-1',
            type: 'follow',
            message: 'started following you.',
            isRead: false,
            createdAt: '2026-04-15T08:00:00.000Z',
            actorHandle: 'grace',
            actorDisplayName: 'Grace Hopper',
          },
        ],
        cursor: null,
        unreadCount: 1,
        errors: [],
      }),
    )

    await expect(getNotificationsPage()).resolves.toEqual({
      notifications: [
        {
          id: 'notif-1',
          eventType: 'follow',
          text: 'started following you.',
          read: false,
          createdAt: '2026-04-15T08:00:00.000Z',
          targetUrl: null,
          postId: null,
          threadId: null,
          excerpt: null,
          eventCount: 1,
          coalesced: false,
          actor: {
            id: null,
            handle: 'grace',
            displayName: 'Grace Hopper',
            avatarUrl: null,
          },
        },
      ],
      cursor: null,
      unreadCount: 1,
    })
  })

  it('treats readAt notifications as read when unreadCount is missing', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'notif-1',
            type: 'follow',
            message: 'started following you.',
            readAt: '2026-04-15T08:05:00.000Z',
            createdAt: '2026-04-15T08:00:00.000Z',
            actorHandle: 'grace',
            actorDisplayName: 'Grace Hopper',
          },
        ],
        cursor: null,
        errors: [],
      }),
    )

    await expect(getNotificationsPage()).resolves.toEqual({
      notifications: [
        {
          id: 'notif-1',
          eventType: 'follow',
          text: 'started following you.',
          read: true,
          createdAt: '2026-04-15T08:00:00.000Z',
          targetUrl: null,
          postId: null,
          threadId: null,
          excerpt: null,
          eventCount: 1,
          coalesced: false,
          actor: {
            id: null,
            handle: 'grace',
            displayName: 'Grace Hopper',
            avatarUrl: null,
          },
        },
      ],
      cursor: null,
      unreadCount: 0,
    })
  })

  it('posts a single mark-read request', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          read: {
            scope: 'single',
            notificationId: 'notif-1',
            updatedCount: 1,
          },
        },
        errors: [],
      }),
    )

    await expect(markNotificationRead('notif-1')).resolves.toEqual({
      scope: 'single',
      notificationId: 'notif-1',
      updatedCount: 1,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/notifications/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          notificationId: 'notif-1',
        }),
      }),
    )
  })

  it('posts a mark-all request', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          read: {
            scope: 'all',
            notificationId: null,
            updatedCount: 2,
          },
        },
        errors: [],
      }),
    )

    await expect(markAllNotificationsRead()).resolves.toEqual({
      scope: 'all',
      notificationId: null,
      updatedCount: 2,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/notifications/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          all: true,
        }),
      }),
    )
  })

  it('can optimistically mark a single notification as read across caches', () => {
    const queryClient = new QueryClient()
    const bellData = createNotificationsPage()
    const feedData = {
      pages: [createNotificationsPage()],
      pageParams: [null],
    }

    queryClient.setQueryData(NOTIFICATION_BELL_QUERY_KEY, bellData)
    queryClient.setQueryData(NOTIFICATION_FEED_QUERY_KEY, feedData)

    const snapshot = markNotificationReadInCache(queryClient, 'notif-1')

    expect(snapshot.bellData?.unreadCount).toBe(2)
    expect(
      queryClient.getQueryData<NotificationsPage>(NOTIFICATION_BELL_QUERY_KEY),
    ).toMatchObject({
      unreadCount: 1,
      notifications: [
        {
          id: 'notif-1',
          read: true,
        },
        {
          id: 'notif-2',
          read: false,
        },
      ],
    })

    restoreNotificationsCache(queryClient, snapshot)

    expect(
      queryClient.getQueryData<NotificationsPage>(NOTIFICATION_BELL_QUERY_KEY),
    ).toEqual(bellData)
  })

  it('can optimistically mark all notifications as read across caches', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(
      NOTIFICATION_BELL_QUERY_KEY,
      createNotificationsPage(),
    )
    queryClient.setQueryData(NOTIFICATION_FEED_QUERY_KEY, {
      pages: [createNotificationsPage()],
      pageParams: [null],
    })

    markAllNotificationsReadInCache(queryClient)

    expect(
      queryClient.getQueryData<NotificationsPage>(NOTIFICATION_BELL_QUERY_KEY),
    ).toMatchObject({
      unreadCount: 0,
      notifications: [
        {
          id: 'notif-1',
          read: true,
        },
        {
          id: 'notif-2',
          read: true,
        },
      ],
    })
  })

  it('surfaces API errors from the notification feed endpoint', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(503, {
        data: null,
        errors: [
          {
            code: 'notifications.unavailable',
            message: 'Notification feed is warming up.',
          },
        ],
      }),
    )

    await expect(getNotificationsPage()).rejects.toThrow(
      'Notification feed is warming up.',
    )
  })
})
