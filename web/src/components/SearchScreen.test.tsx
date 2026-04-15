import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/query-client'
import { SearchScreen } from './SearchScreen'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function renderSearchScreen() {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <SearchScreen />
    </QueryClientProvider>,
  )
}

describe('SearchScreen', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/search?q=evals&type=posts')
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads post facets and narrows the result set when a facet is clicked', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = new URL(String(input), 'https://example.com')
      const filter = requestUrl.searchParams.get('filter')

      if (filter === 'hashtag:evals,mediaKind:image') {
        return createJsonResponse(200, {
          data: {
            type: 'posts',
            query: 'evals',
            filters: {
              hashtag: 'evals',
              mediaKind: 'image',
            },
            totalCount: 1,
            facets: {
              hashtags: [{ value: 'evals', count: 1 }],
              mediaKinds: [{ value: 'image', count: 1 }],
            },
            results: [
              {
                type: 'post',
                id: 'post-2',
                kind: 'user',
                authorHandle: 'ada',
                text: 'Filtered image result',
                hashtags: ['evals'],
                mediaKinds: ['image'],
                createdAt: '2026-04-15T00:00:00.000Z',
                likeCount: 4,
                replyCount: 1,
                githubEventType: null,
                githubRepo: null,
              },
            ],
          },
          errors: [],
        })
      }

      if (filter === 'hashtag:evals') {
        return createJsonResponse(200, {
          data: {
            type: 'posts',
            query: 'evals',
            filters: {
              hashtag: 'evals',
              mediaKind: null,
            },
            totalCount: 1,
            facets: {
              hashtags: [{ value: 'evals', count: 1 }],
              mediaKinds: [{ value: 'image', count: 1 }],
            },
            results: [
              {
                type: 'post',
                id: 'post-1',
                kind: 'user',
                authorHandle: 'ada',
                text: 'Filtered hashtag result',
                hashtags: ['evals'],
                mediaKinds: ['image'],
                createdAt: '2026-04-15T00:00:00.000Z',
                likeCount: 3,
                replyCount: 2,
                githubEventType: null,
                githubRepo: null,
              },
            ],
          },
          errors: [],
        })
      }

      return createJsonResponse(200, {
        data: {
          type: 'posts',
          query: 'evals',
          filters: {
            hashtag: null,
            mediaKind: null,
          },
          totalCount: 2,
          facets: {
            hashtags: [{ value: 'evals', count: 2 }],
            mediaKinds: [{ value: 'image', count: 1 }],
          },
          results: [
            {
              type: 'post',
              id: 'post-0',
              kind: 'user',
              authorHandle: 'ada',
              text: 'Unfiltered result',
              hashtags: ['evals'],
              mediaKinds: ['image'],
              createdAt: '2026-04-15T00:00:00.000Z',
              likeCount: 2,
              replyCount: 1,
              githubEventType: null,
              githubRepo: null,
            },
          ],
        },
        errors: [],
      })
    })

    renderSearchScreen()

    expect(await screen.findByText('Unfiltered result')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^#evals2$/i }))

    expect(
      await screen.findByText('Filtered hashtag result'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(window.location.search).toContain('hashtag=evals')
    })

    fireEvent.click(screen.getByRole('button', { name: /^image1$/i }))

    expect(await screen.findByText('Filtered image result')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/search?q=evals&type=posts&filter=hashtag%3Aevals%2CmediaKind%3Aimage',
        ),
        expect.any(Object),
      )
    })
  })

  it('switches to the people tab and renders user results', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = new URL(String(input), 'https://example.com')

      if (requestUrl.searchParams.get('type') === 'users') {
        return createJsonResponse(200, {
          data: {
            type: 'users',
            query: 'ada',
            filters: {
              hashtag: null,
              mediaKind: null,
            },
            totalCount: 1,
            results: [
              {
                type: 'user',
                id: 'user-1',
                handle: 'ada',
                displayName: 'Ada Lovelace',
                bio: 'Searches distributed systems and eval tooling.',
                expertise: ['evals'],
                followerCount: 42,
              },
            ],
          },
          errors: [],
        })
      }

      return createJsonResponse(200, {
        data: {
          type: 'posts',
          query: 'ada',
          filters: {
            hashtag: null,
            mediaKind: null,
          },
          totalCount: 0,
          facets: {
            hashtags: [],
            mediaKinds: [],
          },
          results: [],
        },
        errors: [],
      })
    })

    window.history.replaceState({}, '', '/search?q=ada&type=posts')
    renderSearchScreen()

    fireEvent.click(screen.getByRole('button', { name: 'People' }))

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('@ada')).toBeInTheDocument()
  })

  it('normalizes unsupported filters out of the route on load', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = new URL(String(input), 'https://example.com')

      expect(requestUrl.searchParams.get('type')).toBe('hashtags')
      expect(requestUrl.searchParams.get('filter')).toBe('mediaKind:image')

      return createJsonResponse(200, {
        data: {
          type: 'hashtags',
          query: 'evals',
          filters: {
            hashtag: null,
            mediaKind: 'image',
          },
          totalCount: 1,
          results: [{ type: 'hashtag', hashtag: 'evals', count: 1 }],
        },
        errors: [],
      })
    })

    window.history.replaceState(
      {},
      '',
      '/search?q=evals&type=hashtags&hashtag=evals&mediaKind=image',
    )
    renderSearchScreen()

    expect(await screen.findByText('#evals')).toBeInTheDocument()

    await waitFor(() => {
      expect(window.location.search).toBe('?q=evals&type=hashtags&mediaKind=image')
    })
  })

  it('scopes facet filters to tabs when switching result types', async () => {
    mockFetch.mockImplementation(async (input) => {
      const requestUrl = new URL(String(input), 'https://example.com')
      const type = requestUrl.searchParams.get('type')
      const filter = requestUrl.searchParams.get('filter')

      if (type === 'hashtags') {
        expect(filter).toBe('mediaKind:image')

        return createJsonResponse(200, {
          data: {
            type: 'hashtags',
            query: 'evals',
            filters: {
              hashtag: null,
              mediaKind: 'image',
            },
            totalCount: 1,
            results: [{ type: 'hashtag', hashtag: 'evals', count: 1 }],
          },
          errors: [],
        })
      }

      if (type === 'users') {
        expect(filter).toBeNull()

        return createJsonResponse(200, {
          data: {
            type: 'users',
            query: 'evals',
            filters: {
              hashtag: null,
              mediaKind: null,
            },
            totalCount: 1,
            results: [
              {
                type: 'user',
                id: 'user-1',
                handle: 'ada',
                displayName: 'Ada Lovelace',
                bio: 'Searches distributed systems and eval tooling.',
                expertise: ['evals'],
                followerCount: 42,
              },
            ],
          },
          errors: [],
        })
      }

      expect(filter).toBe('hashtag:evals,mediaKind:image')

      return createJsonResponse(200, {
        data: {
          type: 'posts',
          query: 'evals',
          filters: {
            hashtag: 'evals',
            mediaKind: 'image',
          },
          totalCount: 1,
          facets: {
            hashtags: [{ value: 'evals', count: 1 }],
            mediaKinds: [{ value: 'image', count: 1 }],
          },
          results: [
            {
              type: 'post',
              id: 'post-1',
              kind: 'user',
              authorHandle: 'ada',
              text: 'Facet scoped result',
              hashtags: ['evals'],
              mediaKinds: ['image'],
              createdAt: '2026-04-15T00:00:00.000Z',
              likeCount: 3,
              replyCount: 2,
              githubEventType: null,
              githubRepo: null,
            },
          ],
        },
        errors: [],
      })
    })

    window.history.replaceState(
      {},
      '',
      '/search?q=evals&type=posts&hashtag=evals&mediaKind=image',
    )
    renderSearchScreen()

    expect(await screen.findByText('Facet scoped result')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hashtags' }))

    expect(await screen.findByText('#evals')).toBeInTheDocument()

    await waitFor(() => {
      expect(window.location.search).toBe('?q=evals&type=hashtags&mediaKind=image')
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/search?q=evals&type=hashtags&filter=mediaKind%3Aimage',
        ),
        expect.any(Object),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'People' }))

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()

    await waitFor(() => {
      expect(window.location.search).toBe('?q=evals&type=users')
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/search?q=evals&type=users',
        expect.any(Object),
      )
    })
  })
})
