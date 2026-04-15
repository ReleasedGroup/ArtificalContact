import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { createErrorResponse, createSuccessResponse } from '../lib/api-envelope.js'
import {
  querySearchIndex,
  resolveDefaultSearchFilter,
  SearchConfigurationError,
  SearchFilterValidationError,
  SearchUpstreamError,
  type SearchType,
} from '../lib/search.js'

export interface SearchHandlerDependencies {
  search?: (
    input: {
      q?: string
      type: SearchType
      filter?: string
    },
  ) => Promise<unknown>
}

function normalizeSearchType(value: string | null): SearchType {
  switch (value?.trim().toLowerCase()) {
    case 'users':
      return 'users'
    case 'hashtags':
      return 'hashtags'
    case 'posts':
    case '':
    case null:
    case undefined:
      return 'posts'
    default:
      throw new Error('invalid_search_type')
  }
}

function createInvalidSearchTypeResponse(): HttpResponseInit {
  return createErrorResponse(400, {
    code: 'invalid_search_type',
    message: 'The type query parameter must be one of: posts, users, hashtags.',
    field: 'type',
  })
}

function createInvalidSearchFilterResponse(message: string): HttpResponseInit {
  return createErrorResponse(400, {
    code: 'invalid_search_filter',
    message,
    field: 'filter',
  })
}

export function buildSearchHandler(dependencies: SearchHandlerDependencies = {}) {
  const search = dependencies.search ?? querySearchIndex

  return async function searchHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let type: SearchType
    try {
      type = normalizeSearchType(request.query.get('type'))
    } catch {
      return createInvalidSearchTypeResponse()
    }

    const query = request.query.get('q')
    const rawFilter = request.query.get('filter') ?? undefined

    let resolvedFilter: string | undefined
    try {
      resolvedFilter = resolveDefaultSearchFilter(type, rawFilter)
    } catch (error) {
      if (error instanceof SearchFilterValidationError) {
        return createInvalidSearchFilterResponse(error.message)
      }

      throw error
    }

    try {
      const queryPayload: { type: SearchType; q?: string; filter?: string } = {
        type,
      }
      if (query !== null) {
        queryPayload.q = query
      }
      if (resolvedFilter !== undefined) {
        queryPayload.filter = resolvedFilter
      }

      const results = await search(queryPayload)

      context.log('Search lookup completed.', {
        type,
        query: query ?? null,
        filterProvided: rawFilter ?? null,
        filterApplied: resolvedFilter ?? null,
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

      context.log('Search lookup failed unexpectedly.', {
        error: error instanceof Error ? error.message : 'Unknown search error.',
      })

      return createErrorResponse(500, {
        code: 'server.search_failed',
        message: 'Unable to execute search at this time.',
      })
    }
  }
}

export const searchHandler = buildSearchHandler()

export function registerSearchFunction() {
  app.http('search', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'search',
    handler: searchHandler,
  })
}
