import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildSearchHandler } from '../src/functions/search.js'
import type { SearchFilters, SearchStore } from '../src/lib/search.js'

class InMemorySearchStore implements SearchStore {
  async searchPosts(input: {
    query: string
    filters: SearchFilters
    limit: number
  }) {
    return {
      totalCount: 1,
      facets: {
        hashtags: [{ value: 'evals', count: 3 }],
        mediaKinds: [{ value: 'image', count: 2 }],
      },
      results: [
        {
          type: 'post' as const,
          id: 'post-1',
          kind: 'user' as const,
          authorHandle: input.filters.hashtag ? 'filtered' : 'ada',
          text: `Search results for ${input.query || 'everything'}`,
          hashtags: input.filters.hashtag ? [input.filters.hashtag] : ['evals'],
          mediaKinds: input.filters.mediaKind
            ? [input.filters.mediaKind]
            : ['image'],
          createdAt: '2026-04-15T10:00:00.000Z',
          likeCount: 8,
          replyCount: 2,
          githubEventType: null,
          githubRepo: null,
        },
      ],
    }
  }

  async searchUsers(input: { query: string; limit: number }) {
    return {
      totalCount: 1,
      results: [
        {
          type: 'user' as const,
          id: 'user-1',
          handle: 'ada',
          displayName: 'Ada Lovelace',
          bio: `Results for ${input.query}`,
          expertise: ['evals'],
          followerCount: 42,
        },
      ],
    }
  }

  async searchHashtags(input: {
    query: string
    filters: SearchFilters
    limit: number
  }) {
    return {
      totalCount: 1,
      results: [
        {
          type: 'hashtag' as const,
          hashtag: input.query.length > 0 ? input.query.toLowerCase() : 'evals',
          count: input.filters.mediaKind ? 1 : 4,
        },
      ],
    }
  }
}

function createRequest(query: Record<string, string> = {}): HttpRequest {
  const searchParams = new URLSearchParams(query)

  return {
    query: {
      get(name: string) {
        return searchParams.get(name)
      },
    },
  } as unknown as HttpRequest
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('searchHandler', () => {
  it('returns post results with parsed facet filters', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => new InMemorySearchStore(),
    })

    const response = await handler(
      createRequest({
        q: 'evals',
        type: 'posts',
        filter: 'hashtag:evals,mediaKind:image',
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        type: 'posts',
        query: 'evals',
        filters: {
          hashtag: 'evals',
          mediaKind: 'image',
        },
        totalCount: 1,
        facets: {
          hashtags: [{ value: 'evals', count: 3 }],
          mediaKinds: [{ value: 'image', count: 2 }],
        },
        results: [
          {
            type: 'post',
            id: 'post-1',
            kind: 'user',
            authorHandle: 'filtered',
            text: 'Search results for evals',
            hashtags: ['evals'],
            mediaKinds: ['image'],
            createdAt: '2026-04-15T10:00:00.000Z',
            likeCount: 8,
            replyCount: 2,
            githubEventType: null,
            githubRepo: null,
          },
        ],
      },
      errors: [],
    })
  })

  it('returns user results for the people tab', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => new InMemorySearchStore(),
    })

    const response = await handler(
      createRequest({
        q: 'ada',
        type: 'users',
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
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
            bio: 'Results for ada',
            expertise: ['evals'],
            followerCount: 42,
          },
        ],
      },
      errors: [],
    })
  })

  it('rejects invalid search types', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => new InMemorySearchStore(),
    })

    const response = await handler(
      createRequest({
        type: 'threads',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_search_type',
          message: 'The search type must be posts, users, or hashtags.',
          field: 'type',
        },
      ],
    })
  })

  it('rejects malformed facet filters', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => new InMemorySearchStore(),
    })

    const response = await handler(
      createRequest({
        filter: 'hashtag',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_search_filter',
          message: 'The search filter query parameter is malformed.',
          field: 'filter',
        },
      ],
    })
  })
})
