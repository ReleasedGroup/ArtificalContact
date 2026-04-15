import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminMetricsScreen } from './AdminMetricsScreen'
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

function createViewer(overrides?: Partial<MeProfile>): MeProfile {
  return {
    id: 'github:admin-1',
    identityProvider: 'github',
    identityProviderUserId: 'admin-1',
    email: 'admin@example.com',
    handle: 'platform-admin',
    displayName: 'Platform Admin',
    bio: 'Operating the production environment.',
    avatarUrl: null,
    bannerUrl: null,
    expertise: ['ops'],
    links: {},
    status: 'active',
    roles: ['admin', 'user'],
    counters: {
      posts: 4,
      followers: 12,
      following: 2,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

function renderAdminMetricsScreen(viewer = createViewer()) {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <AdminMetricsScreen viewer={viewer} />
    </QueryClientProvider>,
  )
}

describe('AdminMetricsScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads admin metrics and refetches when the range filter changes', async () => {
    mockFetch.mockImplementation(async (input) => {
      const request = String(input)
      const range = request.includes('range=30d') ? '30d' : '7d'

      return createJsonResponse(200, {
        data: {
          filters: {
            range,
            bucket: range === '30d' ? 'day' : 'day',
            startAt: '2026-03-17T00:00:00.000Z',
            endAt: '2026-04-16T00:00:00.000Z',
            generatedAt: '2026-04-15T12:00:00.000Z',
          },
          summary: {
            registrations: {
              value: range === '30d' ? 19 : 4,
              previousValue: 8,
              changePercent: 137.5,
            },
            activeUsers: {
              value: range === '30d' ? 42 : 11,
              previousValue: 18,
              changePercent: 133.3,
            },
            posts: {
              value: range === '30d' ? 73 : 14,
              previousValue: 31,
              changePercent: 135.5,
            },
            reports: {
              value: range === '30d' ? 9 : 2,
              previousValue: 4,
              changePercent: 125,
            },
            queueDepth: {
              value: range === '30d' ? 5 : 3,
              previousValue: 4,
              changePercent: -25,
            },
          },
          series: [
            {
              bucketStart: '2026-04-15T00:00:00.000Z',
              bucketEnd: '2026-04-16T00:00:00.000Z',
              registrations: range === '30d' ? 3 : 1,
              activeUsers: range === '30d' ? 8 : 4,
              posts: range === '30d' ? 9 : 3,
              reports: 1,
              queueDepth: range === '30d' ? 5 : 3,
            },
          ],
        },
        errors: [],
      })
    })

    renderAdminMetricsScreen()

    expect(
      await screen.findByRole('heading', { name: 'Platform metrics' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/metrics?range=7d',
        expect.objectContaining({
          headers: {
            Accept: 'application/json',
          },
        }),
      )
    })
    expect(await screen.findByText(/Bucketed by day/i)).toBeInTheDocument()
    expect(screen.getAllByText('11').length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/metrics?range=30d',
        expect.objectContaining({
          headers: {
            Accept: 'application/json',
          },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    })
  })

  it('shows the access gate for non-admin viewers', async () => {
    renderAdminMetricsScreen(
      createViewer({
        roles: ['user'],
      }),
    )

    expect(
      screen.getByRole('heading', {
        name: 'Your profile is not authorised for admin metrics.',
      }),
    ).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
