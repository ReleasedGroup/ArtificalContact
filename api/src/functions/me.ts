import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createSuccessResponse,
} from '../lib/api-envelope.js'
import { resolveAuthenticatedPrincipal } from '../lib/auth.js'
import {
  trackAuthSigninEvent,
  type AuthSigninTelemetryEvent,
} from '../lib/telemetry.js'
import { CosmosUserFollowCounterStore } from '../lib/cosmos-user-follow-counter-store.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import {
  createUserRepository,
  ensureUserForPrincipal,
  toMeProfile,
  type UserCounters,
  type ResolvedMeProfile,
  type UserRepository,
} from '../lib/users.js'

interface MeFollowCounterStore {
  countActiveFollowers(userId: string): Promise<number>
  countActiveFollowing(userId: string): Promise<number>
}

interface MePostCounterStore {
  countActiveRootPostsByAuthorId(authorId: string): Promise<number>
}

export interface AuthMeHandlerDependencies {
  emitSigninTelemetry?: (event: AuthSigninTelemetryEvent) => void
  now?: () => Date
  repositoryFactory?: () => UserRepository
  followCounterStoreFactory?: () => MeFollowCounterStore
  postCounterStoreFactory?: () => MePostCounterStore
}

function haveCountersChanged(
  current: UserCounters,
  next: UserCounters,
): boolean {
  return (
    current.posts !== next.posts ||
    current.followers !== next.followers ||
    current.following !== next.following
  )
}

export function buildAuthMeHandler(
  dependencies: AuthMeHandlerDependencies = {},
) {
  const emitSigninTelemetry =
    dependencies.emitSigninTelemetry ?? trackAuthSigninEvent
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())
  const followCounterStoreFactory =
    dependencies.followCounterStoreFactory ??
    (() => CosmosUserFollowCounterStore.fromEnvironment())
  const postCounterStoreFactory =
    dependencies.postCounterStoreFactory ??
    (() => CosmosPostStore.fromEnvironment())

  return async function authMeHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const principalResult = resolveAuthenticatedPrincipal(request)

    if (!principalResult.ok) {
      return createErrorResponse(401, {
        code: principalResult.errorCode,
        message: principalResult.message,
      })
    }

    let repository: UserRepository
    let followCounterStore: MeFollowCounterStore
    let postCounterStore: MePostCounterStore

    try {
      repository = repositoryFactory()
      followCounterStore = followCounterStoreFactory()
      postCounterStore = postCounterStoreFactory()
    } catch (error) {
      context.log('Failed to configure the authenticated profile dependencies.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The user profile store is not configured.',
      })
    }

    try {
      const resolvedUser = await ensureUserForPrincipal(
        principalResult.principal,
        repository,
        now,
      )

      context.log('Resolved authenticated profile.', {
        identityProvider: resolvedUser.user.identityProvider,
        isNewUser: resolvedUser.isNewUser,
        status: resolvedUser.user.status,
        userId: resolvedUser.user.id,
      })

      try {
        emitSigninTelemetry({
          identityProvider: resolvedUser.user.identityProvider,
          isNewUser: resolvedUser.isNewUser,
        })
      } catch (error) {
        context.log('Failed to emit auth.signin telemetry.', {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown auth.signin telemetry error.',
        })
      }

      let responseUser = resolvedUser.user

      try {
        const [posts, followers, following] = await Promise.all([
          postCounterStore.countActiveRootPostsByAuthorId(resolvedUser.user.id),
          followCounterStore.countActiveFollowers(resolvedUser.user.id),
          followCounterStore.countActiveFollowing(resolvedUser.user.id),
        ])

        const liveCounters: UserCounters = {
          posts,
          followers,
          following,
        }

        if (haveCountersChanged(resolvedUser.user.counters, liveCounters)) {
          responseUser = {
            ...resolvedUser.user,
            counters: liveCounters,
          }
        }
      } catch (error) {
        context.log('Failed to reconcile authenticated profile counters.', {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown authenticated profile counter reconciliation error.',
          userId: resolvedUser.user.id,
        })
      }

      const responsePayload: ResolvedMeProfile = {
        user: toMeProfile(responseUser),
        isNewUser: resolvedUser.isNewUser,
      }

      return createSuccessResponse(responsePayload)
    } catch (error) {
      context.log('Failed to resolve the authenticated profile.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown authenticated profile error.',
      })

      return createErrorResponse(500, {
        code: 'server.user_lookup_failed',
        message: 'Unable to resolve the authenticated user profile.',
      })
    }
  }
}

export const authMeHandler = buildAuthMeHandler()

export function registerAuthMeFunction() {
  app.http('authMe', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'me',
    handler: authMeHandler,
  })
}
