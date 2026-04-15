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
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import { lookupFollowing } from '../lib/following.js'
import {
  createFollowingListRepository,
  type FollowingListRepository,
} from '../lib/follows.js'
import { type UserProfileStore } from '../lib/user-profile.js'

export interface ListFollowingHandlerDependencies {
  repositoryFactory?: () => FollowingListRepository
  storeFactory?: () => UserProfileStore
}

let cachedStore: CosmosUserProfileStore | undefined

function getStore(): CosmosUserProfileStore {
  cachedStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedStore
}

export function buildListFollowingHandler(
  dependencies: ListFollowingHandlerDependencies = {},
) {
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createFollowingListRepository())
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function listFollowingHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let repository: FollowingListRepository

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the follow repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown follow repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The follow store is not configured.',
      })
    }

    let store: UserProfileStore

    try {
      store = storeFactory()
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
      const result = await lookupFollowing(
        {
          handle: request.params.handle,
          limit: request.query.get('limit') ?? undefined,
          continuationToken:
            request.query.get('continuationToken') ?? undefined,
        },
        repository,
        store,
      )

      context.log('Following lookup completed.', {
        continuationTokenPresent:
          (result.body.data?.continuationToken ?? null) !== null,
        followingCount: result.body.data?.following.length ?? 0,
        handle: request.params.handle ?? null,
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the requested following list.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown following lookup error.',
        handle: request.params.handle ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.following_lookup_failed',
        message: 'Unable to load the requested following list.',
      })
    }
  }
}

export const listFollowingHandler = buildListFollowingHandler()

export function registerListFollowingFunction() {
  app.http('listFollowing', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/{handle}/following',
    handler: listFollowingHandler,
  })
}
