import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildSearchHandler } from '../src/functions/search.js'
import type {
  SearchPostResult,
  SearchQueryStore,
  SearchUserResult,
} from '../src/lib/search.js'

function createContext() {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
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

function createSearchStore(overrides: Partial<SearchQueryStore> = {}): SearchQueryStore {
  return {
    searchPosts: vi.fn(async () => [] as SearchPostResult[]),
    searchUsers: vi.fn(async () => [] as SearchUserResult[]),
    ...overrides,
  }
}

describe('searchHandler', () => {
  it('returns combined user and post results when type is omitted', async () => {
    const store = createSearchStore({
      searchPosts: vi.fn(async () => [
        {
          id: 'post-1',
          postId: 'post-1',
          authorHandle: 'ada',
          excerpt: 'Building robust agent search experiences.',
          createdAt: '2026-04-16T00:00:00.000Z',
          hashtags: ['search'],
          mediaKinds: [],
          kind: 'user',
        },
      ]),
      searchUsers: vi.fn(async () => [
        {
          id: 'user-1',
          handle: 'ada',
          displayName: 'Ada Lovelace',
          bio: 'Search engineer.',
          expertise: ['search'],
          followerCount: 42,
        },
      ]),
    })
    const handler = buildSearchHandler({
      storeFactory: () => store,
    })

    const response = await handler(
      createRequest({
        q: '  @ada  ',
      }),
      createContext(),
    )

    expect(store.searchPosts).toHaveBeenCalledWith({
      query: 'ada',
      limit: 4,
    })
    expect(store.searchUsers).toHaveBeenCalledWith({
      query: 'ada',
      limit: 4,
    })
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        query: '@ada',
        type: 'all',
        posts: [
          {
            id: 'post-1',
            postId: 'post-1',
            authorHandle: 'ada',
            excerpt: 'Building robust agent search experiences.',
            createdAt: '2026-04-16T00:00:00.000Z',
            hashtags: ['search'],
            mediaKinds: [],
            kind: 'user',
          },
        ],
        users: [
          {
            id: 'user-1',
            handle: 'ada',
            displayName: 'Ada Lovelace',
            bio: 'Search engineer.',
            expertise: ['search'],
            followerCount: 42,
          },
        ],
      },
      errors: [],
    })
  })

  it('supports narrowing the search to users only', async () => {
    const store = createSearchStore()
    const handler = buildSearchHandler({
      storeFactory: () => store,
    })

    const response = await handler(
      createRequest({
        q: 'ada',
        type: 'users',
        limit: '6',
      }),
      createContext(),
    )

    expect(store.searchUsers).toHaveBeenCalledWith({
      query: 'ada',
      limit: 6,
    })
    expect(store.searchPosts).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        query: 'ada',
        type: 'users',
        posts: [],
        users: [],
      },
      errors: [],
    })
  })

  it('starts user and post searches together when type is omitted', async () => {
    let resolvePosts: ((value: SearchPostResult[]) => void) | undefined
    let resolveUsers: ((value: SearchUserResult[]) => void) | undefined
    const postsPromise = new Promise<SearchPostResult[]>((resolve) => {
      resolvePosts = resolve
    })
    const usersPromise = new Promise<SearchUserResult[]>((resolve) => {
      resolveUsers = resolve
    })
    const store = createSearchStore({
      searchPosts: vi.fn(() => postsPromise),
      searchUsers: vi.fn(() => usersPromise),
    })
    const handler = buildSearchHandler({
      storeFactory: () => store,
    })

    const responsePromise = handler(
      createRequest({
        q: 'ada',
      }),
      createContext(),
    )

    expect(store.searchPosts).toHaveBeenCalledWith({
      query: 'ada',
      limit: 4,
    })
    expect(store.searchUsers).toHaveBeenCalledWith({
      query: 'ada',
      limit: 4,
    })

    resolvePosts?.([])
    resolveUsers?.([])

    const response = await responsePromise

    expect(response.status).toBe(200)
  })

  it('rejects queries shorter than two characters', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => createSearchStore(),
    })

    const response = await handler(
      createRequest({
        q: 'a',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'validation.search_query_too_short',
          message: 'Search queries must contain at least 2 characters.',
          field: 'q',
        },
      ],
    })
  })

  it('rejects unsupported search types', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => createSearchStore(),
    })

    const response = await handler(
      createRequest({
        q: 'ada',
        type: 'hashtags',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'validation.invalid_search_type',
          message: 'Search type must be one of all, posts, or users.',
          field: 'type',
        },
      ],
    })
  })

  it('returns a service unavailable response when search is not configured', async () => {
    const handler = buildSearchHandler({
      storeFactory: () => {
        throw new Error('SEARCH_ENDPOINT is missing.')
      },
    })

    const response = await handler(
      createRequest({
        q: 'ada',
      }),
      createContext(),
    )

    expect(response.status).toBe(503)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'search.unavailable',
          message: 'Search is not configured right now.',
        },
      ],
    })
  })
})
