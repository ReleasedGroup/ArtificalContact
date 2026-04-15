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
import { lookupFollowersPage } from '../lib/follower-list.js'
import {
  createFollowersMirrorRepository,
  type FollowersMirrorRepository,
} from '../lib/follows.js'
import type { UserProfileStore } from '../lib/user-profile.js'

export interface ListFollowersHandlerDependencies {
  profileStoreFactory?: () => UserProfileStore
  followersStoreFactory?: () => FollowersMirrorRepository
}

let cachedProfileStore: CosmosUserProfileStore | undefined

function getProfileStore(): CosmosUserProfileStore {
  cachedProfileStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedProfileStore
}

export function buildListFollowersHandler(
  dependencies: ListFollowersHandlerDependencies = {},
) {
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? (() => getProfileStore())
  const followersStoreFactory =
    dependencies.followersStoreFactory ?? (() => createFollowersMirrorRepository())

  return async function listFollowersHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
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

    let followersStore: FollowersMirrorRepository

    try {
      followersStore = followersStoreFactory()
    } catch (error) {
      context.log('Failed to configure the followers store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown followers store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The followers store is not configured.',
      })
    }

    try {
      const result = await lookupFollowersPage(
        {
          handle: request.params.handle,
          limit: request.query.get('limit') ?? undefined,
          continuationToken:
            request.query.get('continuationToken') ?? undefined,
        },
        profileStore,
        followersStore,
      )

      context.log('Followers lookup completed.', {
        continuationTokenPresent:
          (result.body.data?.continuationToken ?? null) !== null,
        handle: request.params.handle ?? null,
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the requested followers list.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown followers lookup error.',
        handle: request.params.handle ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.followers_lookup_failed',
        message: 'Unable to load the requested followers list.',
      })
    }
  }
}

export const listFollowersHandler = buildListFollowersHandler()

export function registerListFollowersFunction() {
  app.http('listFollowers', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/{handle}/followers',
    handler: listFollowersHandler,
  })
}
