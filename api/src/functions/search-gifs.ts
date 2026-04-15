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
  searchTenorGifs,
  TenorConfigurationError,
  TenorUpstreamError,
} from '../lib/tenor.js'
import { withHttpAuth } from '../lib/http-auth.js'

export interface SearchGifHandlerDependencies {
  searchGifs?: typeof searchTenorGifs
}

function resolveLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function buildSearchGifHandler(
  dependencies: SearchGifHandlerDependencies = {},
) {
  const searchGifs = dependencies.searchGifs ?? searchTenorGifs

  return async function searchGifHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const authorHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !authorHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before browsing GIFs.',
      })
    }

    const query = request.query.get('q') ?? undefined
    const locale = request.query.get('locale') ?? undefined
    const limit = resolveLimit(request.query.get('limit') ?? undefined)

    try {
      const results = await searchGifs({
        ...(query === undefined ? {} : { query }),
        ...(locale === undefined ? {} : { locale }),
        ...(limit === undefined ? {} : { limit }),
      })

      context.log('GIF picker search completed.', {
        query: results.query || null,
        resultCount: results.results.length,
        userId: authenticatedUser.id,
      })

      return createSuccessResponse(results)
    } catch (error) {
      if (error instanceof TenorConfigurationError) {
        context.log('GIF picker search is unavailable because Tenor is not configured.', {
          userId: authenticatedUser.id,
        })

        return createErrorResponse(503, {
          code: 'gif_picker_unavailable',
          message: 'The GIF picker is not configured right now.',
        })
      }

      if (error instanceof TenorUpstreamError) {
        context.log('GIF picker search failed at the Tenor upstream.', {
          error: error.message,
          userId: authenticatedUser.id,
        })

        return createErrorResponse(502, {
          code: 'gif_picker_upstream_failed',
          message: error.message,
        })
      }

      context.log('GIF picker search failed unexpectedly.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown GIF picker error.',
        userId: authenticatedUser.id,
      })

      return createErrorResponse(500, {
        code: 'server.gif_picker_failed',
        message: 'Unable to load GIF results right now.',
      })
    }
  }
}

export const searchGifHandler = withHttpAuth(buildSearchGifHandler())

export function registerGifSearchFunction() {
  app.http('searchGifs', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'gifs/search',
    handler: searchGifHandler,
  })
}
