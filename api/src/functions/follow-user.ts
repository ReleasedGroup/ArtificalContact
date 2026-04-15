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
  createFollowDocument,
  createFollowRepository,
  type FollowRepository,
} from '../lib/follows.js'
import { withHttpAuth } from '../lib/http-auth.js'
import {
  lookupPublicUserProfile,
  type UserProfileStore,
} from '../lib/user-profile.js'

export interface FollowUserHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => FollowRepository
  targetStoreFactory?: () => UserProfileStore
}

let cachedTargetStore: CosmosUserProfileStore | undefined

function getTargetStore(): CosmosUserProfileStore {
  cachedTargetStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedTargetStore
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const record = error as Record<string, unknown>
  const statusCode = record.statusCode
  if (typeof statusCode === 'number') {
    return statusCode
  }

  const code = record.code
  if (typeof code === 'number') {
    return code
  }

  if (typeof code === 'string') {
    const parsedValue = Number.parseInt(code, 10)
    return Number.isNaN(parsedValue) ? undefined : parsedValue
  }

  return undefined
}

export function buildFollowUserHandler(
  dependencies: FollowUserHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createFollowRepository())
  const targetStoreFactory =
    dependencies.targetStoreFactory ?? (() => getTargetStore())

  return async function followUserHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const followerHandle = authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !followerHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before following users.',
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

    let targetProfileResult: Awaited<
      ReturnType<typeof lookupPublicUserProfile>
    >

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
        code: 'cannot_follow_self',
        message: 'Users cannot follow themselves.',
        field: 'handle',
      })
    }

    try {
      const existingFollow = await repository.getByFollowerAndFollowed(
        authenticatedUser.id,
        targetProfile.id,
      )

      if (existingFollow !== null) {
        return createSuccessResponse({
          follow: existingFollow,
        })
      }

      const follow = createFollowDocument(
        authenticatedUser.id,
        targetProfile.id,
        now(),
      )
      const storedFollow = await repository.create(follow)

      context.log('Created follow relationship.', {
        followId: storedFollow.id,
        followerId: authenticatedUser.id,
        followedId: targetProfile.id,
      })

      return createSuccessResponse(
        {
          follow: storedFollow,
        },
        201,
      )
    } catch (error) {
      if (getErrorStatusCode(error) === 409) {
        try {
          const existingFollow = await repository.getByFollowerAndFollowed(
            authenticatedUser.id,
            targetProfile.id,
          )

          if (existingFollow !== null) {
            return createSuccessResponse({
              follow: existingFollow,
            })
          }
        } catch (lookupError) {
          context.log('Failed to resolve the existing follow after a conflict.', {
            error:
              lookupError instanceof Error
                ? lookupError.message
                : 'Unknown follow conflict lookup error.',
            followerId: authenticatedUser.id,
            followedId: targetProfile.id,
          })
        }
      }

      context.log('Failed to create the follow relationship.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown follow creation error.',
        followerId: authenticatedUser.id,
        followedId: targetProfile.id,
      })

      return createErrorResponse(500, {
        code: 'server.follow_create_failed',
        message: 'Unable to follow the requested user.',
      })
    }
  }
}

export const followUserHandler = withHttpAuth(buildFollowUserHandler())

export function registerFollowUserFunction() {
  app.http('followUser', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'users/{handle}/follow',
    handler: followUserHandler,
  })
}
