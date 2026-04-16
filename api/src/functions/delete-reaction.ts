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
  applyReactionDeletion,
  buildReactionDocumentId,
  createReactionRepository,
  DEFAULT_EMOJI_VALUE_MAX_LENGTH,
  type ReactionDocument,
  type ReactionRepository,
} from '../lib/reactions.js'
import type { ReactionCounterStore } from '../lib/reaction-counter.js'
import { withRateLimit } from '../lib/rate-limit.js'

export interface DeleteReactionHandlerDependencies {
  now?: () => Date
  postStoreFactory?: () => PostStore
  reactionRepositoryFactory?: () => ReactionRepository
}

interface DeleteReactionResponse {
  unreact: {
    id: string
    postId: string
    userId: string
    reactionExisted: boolean
    deletedReaction: boolean
    removedEmojiValue: string | null
    emojiValueRemoved: boolean
  }
  reaction: ReactionDocument | null
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

function normalizeOptionalEmojiValue(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0
}

function supportsReactionCounterSync(
  store: PostStore,
): store is PostStore & ReactionCounterStore {
  const candidate = store as Partial<ReactionCounterStore>

  return (
    typeof candidate.getReactionSummary === 'function' &&
    typeof candidate.setReactionCounts === 'function'
  )
}

export function buildDeleteReactionHandler(
  dependencies: DeleteReactionHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const postStoreFactory =
    dependencies.postStoreFactory ?? (() => getPostStore())
  const reactionRepositoryFactory =
    dependencies.reactionRepositoryFactory ?? (() => createReactionRepository())

  return async function deleteReactionHandler(
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
          'The authenticated user must have an active profile before removing reactions from posts.',
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

    const emojiSelectorProvided = request.query.has('emoji')
    const removedEmojiValue = normalizeOptionalEmojiValue(
      request.query.get('emoji'),
    )

    if (emojiSelectorProvided && removedEmojiValue === null) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: [
          {
            code: 'invalid_emoji_value',
            message: 'The emoji query parameter must be a non-empty string.',
            field: 'emoji',
          },
        ],
      })
    }

    if (
      removedEmojiValue !== null &&
      removedEmojiValue.length > DEFAULT_EMOJI_VALUE_MAX_LENGTH
    ) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: [
          {
            code: 'invalid_emoji_value',
            message: `Emoji selectors must be ${DEFAULT_EMOJI_VALUE_MAX_LENGTH} characters or fewer.`,
            field: 'emoji',
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

    let post: Awaited<ReturnType<PostStore['getPostById']>> = null

    try {
      post = await postStore.getPostById(postId)
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
      context.log(
        'Failed to resolve the requested post for a reaction delete.',
        {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown post lookup error.',
          postId,
        },
      )

      return createErrorResponse(500, {
        code: 'server.post_lookup_failed',
        message: 'Unable to resolve the requested post.',
      })
    }

    try {
      const existingReaction = await reactionRepository.getByPostAndUser(
        postId,
        authenticatedUser.id,
      )
      const deletion = applyReactionDeletion(existingReaction, {
        now: now(),
        ...(removedEmojiValue === null
          ? {}
          : { emojiValue: removedEmojiValue }),
      })
      const reactionId = buildReactionDocumentId(postId, authenticatedUser.id)

      if (deletion.changed) {
        if (deletion.deleted) {
          await reactionRepository.deleteByPostAndUser(
            postId,
            authenticatedUser.id,
          )
        } else if (deletion.reaction !== null) {
          await reactionRepository.upsert(deletion.reaction)
        }
      }

      if (post !== null && supportsReactionCounterSync(postStore)) {
        try {
          const nextCounts = await postStore.getReactionSummary(postId)
          await postStore.setReactionCounts(
            post.id,
            post.threadId?.trim() || post.id,
            {
              ...nextCounts,
              replies: toNonNegativeInteger(post.counters?.replies),
            },
          )
        } catch (error) {
          context.log('Failed to refresh post reaction counters.', {
            actorId: authenticatedUser.id,
            error:
              error instanceof Error
                ? error.message
                : 'Unknown reaction counter sync error.',
            postId,
          })
        }
      }

      const responseBody: DeleteReactionResponse = {
        unreact: {
          id: reactionId,
          postId,
          userId: authenticatedUser.id,
          reactionExisted: existingReaction !== null,
          deletedReaction: deletion.deleted,
          removedEmojiValue,
          emojiValueRemoved: deletion.emojiValueRemoved,
        },
        reaction: deletion.reaction,
      }

      context.log('Processed reaction delete request.', {
        actorId: authenticatedUser.id,
        postId,
        reactionId,
        reactionExisted: existingReaction !== null,
        deletedReaction: deletion.deleted,
        removedEmojiValue,
        emojiValueRemoved: deletion.emojiValueRemoved,
      })

      return createSuccessResponse(responseBody)
    } catch (error) {
      context.log('Failed to delete the requested reaction.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown reaction delete error.',
        actorId: authenticatedUser.id,
        postId,
        removedEmojiValue,
      })

      return createErrorResponse(500, {
        code: 'server.reaction_delete_failed',
        message: 'Unable to delete the requested reaction.',
      })
    }
  }
}

export const deleteReactionHandler = withHttpAuth(
  withRateLimit(buildDeleteReactionHandler(), {
    endpointClass: 'reactions',
  }),
)

export function registerDeleteReactionFunction() {
  app.http('deleteReaction', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'posts/{id}/reactions',
    handler: deleteReactionHandler,
  })
}
