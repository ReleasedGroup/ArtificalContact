import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPushCard } from './BrowserPushCard'
import { createQueryClient } from '../lib/query-client'
import type { NotificationPreferences } from '../lib/notification-preferences'

const mocks = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  getBrowserPushSupport: vi.fn(),
  subscribeToBrowserPush: vi.fn(),
  unsubscribeFromBrowserPush: vi.fn(),
}))

vi.mock('../lib/notification-preferences', () => ({
  getNotificationPreferences: mocks.getNotificationPreferences,
  updateNotificationPreferences: mocks.updateNotificationPreferences,
}))

vi.mock('../lib/web-push', () => ({
  getBrowserPushSupport: mocks.getBrowserPushSupport,
  subscribeToBrowserPush: mocks.subscribeToBrowserPush,
  unsubscribeFromBrowserPush: mocks.unsubscribeFromBrowserPush,
}))

function createPreferences(
  overrides?: Partial<NotificationPreferences>,
): NotificationPreferences {
  return {
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
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  }
}

function renderBrowserPushCard() {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <BrowserPushCard />
    </QueryClientProvider>,
  )
}

describe('BrowserPushCard', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_WEB_PUSH_PUBLIC_KEY', 'AQAB')
    mocks.getNotificationPreferences.mockReset()
    mocks.updateNotificationPreferences.mockReset()
    mocks.getBrowserPushSupport.mockReset()
    mocks.subscribeToBrowserPush.mockReset()
    mocks.unsubscribeFromBrowserPush.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('suppresses the action buttons on unsupported browsers', async () => {
    mocks.getBrowserPushSupport.mockReturnValue({
      available: false,
      canManageSubscription: false,
      permission: 'unsupported',
      reason: 'unsupported_browser',
    })
    mocks.getNotificationPreferences.mockResolvedValue(createPreferences())

    renderBrowserPushCard()

    expect(
      await screen.findByText(/Browser push stays suppressed/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Enable browser push' }),
    ).not.toBeInTheDocument()
  })

  it('stores the new VAPID subscription when the user enables browser push', async () => {
    mocks.getBrowserPushSupport.mockReturnValue({
      available: true,
      canManageSubscription: true,
      permission: 'default',
      reason: 'supported',
    })
    mocks.getNotificationPreferences.mockResolvedValue(createPreferences())
    mocks.subscribeToBrowserPush.mockResolvedValue({
      endpoint: 'https://push.example.com/subscriptions/123',
      expirationTime: null,
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      },
    })
    mocks.updateNotificationPreferences.mockResolvedValue(
      createPreferences({
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
      }),
    )

    renderBrowserPushCard()

    const enableButton = await screen.findByRole('button', {
      name: 'Enable browser push',
    })

    await waitFor(() => {
      expect(enableButton).not.toBeDisabled()
    })

    await act(async () => {
      fireEvent.click(enableButton)
    })

    expect(mocks.subscribeToBrowserPush).toHaveBeenCalledTimes(1)
    expect(mocks.updateNotificationPreferences).toHaveBeenCalledWith({
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
    })
    expect(
      await screen.findByText(/Browser push is enabled for this account/i),
    ).toBeInTheDocument()
  })
})
