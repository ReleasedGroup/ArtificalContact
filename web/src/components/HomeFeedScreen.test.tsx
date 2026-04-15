import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeFeedScreen } from './HomeFeedScreen'
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

function createFeedEntry(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    postId: `post-${id}`,
    authorId: `author-${id}`,
    authorHandle: `author-${id}`,
    authorDisplayName: `Author ${id}`,
    authorAvatarUrl: null,
    excerpt: `Excerpt ${id}`,
    media: [],
    counters: {
      likes: 3,
      replies: 1,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  callback: IntersectionObserverCallback
  observedElements: Element[] = []

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  disconnect() {}

  observe(element: Element) {
    this.observedElements.push(element)
  }

  unobserve() {}

  trigger(isIntersecting: boolean) {
    this.callback(
      this.observedElements.map((target) => ({
        isIntersecting,
        target,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: target.getBoundingClientRect(),
        isVisible: isIntersecting,
        rootBounds: null,
        time: 0,
      })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    )
  }

  static reset() {
    MockIntersectionObserver.instances = []
  }
}

function renderHomeFeedScreen(viewer = createViewer()) {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <HomeFeedScreen viewer={viewer} />
    </QueryClientProvider>,
  )
}

describe('HomeFeedScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    MockIntersectionObserver.reset()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal(
      'IntersectionObserver',
      MockIntersectionObserver as unknown as typeof IntersectionObserver,
    )
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (window as Window & { IntersectionObserver?: unknown })
      .IntersectionObserver
  })

  it('loads additional feed pages when the infinite-scroll sentinel intersects', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = String(input)

      if (requestUrl === '/api/notifications') {
        return createJsonResponse(200, {
          data: [],
          unreadCount: 0,
          cursor: null,
          errors: [],
        })
      }

      if (requestUrl === '/api/feed') {
        return createJsonResponse(200, {
          data: [createFeedEntry('one', { excerpt: 'First page entry' })],
          cursor: 'cursor-2',
          errors: [],
        })
      }

      if (requestUrl === '/api/feed?cursor=cursor-2') {
        return createJsonResponse(200, {
          data: [createFeedEntry('two', { excerpt: 'Second page entry' })],
          cursor: null,
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`)
    })

    renderHomeFeedScreen()

    expect(await screen.findByText('First page entry')).toBeInTheDocument()

    await waitFor(() => {
      expect(MockIntersectionObserver.instances).toHaveLength(1)
    })

    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true)
    })

    expect(await screen.findByText('Second page entry')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/feed?cursor=cursor-2',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    )
  })

  it('refetches the feed when the user performs a pull-to-refresh gesture', async () => {
    let feedRequestCount = 0

    mockFetch.mockImplementation(async (input) => {
      const requestUrl = String(input)

      if (requestUrl === '/api/notifications') {
        return createJsonResponse(200, {
          data: [],
          unreadCount: 0,
          cursor: null,
          errors: [],
        })
      }

      if (requestUrl === '/api/feed') {
        feedRequestCount += 1

        return createJsonResponse(200, {
          data: [
            createFeedEntry('one', {
              excerpt:
                feedRequestCount === 1
                  ? 'Original feed entry'
                  : 'Refreshed feed entry',
            }),
          ],
          cursor: null,
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`)
    })

    renderHomeFeedScreen()

    expect(await screen.findByText('Original feed entry')).toBeInTheDocument()

    const scrollRegion = screen.getByTestId('home-feed-scroll-region')
    Object.defineProperty(scrollRegion, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    })

    await act(async () => {
      fireEvent.touchStart(scrollRegion, {
        touches: [{ clientY: 100 }],
      })
      fireEvent.touchMove(scrollRegion, {
        cancelable: true,
        touches: [{ clientY: 320 }],
      })
      fireEvent.touchEnd(scrollRegion, {
        changedTouches: [{ clientY: 320 }],
      })
    })

    expect(await screen.findByText('Refreshed feed entry')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  it('lets the viewer report a feed post from the in-product dialog', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const requestUrl = String(input)

      if (requestUrl === '/api/feed') {
        return createJsonResponse(200, {
          data: [
            createFeedEntry('one', {
              postId: 'post-one',
              authorId: 'github:target-1',
              authorHandle: 'grace',
              authorDisplayName: 'Grace Hopper',
              excerpt: 'First page entry',
            }),
          ],
          cursor: null,
          errors: [],
        })
      }

      if (requestUrl === '/api/reports') {
        expect(init).toMatchObject({
          method: 'POST',
        })
        expect(JSON.parse(String(init?.body ?? '{}'))).toEqual({
          targetType: 'post',
          targetId: 'post-one',
          targetProfileHandle: 'grace',
          reasonCode: 'spam',
          details: null,
        })

        return createJsonResponse(201, {
          data: {
            report: {
              id: 'report-feed-post',
              status: 'open',
              targetType: 'post',
              targetId: 'post-one',
              reasonCode: 'spam',
              createdAt: '2026-04-16T08:00:00.000Z',
            },
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`)
    })

    renderHomeFeedScreen()

    expect(await screen.findByText('First page entry')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Report post' }))
    expect(
      await screen.findByRole('dialog', { name: 'Report this post' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    expect(await screen.findByText('Post report submitted.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('hides the report action when the viewer cannot create reports', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = String(input)

      if (requestUrl === '/api/feed') {
        return createJsonResponse(200, {
          data: [
            createFeedEntry('one', {
              postId: 'post-one',
              authorId: 'github:target-1',
              authorHandle: 'grace',
              authorDisplayName: 'Grace Hopper',
              excerpt: 'First page entry',
            }),
          ],
          cursor: null,
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`)
    })

    renderHomeFeedScreen(
      createViewer({
        status: 'pending',
        handle: null,
      }),
    )

    expect(await screen.findByText('First page entry')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Report post' }),
    ).not.toBeInTheDocument()
  })
})
