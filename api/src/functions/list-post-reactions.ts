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
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import { lookupReactionSummaryPage } from '../lib/reaction-summary.js'
import {
  createReactionRepository,
  type ReactionListRepository,
} from '../lib/reactions.js'
import type { PostStore } from '../lib/posts.js'
import type { UserProfileStore } from '../lib/user-profile.js'

export interface ListPostReactionsHandlerDependencies {
  postStoreFactory?: () => PostStore
  reactionStoreFactory?: () => ReactionListRepository
  profileStoreFactory?: () => UserProfileStore
}

let cachedPostStore: CosmosPostStore | undefined
let cachedProfileStore: CosmosUserProfileStore | undefined

function getPostStore(): CosmosPostStore {
  cachedPostStore ??= CosmosPostStore.fromEnvironment()
  return cachedPostStore
}

function getProfileStore(): CosmosUserProfileStore {
  cachedProfileStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedProfileStore
}

export function buildListPostReactionsHandler(
  dependencies: ListPostReactionsHandlerDependencies = {},
) {
  const postStoreFactory =
    dependencies.postStoreFactory ?? (() => getPostStore())
  const reactionStoreFactory =
    dependencies.reactionStoreFactory ?? (() => createReactionRepository())
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? (() => getProfileStore())

  return async function listPostReactionsHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let postStore: PostStore

    try {
      postStore = postStoreFactory()
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

    let reactionStore: ReactionListRepository

    try {
      reactionStore = reactionStoreFactory()
    } catch (error) {
      context.log('Failed to configure the reaction store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown reaction store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The reaction store is not configured.',
      })
    }

    let profileStore: UserProfileStore

    try {
      profileStore = profileStoreFactory()
    } catch (error) {
      context.log('Failed to configure the user profile store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown user profile store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The user profile store is not configured.',
      })
    }

    try {
      const result = await lookupReactionSummaryPage(
        {
          postId: request.params.id,
          limit: request.query.get('limit') ?? undefined,
          continuationToken:
            request.query.get('continuationToken') ?? undefined,
          type: request.query.get('type') ?? undefined,
        },
        postStore,
        reactionStore,
        profileStore,
      )

      context.log('Post reactions lookup completed.', {
        continuationTokenPresent:
          (result.body.data?.continuationToken ?? null) !== null,
        postId: request.params.id ?? null,
        status: result.status,
        type: request.query.get('type') ?? 'all',
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the requested post reactions.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown post reactions lookup error.',
        postId: request.params.id ?? null,
        type: request.query.get('type') ?? 'all',
      })

      return createErrorResponse(500, {
        code: 'server.post_reactions_lookup_failed',
        message: 'Unable to load the requested post reactions.',
      })
    }
  }
}

export const listPostReactionsHandler = buildListPostReactionsHandler()

export function registerListPostReactionsFunction() {
  app.http('listPostReactions', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'posts/{id}/reactions',
    handler: listPostReactionsHandler,
  })
}
