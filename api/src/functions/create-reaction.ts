import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createJsonEnvelopeResponse,
  createSuccessResponse,
} from '../lib/api-envelope.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { withHttpAuth } from '../lib/http-auth.js'
import { isPubliclyVisiblePost, type PostStore } from '../lib/posts.js'
import {
  applyReactionMutation,
  buildCreateReactionRequestSchema,
  createReactionRepository,
  getErrorStatusCode,
  mapReactionValidationIssues,
  type ReactionPolicy,
  type ReactionRepository,
} from '../lib/reactions.js'

export interface CreateReactionHandlerDependencies {
  now?: () => Date
  postStoreFactory?: () => PostStore
  reactionPolicy?: ReactionPolicy
  reactionRepositoryFactory?: () => ReactionRepository
}

let cachedPostStore: CosmosPostStore | undefined

function getPostStore(): CosmosPostStore {
  cachedPostStore ??= CosmosPostStore.fromEnvironment()
  return cachedPostStore
}

function normalizeRoutePostId(postId: string | undefined): string | null {
  const trimmed = postId?.trim()
  return trimmed ? trimmed : null
}

export function buildCreateReactionHandler(
  dependencies: CreateReactionHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const postStoreFactory =
    dependencies.postStoreFactory ?? (() => getPostStore())
  const reactionRepositoryFactory =
    dependencies.reactionRepositoryFactory ?? (() => createReactionRepository())
  const requestSchema = buildCreateReactionRequestSchema()

  return async function createReactionHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const actorHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !actorHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before reacting to posts.',
      })
    }

    const postId = normalizeRoutePostId(request.params.id)
    if (postId === null) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: [
          {
            code: 'invalid_post_id',
            message: 'The post id path parameter is required.',
            field: 'id',
          },
        ],
      })
    }

    let postStore: PostStore

    try {
      postStore = postStoreFactory()
    } catch (error) {
      context.log('Failed to configure the post repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The post store is not configured.',
      })
    }

    let reactionRepository: ReactionRepository

    try {
      reactionRepository = reactionRepositoryFactory()
    } catch (error) {
      context.log('Failed to configure the reaction repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The reaction store is not configured.',
      })
    }

    let requestBody: unknown

    try {
      requestBody = await request.json()
    } catch {
      return createErrorResponse(400, {
        code: 'invalid_json',
        message: 'The request body must be valid JSON.',
      })
    }

    const parsedBody = requestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapReactionValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const post = await postStore.getPostById(postId)
      if (post === null || !isPubliclyVisiblePost(post)) {
        return createJsonEnvelopeResponse(404, {
          data: null,
          errors: [
            {
              code: 'post_not_found',
              message: 'No public post exists for the requested id.',
              field: 'id',
            },
          ],
        })
      }
    } catch (error) {
      context.log('Failed to resolve the requested post for a reaction.', {
        error:
          error instanceof Error ? error.message : 'Unknown post lookup error.',
        postId,
      })

      return createErrorResponse(500, {
        code: 'server.post_lookup_failed',
        message: 'Unable to resolve the requested post.',
      })
    }

    try {
      let existingReaction = await reactionRepository.getByPostAndUser(
        postId,
        authenticatedUser.id,
      )

      const firstMutationAt = now()
      let mutation = applyReactionMutation(existingReaction, parsedBody.data, {
        postId,
        userId: authenticatedUser.id,
        now: firstMutationAt,
        ...(dependencies.reactionPolicy === undefined
          ? {}
          : { policy: dependencies.reactionPolicy }),
      })

      let storedReaction = mutation.reaction
      let status = mutation.created ? 201 : 200

      if (mutation.created) {
        try {
          storedReaction = await reactionRepository.create(mutation.reaction)
        } catch (error) {
          if (getErrorStatusCode(error) !== 409) {
            throw error
          }

          existingReaction = await reactionRepository.getByPostAndUser(
            postId,
            authenticatedUser.id,
          )

          if (existingReaction === null) {
            throw error
          }

          const retryMutationAt = now()

          mutation = applyReactionMutation(existingReaction, parsedBody.data, {
            postId,
            userId: authenticatedUser.id,
            now: retryMutationAt,
            ...(dependencies.reactionPolicy === undefined
              ? {}
              : { policy: dependencies.reactionPolicy }),
          })

          storedReaction = mutation.changed
            ? await reactionRepository.upsert(mutation.reaction)
            : existingReaction
          status = 200
        }
      } else if (mutation.changed) {
        storedReaction = await reactionRepository.upsert(mutation.reaction)
      } else if (existingReaction !== null) {
        storedReaction = existingReaction
      }

      context.log('Recorded post reaction.', {
        actorId: authenticatedUser.id,
        postId,
        reactionId: storedReaction.id,
        reactionType: parsedBody.data.type,
        status,
      })

      return createSuccessResponse(
        {
          reaction: storedReaction,
        },
        status,
      )
    } catch (error) {
      context.log('Failed to record the requested reaction.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown reaction write error.',
        actorId: authenticatedUser.id,
        postId,
        reactionType: parsedBody.data.type,
      })

      return createErrorResponse(500, {
        code: 'server.reaction_create_failed',
        message: 'Unable to record the reaction.',
      })
    }
  }
}

export const createReactionHandler = withHttpAuth(buildCreateReactionHandler())

export function registerCreateReactionFunction() {
  app.http('createReaction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'posts/{id}/reactions',
    handler: createReactionHandler,
  })
}
