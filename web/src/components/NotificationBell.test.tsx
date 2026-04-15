import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  NotificationBell,
} from './NotificationBell'
import { createQueryClient } from '../lib/query-client'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function renderNotificationBell() {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  )
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-04-15T10:10:00.000Z').valueOf(),
    )
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the unread badge and renders notification details from the API payload', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'notification-1',
            eventType: 'reply',
            actor: {
              id: 'github:actor-1',
              handle: 'grace',
              displayName: 'Grace Hopper',
              avatarUrl: null,
            },
            text: 'replied to your post in #evals.',
            read: false,
            createdAt: '2026-04-15T09:50:00.000Z',
            postId: 'post-1',
          },
        ],
        unreadCount: 2,
        cursor: null,
        errors: [],
      }),
    )

    renderNotificationBell()

    const button = await screen.findByRole('button', {
      name: 'Notifications, 2 unread',
    })
    expect(button).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(NOTIFICATION_POLL_INTERVAL_MS).toBe(30_000)

    fireEvent.click(button)

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
    expect(
      screen.getByText('replied to your post in #evals.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/ago/i)).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/notifications',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    )
  })
})
