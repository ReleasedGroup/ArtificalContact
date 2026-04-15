import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createSuccessResponse,
} from '../lib/api-envelope.js'
import {
  querySearchIndex,
  resolveDefaultSearchFilter,
  SearchConfigurationError,
  SearchUpstreamError,
} from '../lib/search.js'

const PUBLIC_EXPLORE_ORDER_BY = ['createdAt desc']
const PUBLIC_EXPLORE_SCORING_PROFILE = 'recencyAndEngagement'
const DEFAULT_PUBLIC_EXPLORE_PAGE_SIZE = 20

export interface GetPublicFeedHandlerDependencies {
  search?: typeof querySearchIndex
}

export function buildGetPublicFeedHandler(
  dependencies: GetPublicFeedHandlerDependencies = {},
) {
  const search = dependencies.search ?? querySearchIndex

  return async function getPublicFeedHandler(
    _request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    try {
      const filter = resolveDefaultSearchFilter('posts')
      const query = {
        type: 'posts',
        orderBy: PUBLIC_EXPLORE_ORDER_BY,
        scoringProfile: PUBLIC_EXPLORE_SCORING_PROFILE,
        top: DEFAULT_PUBLIC_EXPLORE_PAGE_SIZE,
        ...(filter === undefined ? {} : { filter }),
      } satisfies Parameters<typeof search>[0]

      const results = await search(query)

      context.log('Public explore feed lookup completed.', {
        resultCount:
          typeof results['@odata.count'] === 'number'
            ? results['@odata.count']
            : null,
      })

      return createSuccessResponse(results)
    } catch (error) {
      if (error instanceof SearchConfigurationError) {
        return createErrorResponse(503, {
          code: 'search_unconfigured',
          message: error.message,
        })
      }
      if (error instanceof SearchUpstreamError) {
        return createErrorResponse(502, {
          code: 'search_upstream_failed',
          message: error.message,
        })
      }

      context.log('Public explore feed lookup failed unexpectedly.', {
        error: error instanceof Error ? error.message : 'Unknown search error.',
      })

      return createErrorResponse(500, {
        code: 'server.explore_feed_failed',
        message: 'Unable to load the public explore feed at this time.',
      })
    }
  }
}

export const getPublicFeedHandler = buildGetPublicFeedHandler()

export function registerGetPublicFeedFunction() {
  app.http('getPublicFeed', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'explore',
    handler: getPublicFeedHandler,
  })
}
