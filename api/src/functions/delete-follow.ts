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
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import {
  buildFollowDocumentId,
  createFollowRepository,
  type FollowRepository,
} from '../lib/follows.js'
import { withHttpAuth } from '../lib/http-auth.js'
import {
  lookupPublicUserProfile,
  type UserProfileStore,
} from '../lib/user-profile.js'

export interface DeleteFollowHandlerDependencies {
  repositoryFactory?: () => FollowRepository
  targetStoreFactory?: () => UserProfileStore
}

interface DeletedFollowResponse {
  unfollow: {
    id: string
    followerId: string
    followedId: string
    handle: string
    following: false
    relationshipExisted: boolean
  }
}

let cachedTargetStore: CosmosUserProfileStore | undefined

function getTargetStore(): CosmosUserProfileStore {
  cachedTargetStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedTargetStore
}

export function buildDeleteFollowHandler(
  dependencies: DeleteFollowHandlerDependencies = {},
) {
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createFollowRepository())
  const targetStoreFactory =
    dependencies.targetStoreFactory ?? (() => getTargetStore())

  return async function deleteFollowHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const followerHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !followerHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before unfollowing users.',
      })
    }

    let repository: FollowRepository

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the follow repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The follow store is not configured.',
      })
    }

    let targetStore: UserProfileStore

    try {
      targetStore = targetStoreFactory()
    } catch (error) {
      context.log('Failed to configure the user profile store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown target store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The user profile store is not configured.',
      })
    }

    let targetProfileResult: Awaited<ReturnType<typeof lookupPublicUserProfile>>

    try {
      targetProfileResult = await lookupPublicUserProfile(
        request.params.handle,
        targetStore,
      )
    } catch (error) {
      context.log('Failed to resolve the follow target profile.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown follow target lookup error.',
        handle: request.params.handle ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.user_lookup_failed',
        message: 'Unable to resolve the requested user profile.',
      })
    }

    if (targetProfileResult.status !== 200 || !targetProfileResult.body.data) {
      return createJsonEnvelopeResponse(
        targetProfileResult.status,
        targetProfileResult.body,
      )
    }

    const targetProfile = targetProfileResult.body.data
    if (targetProfile.id === authenticatedUser.id) {
      return createErrorResponse(400, {
        code: 'cannot_unfollow_self',
        message: 'Users cannot unfollow themselves.',
        field: 'handle',
      })
    }

    try {
      const existingFollow = await repository.getByFollowerAndFollowed(
        authenticatedUser.id,
        targetProfile.id,
      )
      const followId = buildFollowDocumentId(
        authenticatedUser.id,
        targetProfile.id,
      )

      if (existingFollow !== null) {
        await repository.deleteByFollowerAndFollowed(
          authenticatedUser.id,
          targetProfile.id,
        )
      }

      const responseBody: DeletedFollowResponse = {
        unfollow: {
          id: followId,
          followerId: authenticatedUser.id,
          followedId: targetProfile.id,
          handle: targetProfile.handle,
          following: false,
          relationshipExisted: existingFollow !== null,
        },
      }

      context.log('Processed unfollow request.', {
        followerId: authenticatedUser.id,
        followedId: targetProfile.id,
        relationshipExisted: existingFollow !== null,
      })

      return createSuccessResponse(responseBody)
    } catch (error) {
      context.log('Failed to delete the follow relationship.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown follow delete error.',
        followerId: authenticatedUser.id,
        followedId: targetProfile.id,
      })

      return createErrorResponse(500, {
        code: 'server.follow_delete_failed',
        message: 'Unable to delete the requested follow relationship.',
      })
    }
  }
}

export const deleteFollowHandler = withHttpAuth(buildDeleteFollowHandler())

export function registerDeleteFollowFunction() {
  app.http('deleteFollow', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'users/{handle}/follow',
    handler: deleteFollowHandler,
  })
}
