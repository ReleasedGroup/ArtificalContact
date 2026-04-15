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
    delete (window as Window & { IntersectionObserver?: unknown }).IntersectionObserver
  })

  it('loads additional feed pages when the infinite-scroll sentinel intersects', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = String(input)

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
    mockFetch
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          data: [createFeedEntry('one', { excerpt: 'Original feed entry' })],
          cursor: null,
          errors: [],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          data: [createFeedEntry('one', { excerpt: 'Refreshed feed entry' })],
          cursor: null,
          errors: [],
        }),
      )

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
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
