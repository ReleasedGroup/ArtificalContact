import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationsScreen } from './NotificationsScreen'
import { createQueryClient } from '../lib/query-client'
import type { MeProfile } from '../lib/me'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function createNotificationPreferencesResponse() {
  return createJsonResponse(200, {
    data: {
      preferences: {
        userId: 'github:viewer-1',
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
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
    },
    errors: [],
  })
}

function mockNotificationRequests(notificationPayload: unknown) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const requestUrl = typeof input === 'string' ? input : input.toString()

    if (requestUrl.includes('/api/me/notifications')) {
      return createNotificationPreferencesResponse()
    }

    return createJsonResponse(200, notificationPayload)
  })
}

function createViewer(overrides?: Partial<MeProfile>): MeProfile {
  return {
    id: 'github:viewer-1',
    identityProvider: 'github',
    identityProviderUserId: 'viewer-1',
    email: 'ada@example.com',
    handle: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Following agent builders and evaluation engineers.',
    avatarUrl: null,
    bannerUrl: null,
    expertise: ['agents'],
    links: {},
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 4,
      followers: 12,
      following: 8,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

function renderNotificationsScreen(viewer = createViewer()) {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationsScreen viewer={viewer} />
    </QueryClientProvider>,
  )
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockNotificationRequests({
      data: [],
      cursor: null,
      unreadCount: 0,
      errors: [],
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('filters the loaded notification feed by the selected tab', async () => {
    mockNotificationRequests({
      data: [
        {
          id: 'notif-mention',
          eventType: 'mention',
          text: 'mentioned you in a thread about evals.',
          read: false,
          createdAt: '2026-04-15T08:00:00.000Z',
          actor: {
            handle: 'grace',
            displayName: 'Grace Hopper',
          },
        },
        {
          id: 'notif-reply',
          eventType: 'reply',
          text: 'replied to your post.',
          read: false,
          createdAt: '2026-04-15T07:30:00.000Z',
          actor: {
            handle: 'linus',
            displayName: 'Linus Torvalds',
          },
        },
      ],
      cursor: null,
      unreadCount: 2,
      errors: [],
    })

    renderNotificationsScreen()

    expect(await screen.findByText(/Grace Hopper/i)).toBeInTheDocument()
    expect(screen.getByText(/Linus Torvalds/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mentions' }))
    })

    expect(screen.getByText(/Grace Hopper/i)).toBeInTheDocument()
    expect(screen.queryByText(/Linus Torvalds/i)).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replies' }))
    })

    expect(screen.getByText(/Linus Torvalds/i)).toBeInTheDocument()
    expect(screen.queryByText(/Grace Hopper/i)).not.toBeInTheDocument()
  })

  it('shows a focused empty state when a tab has no matching notifications', async () => {
    mockNotificationRequests({
      data: [
        {
          id: 'notif-follow',
          eventType: 'follow',
          text: 'started following you.',
          read: false,
          createdAt: '2026-04-15T06:30:00.000Z',
          actor: {
            handle: 'sora',
            displayName: 'Sora',
          },
        },
      ],
      cursor: null,
      unreadCount: 1,
      errors: [],
    })

    renderNotificationsScreen()

    expect(
      await screen.findByRole('link', { name: 'Sora' }),
    ).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mentions' }))
    })

    expect(
      screen.getByRole('heading', { name: 'No mention notifications yet' }),
    ).toBeInTheDocument()
  })

  it('falls back to derived in-app links when targetUrl is not a safe relative path', async () => {
    mockNotificationRequests({
      data: [
        {
          id: 'notif-reaction',
          eventType: 'reaction',
          text: 'reacted to your post.',
          read: false,
          createdAt: '2026-04-15T06:30:00.000Z',
          targetUrl: 'javascript:alert(1)',
          postId: 'post-safe',
          actor: {
            handle: 'sora',
            displayName: 'Sora',
          },
        },
      ],
      cursor: null,
      unreadCount: 1,
      errors: [],
    })

    renderNotificationsScreen()

    expect(
      await screen.findByRole('link', { name: 'reacted to your post.' }),
    ).toHaveAttribute('href', '/p/post-safe')
  })
})
