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
import { AzureSearchStore } from '../lib/azure-search-store.js'
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_QUERY_LENGTH,
  normalizeSearchText,
  type SearchQueryStore,
  type SearchResponse,
  type SearchType,
} from '../lib/search.js'

export interface SearchHandlerDependencies {
  storeFactory?: () => SearchQueryStore
}

let cachedStore: AzureSearchStore | undefined

function getStore(): AzureSearchStore {
  cachedStore ??= AzureSearchStore.fromEnvironment()
  return cachedStore
}

function resolveSearchType(value: string | undefined): SearchType | null {
  if (!value) {
    return 'all'
  }

  const normalizedValue = value.trim().toLowerCase()
  if (
    normalizedValue === 'all' ||
    normalizedValue === 'posts' ||
    normalizedValue === 'users'
  ) {
    return normalizedValue
  }

  return null
}

function resolveSearchLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_SEARCH_LIMIT
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SEARCH_LIMIT
  }

  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, parsed))
}

export function buildSearchHandler(
  dependencies: SearchHandlerDependencies = {},
) {
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function searchHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const requestedQuery = request.query.get('q')?.trim() ?? ''
    const normalizedQuery = normalizeSearchText(requestedQuery)

    if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return createErrorResponse(400, {
        code: 'validation.search_query_too_short',
        message: `Search queries must contain at least ${MIN_SEARCH_QUERY_LENGTH} characters.`,
        field: 'q',
      })
    }

    const searchType = resolveSearchType(request.query.get('type') ?? undefined)
    if (searchType === null) {
      return createErrorResponse(400, {
        code: 'validation.invalid_search_type',
        message: 'Search type must be one of all, posts, or users.',
        field: 'type',
      })
    }

    const limit = resolveSearchLimit(request.query.get('limit') ?? undefined)

    let store: SearchQueryStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Search is unavailable because the Azure AI Search store is not configured.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown search store configuration error.',
      })

      return createErrorResponse(503, {
        code: 'search.unavailable',
        message: 'Search is not configured right now.',
      })
    }

    try {
      let response: SearchResponse

      if (searchType === 'all') {
        const [posts, users] = await Promise.all([
          store.searchPosts({
            query: normalizedQuery,
            limit,
          }),
          store.searchUsers({
            query: normalizedQuery,
            limit,
          }),
        ])

        response = {
          query: requestedQuery,
          type: searchType,
          posts,
          users,
        }
      } else if (searchType === 'posts') {
        response = {
          query: requestedQuery,
          type: searchType,
          posts: await store.searchPosts({
            query: normalizedQuery,
            limit,
          }),
          users: [],
        }
      } else {
        response = {
          query: requestedQuery,
          type: searchType,
          posts: [],
          users: await store.searchUsers({
            query: normalizedQuery,
            limit,
          }),
        }
      }

      context.log('Search completed.', {
        postCount: response.posts.length,
        query: requestedQuery,
        type: searchType,
        userCount: response.users.length,
      })

      return createSuccessResponse(response)
    } catch (error) {
      context.log('Search failed unexpectedly.', {
        error: error instanceof Error ? error.message : 'Unknown search error.',
        query: requestedQuery,
        type: searchType,
      })

      return createErrorResponse(500, {
        code: 'server.search_failed',
        message: 'Unable to load search results right now.',
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
