import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildSearchHandler } from '../src/functions/search.js'
import {
  SearchConfigurationError,
  SearchUpstreamError,
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
      get: (name: string) => searchParams.get(name),
    },
  } as unknown as HttpRequest
}

describe('searchHandler', () => {
  it('proxies GET /api/search requests to posts search with enforced defaults', async () => {
    const search = vi.fn(async () => ({ value: [{ id: 'post-1' }] }))
    const handler = buildSearchHandler({ search })

    const response = await handler(
      createRequest({ q: 'azure', type: 'posts' }),
      createContext(),
    )

    expect(search).toHaveBeenCalledWith({
      q: 'azure',
      type: 'posts',
      filter: "visibility eq 'public' and moderationState eq 'ok'",
    })
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: { value: [{ id: 'post-1' }] },
      errors: [],
    })
  })

  it('combines user-provided filters with permission filters for posts', async () => {
    const search = vi.fn(async () => ({ value: [] }))
    const handler = buildSearchHandler({ search })

    await handler(
      createRequest({
        q: 'open source',
        type: 'posts',
        filter: "authorHandle eq 'ada' and githubRepo eq 'ReleasedGroup/ArtificalContact'",
      }),
      createContext(),
    )

    expect(search).toHaveBeenCalledWith({
      q: 'open source',
      type: 'posts',
      filter:
        "visibility eq 'public' and moderationState eq 'ok' and (authorHandle eq 'ada' and githubRepo eq 'ReleasedGroup/ArtificalContact')",
    })
  })

  it('passes through user-provided filters for non-post types', async () => {
    const search = vi.fn(async () => ({ value: [] }))
    const handler = buildSearchHandler({ search })

    await handler(
      createRequest({
        q: 'release',
        type: 'users',
        filter: "handle eq 'ada'",
      }),
      createContext(),
    )

    expect(search).toHaveBeenCalledWith({
      q: 'release',
      type: 'users',
      filter: "handle eq 'ada'",
    })
  })

  it('defaults to posts search when type is omitted', async () => {
    const search = vi.fn(async () => ({ value: [] }))
    const handler = buildSearchHandler({ search })

    await handler(createRequest({ q: 'default-type' }), createContext())

    expect(search).toHaveBeenCalledWith({
      q: 'default-type',
      type: 'posts',
      filter: "visibility eq 'public' and moderationState eq 'ok'",
    })
  })

  it('rejects unsupported search types', async () => {
    const handler = buildSearchHandler({ search: vi.fn() })

    const response = await handler(
      createRequest({ type: 'invalid' }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_search_type',
          message: 'The type query parameter must be one of: posts, users, hashtags.',
          field: 'type',
        },
      ],
    })
  })

  it('rejects unsupported search filters before querying the index', async () => {
    const search = vi.fn()
    const handler = buildSearchHandler({ search })

    const response = await handler(
      createRequest({
        type: 'posts',
        filter: "authorHandle eq 'ada') or visibility eq 'private'",
      }),
      createContext(),
    )

    expect(search).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_search_filter',
          message:
            'The filter query parameter only supports flat expressions without grouping characters.',
          field: 'filter',
        },
      ],
    })
  })

  it('returns 503 when search infrastructure is not configured', async () => {
    const handler = buildSearchHandler({
      search: vi.fn(async () => {
        throw new SearchConfigurationError('Search endpoint missing')
      }),
    })

    const response = await handler(createRequest({}), createContext())

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
    const handler = buildSearchHandler({
      search: vi.fn(async () => {
        throw new SearchUpstreamError('Search index query failed with status 502.', 502)
      }),
    })

    const response = await handler(createRequest({}), createContext())

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
})
