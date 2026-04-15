import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createJsonEnvelopeResponse,
  type ApiError,
} from '../lib/api-envelope.js'
import { CosmosFeedStore } from '../lib/cosmos-feed-store.js'
import { lookupFeed, type FeedStore } from '../lib/feed.js'
import { withHttpAuth } from '../lib/http-auth.js'

export interface GetFeedHandlerDependencies {
  storeFactory?: () => FeedStore
}

let cachedStore: CosmosFeedStore | undefined

function getStore(): CosmosFeedStore {
  cachedStore ??= CosmosFeedStore.fromEnvironment()
  return cachedStore
}

function createFeedErrorResponse(
  status: number,
  error: ApiError,
): HttpResponseInit {
  return createJsonEnvelopeResponse(status, {
    data: null,
    cursor: null,
    errors: [error],
  })
}

export function buildGetFeedHandler(
  dependencies: GetFeedHandlerDependencies = {},
) {
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function getFeedHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user

    if (!authenticatedUser) {
      return createFeedErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have a provisioned profile before reading a feed.',
      })
    }

    let store: FeedStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the feed store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown feed store configuration error.',
      })

      return createFeedErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The feed store is not configured.',
      })
    }

    try {
      const result = await lookupFeed(
        {
          feedOwnerId: authenticatedUser.id,
          cursor: request.query.get('cursor') ?? undefined,
        },
        store,
      )

      context.log('Feed lookup completed.', {
        cursorPresent: (result.body.cursor ?? null) !== null,
        status: result.status,
        userId: authenticatedUser.id,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the authenticated feed.', {
        error:
          error instanceof Error ? error.message : 'Unknown feed lookup error.',
        userId: authenticatedUser.id,
      })

      return createFeedErrorResponse(500, {
        code: 'server.feed_lookup_failed',
        message: "Unable to load the authenticated user's feed.",
      })
    }
  }
}

export const getFeedHandler = withHttpAuth(buildGetFeedHandler())

export function registerGetFeedFunction() {
  app.http('getFeed', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'feed',
    handler: getFeedHandler,
  })
}
