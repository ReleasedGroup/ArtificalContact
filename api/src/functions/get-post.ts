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
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { lookupPublicPost, type PostStore } from '../lib/posts.js'

let cachedStore: CosmosPostStore | undefined

function getStore(): CosmosPostStore {
  cachedStore ??= CosmosPostStore.fromEnvironment()
  return cachedStore
}

export function buildGetPostHandler(storeFactory: () => PostStore = getStore) {
  return async function getPostHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let store: PostStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the post store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown post store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The post store is not configured.',
      })
    }

    try {
      const result = await lookupPublicPost(request.params.id, store)

      context.log('Public post lookup completed.', {
        postId: request.params.id ?? null,
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to resolve the requested post.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown public post lookup error.',
        postId: request.params.id ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.post_lookup_failed',
        message: 'Unable to resolve the requested post.',
      })
    }
  }
}

export const getPostHandler = buildGetPostHandler()

export function registerGetPostFunction() {
  app.http('getPost', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'posts/{id}',
    handler: getPostHandler,
  })
}
