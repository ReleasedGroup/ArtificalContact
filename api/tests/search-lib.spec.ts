import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchSite, type SearchStore } from '../src/lib/search.js'

function createSearchStore(): SearchStore {
  return {
    searchPosts: vi.fn(
      async ({
        query,
        filters,
        limit,
      }: Parameters<SearchStore['searchPosts']>[0]) => ({
        totalCount: 1,
        facets: {
          hashtags: filters.hashtag
            ? [{ value: filters.hashtag, count: 1 }]
            : [],
          mediaKinds: filters.mediaKind
            ? [{ value: filters.mediaKind, count: 1 }]
            : [],
        },
        results: [
          {
            type: 'post' as const,
            id: 'post-1',
            kind: 'user' as const,
            authorHandle: 'ada',
            text: query || 'all posts',
            hashtags: filters.hashtag ? [filters.hashtag] : ['evals'],
            mediaKinds: filters.mediaKind ? [filters.mediaKind] : [],
            createdAt: '2026-04-15T00:00:00.000Z',
            likeCount: limit,
            replyCount: 2,
            githubEventType: null,
            githubRepo: null,
          },
        ],
      }),
    ),
    searchUsers: vi.fn(
      async ({ query, limit }: Parameters<SearchStore['searchUsers']>[0]) => ({
        totalCount: 1,
        results: [
          {
            type: 'user' as const,
            id: 'user-1',
            handle: 'ada',
            displayName: 'Ada Lovelace',
            bio: `${query}:${limit}`,
            expertise: ['evals'],
            followerCount: 42,
          },
        ],
      }),
    ),
    searchHashtags: vi.fn(
      async ({
        query,
        filters,
        limit,
      }: Parameters<SearchStore['searchHashtags']>[0]) => ({
        totalCount: 1,
        results: [
          {
            type: 'hashtag' as const,
            hashtag: query.length > 0 ? query.toLowerCase() : 'evals',
            count: filters.mediaKind ? limit - 19 : limit,
          },
        ],
      }),
    ),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('searchSite', () => {
  it('defaults to posts search and trims the query string', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        q: '  ada  ',
      },
      store,
    )

    expect(store.searchPosts).toHaveBeenCalledWith({
      query: 'ada',
      filters: {
        hashtag: null,
        mediaKind: null,
      },
      limit: 20,
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          type: 'posts',
          query: 'ada',
          filters: {
            hashtag: null,
            mediaKind: null,
          },
          totalCount: 1,
          facets: {
            hashtags: [],
            mediaKinds: [],
          },
          results: [
            {
              type: 'post',
              id: 'post-1',
              kind: 'user',
              authorHandle: 'ada',
              text: 'ada',
              hashtags: ['evals'],
              mediaKinds: [],
              createdAt: '2026-04-15T00:00:00.000Z',
              likeCount: 20,
              replyCount: 2,
              githubEventType: null,
              githubRepo: null,
            },
          ],
        },
        errors: [],
      },
    })
  })

  it('normalizes facet filters before dispatching posts search', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        q: 'evals',
        type: 'posts',
        filter: 'hashtag:#Evals,mediaKind:IMAGE',
      },
      store,
    )

    expect(store.searchPosts).toHaveBeenCalledWith({
      query: 'evals',
      filters: {
        hashtag: 'evals',
        mediaKind: 'image',
      },
      limit: 20,
    })
    expect(result.body.data).toMatchObject({
      type: 'posts',
      query: 'evals',
      filters: {
        hashtag: 'evals',
        mediaKind: 'image',
      },
    })
  })

  it('routes people searches through the user store', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        q: 'Ada',
        type: 'users',
        filter: 'hashtag:evals',
      },
      store,
    )

    expect(store.searchUsers).toHaveBeenCalledWith({
      query: 'Ada',
      limit: 20,
    })
    expect(store.searchPosts).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          type: 'users',
          query: 'Ada',
          filters: {
            hashtag: 'evals',
            mediaKind: null,
          },
          totalCount: 1,
          results: [
            {
              type: 'user',
              id: 'user-1',
              handle: 'ada',
              displayName: 'Ada Lovelace',
              bio: 'Ada:20',
              expertise: ['evals'],
              followerCount: 42,
            },
          ],
        },
        errors: [],
      },
    })
  })

  it('passes media kind filters through hashtag searches', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        q: 'Evals',
        type: 'hashtags',
        filter: 'mediaKind:video',
      },
      store,
    )

    expect(store.searchHashtags).toHaveBeenCalledWith({
      query: 'Evals',
      filters: {
        hashtag: null,
        mediaKind: 'video',
      },
      limit: 20,
    })
    expect(result.body.data).toEqual({
      type: 'hashtags',
      query: 'Evals',
      filters: {
        hashtag: null,
        mediaKind: 'video',
      },
      totalCount: 1,
      results: [
        {
          type: 'hashtag',
          hashtag: 'evals',
          count: 1,
        },
      ],
    })
  })

  it('rejects unsupported search types before touching the store', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        type: 'threads',
      },
      store,
    )

    expect(store.searchPosts).not.toHaveBeenCalled()
    expect(store.searchUsers).not.toHaveBeenCalled()
    expect(store.searchHashtags).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_search_type',
            message: 'The search type must be posts, users, or hashtags.',
            field: 'type',
          },
        ],
      },
    })
  })

  it('rejects malformed facet filters before dispatching search', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        filter: 'hashtag',
      },
      store,
    )

    expect(store.searchPosts).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_search_filter',
            message: 'The search filter query parameter is malformed.',
            field: 'filter',
          },
        ],
      },
    })
  })

  it('rejects unsupported facet keys', async () => {
    const store = createSearchStore()

    const result = await searchSite(
      {
        filter: 'repo:ReleasedGroup/ArtificalContact',
      },
      store,
    )

    expect(store.searchPosts).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_search_filter',
            message: 'Unsupported search filter "repo".',
            field: 'filter',
          },
        ],
      },
    })
  })
})
