import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createJsonEnvelopeResponse,
} from '../lib/api-envelope.js'
import { AzureSearchQueryStore } from '../lib/azure-search-query-store.js'
import { searchSite, type SearchStore } from '../lib/search.js'
import { withHttpAuth } from '../lib/http-auth.js'

export interface SearchHandlerDependencies {
  storeFactory?: () => SearchStore
}

let cachedStore: AzureSearchQueryStore | undefined

function getStore(): AzureSearchQueryStore {
  cachedStore ??= AzureSearchQueryStore.fromEnvironment()
  return cachedStore
}

export function buildSearchHandler(
  dependencies: SearchHandlerDependencies = {},
) {
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function searchHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let store: SearchStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the search query store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown search configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'Search is not configured right now.',
      })
    }

    try {
      const result = await searchSite(
        {
          q: request.query.get('q'),
          type: request.query.get('type'),
          filter: request.query.get('filter'),
        },
        store,
      )

      context.log('Search query completed.', {
        query: request.query.get('q') ?? '',
        type: request.query.get('type') ?? 'posts',
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Search query failed unexpectedly.', {
        error: error instanceof Error ? error.message : 'Unknown search error.',
      })

      return createErrorResponse(500, {
        code: 'server.search_failed',
        message: 'Unable to complete the search query right now.',
      })
    }
  }
}

export const searchHandler = withHttpAuth(buildSearchHandler(), {
  allowAnonymous: true,
})

export function registerSearchFunction() {
  app.http('search', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'search',
    handler: searchHandler,
  })
}
