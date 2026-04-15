import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetPublicFeedHandler } from '../src/functions/get-public-feed.js'
import {
  SearchConfigurationError,
  SearchUpstreamError,
} from '../src/lib/search.js'

function createContext() {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createRequest(): HttpRequest {
  return {
    query: {
      get: () => null,
    },
  } as unknown as HttpRequest
}

describe('getPublicFeedHandler', () => {
  it('proxies GET /api/explore requests to public posts search with recency ordering', async () => {
    const search = vi.fn(async () => ({
      '@odata.count': 1,
      value: [{ id: 'post-1' }],
    }))
    const handler = buildGetPublicFeedHandler({ search })

    const response = await handler(createRequest(), createContext())

    expect(search).toHaveBeenCalledWith({
      type: 'posts',
      filter: "visibility eq 'public' and moderationState eq 'ok'",
      orderBy: ['createdAt desc'],
      scoringProfile: 'recencyAndEngagement',
      top: 20,
    })
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        '@odata.count': 1,
        value: [{ id: 'post-1' }],
      },
      errors: [],
    })
  })

  it('returns 503 when search infrastructure is not configured', async () => {
    const handler = buildGetPublicFeedHandler({
      search: vi.fn(async () => {
        throw new SearchConfigurationError('Search endpoint missing')
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(503)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'search_unconfigured',
          message: 'Search endpoint missing',
        },
      ],
    })
  })

  it('returns a sanitized 502 when AI Search responds with an upstream error', async () => {
    const handler = buildGetPublicFeedHandler({
      search: vi.fn(async () => {
        throw new SearchUpstreamError(
          'Search index query failed with status 502.',
          502,
        )
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(502)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'search_upstream_failed',
          message: 'Search index query failed with status 502.',
        },
      ],
    })
  })

  it('returns 500 for unexpected failures', async () => {
    const handler = buildGetPublicFeedHandler({
      search: vi.fn(async () => {
        throw new Error('boom')
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.explore_feed_failed',
          message: 'Unable to load the public explore feed at this time.',
        },
      ],
    })
  })
})
