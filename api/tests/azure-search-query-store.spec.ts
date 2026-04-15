import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AzureSearchQueryStore } from '../src/lib/azure-search-query-store.js'
import { runWithRequestMetricsContext } from '../src/lib/request-metrics-context.js'
import { trackSearchQueryDuration } from '../src/lib/telemetry.js'

vi.mock('../src/lib/telemetry.js', () => ({
  trackSearchQueryDuration: vi.fn(),
}))

function createSearchResponse<TDocument extends object>(
  documents: TDocument[],
  options: {
    count?: number
    facets?: Record<string, Array<{ value: string; count: number }>>
  } = {},
) {
  return {
    count: options.count,
    facets: options.facets,
    async *results() {
      for (const document of documents) {
        yield { document }
      }
    },
  }
}

function createIterableSearchResponse<TDocument extends object>(
  documents: TDocument[],
  options: {
    count?: number
    facets?: Record<string, Array<{ value: string; count: number }>>
  } = {},
) {
  const response = createSearchResponse(documents, options)

  return {
    count: response.count,
    facets: response.facets,
    results: response.results(),
  }
}

describe('AzureSearchQueryStore', () => {
  beforeEach(() => {
    vi.mocked(trackSearchQueryDuration).mockReset()
  })

  it('tracks post-search latency with the active endpoint context', async () => {
    const postsClient = {
      search: vi.fn().mockResolvedValue(
        createIterableSearchResponse(
          [
            {
              id: 'post-1',
              kind: 'user',
              authorHandle: 'ada',
              text: 'Instrumented search result',
              hashtags: ['evals'],
              mediaKinds: ['image'],
              createdAt: '2026-04-16T03:10:00.000Z',
              likeCount: 4,
              replyCount: 1,
            },
          ],
          {
            count: 1,
            facets: {
              hashtags: [{ value: 'evals', count: 1 }],
              mediaKinds: [{ value: 'image', count: 1 }],
            },
          },
        ),
      ),
    }
    const usersClient = {
      search: vi.fn(),
    }

    const store = new AzureSearchQueryStore(
      postsClient as never,
      usersClient as never,
    )

    const result = await runWithRequestMetricsContext('search', () =>
      store.searchPosts({
        query: 'evals',
        filters: {
          hashtag: null,
          mediaKind: null,
        },
        limit: 10,
      }),
    )

    expect(result.totalCount).toBe(1)
    expect(trackSearchQueryDuration).toHaveBeenCalledTimes(1)
    expect(trackSearchQueryDuration).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        endpoint: 'search',
        searchType: 'posts',
      }),
    )
  })
})
