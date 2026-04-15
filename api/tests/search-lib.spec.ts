import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  querySearchIndex,
  resolveDefaultSearchFilter,
  SearchConfigurationError,
  SearchFilterValidationError,
  SearchUpstreamError,
} from '../src/lib/search.js'

const originalEnv = { ...process.env }

function createAsyncResults(documents: Record<string, unknown>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const document of documents) {
        yield { document }
      }
    },
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('resolveDefaultSearchFilter', () => {
  it('adds public/ok constraints for posts', () => {
    expect(resolveDefaultSearchFilter('posts')).toBe(
      "visibility eq 'public' and moderationState eq 'ok'",
    )
    expect(resolveDefaultSearchFilter('posts', "authorId eq 'user-1'")).toBe(
      "visibility eq 'public' and moderationState eq 'ok' and (authorId eq 'user-1')",
    )
  })

  it('does not inject constraints for user search types', () => {
    expect(resolveDefaultSearchFilter('users', "handle eq 'ada'")).toBe(
      "handle eq 'ada'",
    )
  })

  it('rejects filters that try to add grouping characters', () => {
    expect(() =>
      resolveDefaultSearchFilter(
        'posts',
        "authorHandle eq 'ada') or visibility eq 'private'",
      ),
    ).toThrow(SearchFilterValidationError)
  })
})

describe('querySearchIndex', () => {
  it('queries the selected index and returns normalized documents', async () => {
    process.env.SEARCH_INDEX_POSTS_NAME = 'posts-v1'
    process.env.SEARCH_INDEX_USERS_NAME = 'users-v1'
    process.env.SEARCH_INDEX_HASHTAGS_NAME = 'hashtags-v1'

    const search = vi.fn(async () => ({
      count: 1,
      results: createAsyncResults([{ id: 'post-1' }]),
    }))
    const clientFactory = vi.fn(() => ({ search }))

    const result = await querySearchIndex(
      {
        type: 'posts',
        q: 'demo',
        filter: "authorHandle eq 'ada'",
      },
      clientFactory,
    )

    expect(clientFactory).toHaveBeenCalledWith('posts-v1')
    expect(search).toHaveBeenCalledWith('demo', {
      filter: "authorHandle eq 'ada'",
      includeTotalCount: true,
    })
    expect(result).toEqual({
      '@odata.count': 1,
      value: [{ id: 'post-1' }],
    })
  })

  it('falls back to a wildcard search when no query is provided', async () => {
    process.env.SEARCH_INDEX_POSTS_NAME = 'posts-v1'
    process.env.SEARCH_INDEX_USERS_NAME = 'users-v1'
    process.env.SEARCH_INDEX_HASHTAGS_NAME = 'hashtags-v1'

    const search = vi.fn(async () => ({
      results: createAsyncResults([]),
    }))

    await querySearchIndex(
      {
        type: 'users',
      },
      () => ({ search }),
    )

    expect(search).toHaveBeenCalledWith('*', {
      includeTotalCount: true,
    })
  })

  it('raises a configuration error when the search endpoint is unavailable', async () => {
    process.env.SEARCH_ENDPOINT = ''

    await expect(querySearchIndex({ type: 'posts' })).rejects.toBeInstanceOf(
      SearchConfigurationError,
    )
  })

  it('logs upstream failures without exposing the raw provider message', async () => {
    process.env.SEARCH_INDEX_POSTS_NAME = 'posts-v1'
    process.env.SEARCH_INDEX_USERS_NAME = 'users-v1'
    process.env.SEARCH_INDEX_HASHTAGS_NAME = 'hashtags-v1'

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const search = vi.fn(async () => {
      const error = new Error('sensitive upstream detail')
      Object.assign(error, { statusCode: 503 })
      throw error
    })

    await expect(
      querySearchIndex({ type: 'posts', q: 'demo' }, () => ({ search })),
    ).rejects.toEqual(new SearchUpstreamError('Search index query failed with status 503.', 503))

    expect(consoleError).toHaveBeenCalledWith(
      'Search index query failed.',
      expect.objectContaining({
        indexName: 'posts-v1',
        status: 503,
        error: 'sensitive upstream detail',
      }),
    )
  })
})
