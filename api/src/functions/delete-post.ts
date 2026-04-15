import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { createErrorResponse, createJsonEnvelopeResponse } from '../lib/api-envelope.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { withHttpAuth } from '../lib/http-auth.js'
import { softDeletePost, type MutablePostStore } from '../lib/posts.js'
import {
  createRateLimitRepository,
  withRateLimit,
  type RateLimitRepository,
} from '../lib/rate-limit.js'
import { createUserRepository, type UserRepository } from '../lib/users.js'

export interface DeletePostHandlerDependencies {
  now?: () => Date
  rateLimitRepositoryFactory?: () => RateLimitRepository
  repositoryFactory?: () => UserRepository
  storeFactory?: () => MutablePostStore
}

let cachedStore: CosmosPostStore | undefined

function getStore(): CosmosPostStore {
  cachedStore ??= CosmosPostStore.fromEnvironment()
  return cachedStore
}

export function buildDeletePostHandler(
  dependencies: DeletePostHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const rateLimitRepositoryFactory =
    dependencies.rateLimitRepositoryFactory ?? createRateLimitRepository
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())
  const storeFactory = dependencies.storeFactory ?? getStore

  async function deletePostHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let store: MutablePostStore

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

    const authenticatedUser = context.auth?.user
    if (authenticatedUser === null || authenticatedUser === undefined) {
      return createErrorResponse(500, {
        code: 'server.auth_context_missing',
        message: 'The authenticated user context was not available.',
      })
    }

    try {
      const result = await softDeletePost(
        request.params.id,
        {
          userId: authenticatedUser.id,
          roles: context.auth?.roles ?? [],
        },
        store,
        now,
      )

      context.log('Delete post request completed.', {
        actorUserId: authenticatedUser.id,
        alreadyDeleted: result.body.data?.alreadyDeleted ?? null,
        postId: request.params.id ?? null,
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to delete the requested post.', {
        actorUserId: authenticatedUser.id,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown post delete error.',
        postId: request.params.id ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.post_delete_failed',
        message: 'Unable to delete the requested post.',
      })
    }
  }

  return withHttpAuth(
    withRateLimit(deletePostHandler, {
      endpointClass: 'posts',
      repositoryFactory: rateLimitRepositoryFactory,
    }),
    {
      repositoryFactory,
    },
  )
}

export const deletePostHandler = buildDeletePostHandler()

export function registerDeletePostFunction() {
  app.http('deletePost', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'posts/{id}',
    handler: deletePostHandler,
  })
}
