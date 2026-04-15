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
import {
  createUserRepository,
  ensureUserForPrincipal,
  toMeProfile,
  type ResolvedMeProfile,
  type UserRepository,
} from '../lib/users.js'

export interface AuthMeHandlerDependencies {
  emitSigninTelemetry?: (event: AuthSigninTelemetryEvent) => void
  now?: () => Date
  repositoryFactory?: () => UserRepository
}

export function buildAuthMeHandler(
  dependencies: AuthMeHandlerDependencies = {},
) {
  const emitSigninTelemetry =
    dependencies.emitSigninTelemetry ?? trackAuthSigninEvent
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())

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

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the user repository.', {
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

      const responsePayload: ResolvedMeProfile = {
        user: toMeProfile(resolvedUser.user),
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
