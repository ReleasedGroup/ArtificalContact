import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNotificationsPage } from './notifications'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('getNotificationsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes notification records from the documented response envelope', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'notif-1',
            type: 'mention',
            message: 'mentioned you in a thread about evals.',
            isRead: false,
            createdAt: '2026-04-15T08:00:00.000Z',
            postId: 'post-1',
            actorHandle: 'grace',
            actorDisplayName: 'Grace Hopper',
          },
          {
            id: 'notif-2',
            eventType: 'follow',
            text: 'started following you.',
            read: true,
            createdAt: '2026-04-15T07:30:00.000Z',
            actor: {
              id: 'user-2',
              handle: 'linus',
              displayName: 'Linus Torvalds',
              avatarUrl: 'https://cdn.example.com/avatars/linus.png',
            },
          },
        ],
        cursor: 'cursor-2',
        unreadCount: 7,
        errors: [],
      }),
    )

    await expect(getNotificationsPage()).resolves.toEqual({
      notifications: [
        {
          id: 'notif-1',
          eventType: 'mention',
          text: 'mentioned you in a thread about evals.',
          read: false,
          createdAt: '2026-04-15T08:00:00.000Z',
          targetUrl: null,
          postId: 'post-1',
          threadId: null,
          actor: {
            id: null,
            handle: 'grace',
            displayName: 'Grace Hopper',
            avatarUrl: null,
          },
        },
        {
          id: 'notif-2',
          eventType: 'follow',
          text: 'started following you.',
          read: true,
          createdAt: '2026-04-15T07:30:00.000Z',
          targetUrl: null,
          postId: null,
          threadId: null,
          actor: {
            id: 'user-2',
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
