import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions'
import {
  type AuthenticatedPrincipal,
  resolveAuthenticatedPrincipal,
} from './auth.js'
import { createErrorResponse } from './api-envelope.js'
import {
  createUserRepository,
  resolveUserRoles,
  type UserDocument,
  type UserRepository,
} from './users.js'

export interface RequestAuthContext {
  isAuthenticated: boolean
  principal: AuthenticatedPrincipal | null
  user: UserDocument | null
  roles: string[]
}

export interface HttpAuthOptions {
  allowAnonymous?: boolean
  requiredRoles?: string[]
  repositoryFactory?: () => UserRepository
}

export type HttpHandler = (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit>

declare module '@azure/functions' {
  interface InvocationContext {
    auth?: RequestAuthContext
  }
}

function setAuthContext(
  context: InvocationContext,
  authContext: RequestAuthContext,
): void {
  context.auth = authContext
}

function createAnonymousAuthContext(): RequestAuthContext {
  return {
    isAuthenticated: false,
    principal: null,
    user: null,
    roles: ['anonymous'],
  }
}

function createForbiddenResponse(message: string): HttpResponseInit {
  return createErrorResponse(403, {
    code: 'auth.forbidden',
    message,
  })
}

function createPrincipalOnlyAuthContext(
  principal: AuthenticatedPrincipal,
): RequestAuthContext {
  return {
    isAuthenticated: true,
    principal,
    user: null,
    roles: principal.userRoles,
  }
}

export function withHttpAuth(
  handler: HttpHandler,
  options: HttpAuthOptions = {},
): HttpHandler {
  const requiredRoles = [
    ...new Set(
      (options.requiredRoles ?? [])
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  if (options.allowAnonymous && requiredRoles.length > 0) {
    throw new Error(
      'withHttpAuth cannot combine allowAnonymous with requiredRoles.',
    )
  }

  const repositoryFactory = options.repositoryFactory ?? createUserRepository
  let cachedRepository: UserRepository | undefined

  function getRepository(): UserRepository {
    cachedRepository ??= repositoryFactory()
    return cachedRepository
  }

  return async function authenticatedHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const principalResult = resolveAuthenticatedPrincipal(request)

    if (!principalResult.ok) {
      if (options.allowAnonymous) {
        setAuthContext(context, createAnonymousAuthContext())
        return handler(request, context)
      }

      return createErrorResponse(401, {
        code: principalResult.errorCode,
        message: principalResult.message,
      })
    }

    let repository: UserRepository

    try {
      repository = getRepository()
    } catch (error) {
      if (options.allowAnonymous) {
        setAuthContext(
          context,
          createPrincipalOnlyAuthContext(principalResult.principal),
        )
        return handler(request, context)
      }

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

    let user: UserDocument | null

    try {
      user = await repository.getById(principalResult.principal.subject)
    } catch (error) {
      if (options.allowAnonymous) {
        context.log(
          'Failed to enrich the authenticated user for an anonymous route.',
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unknown authenticated user error.',
          },
        )
        setAuthContext(
          context,
          createPrincipalOnlyAuthContext(principalResult.principal),
        )
        return handler(request, context)
      }

      context.log('Failed to resolve the authenticated user.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown authenticated user error.',
      })

      return createErrorResponse(500, {
        code: 'server.user_lookup_failed',
        message: 'Unable to resolve the authenticated user.',
      })
    }

    if (!user) {
      if (options.allowAnonymous) {
        setAuthContext(
          context,
          createPrincipalOnlyAuthContext(principalResult.principal),
        )
        return handler(request, context)
      }

      return createForbiddenResponse(
        'The authenticated user does not have a provisioned profile.',
      )
    }

    const roles = resolveUserRoles(principalResult.principal, user)
    if (requiredRoles.some((role) => !roles.includes(role))) {
      return createForbiddenResponse(
        'The authenticated user does not have the required role.',
      )
    }

    setAuthContext(context, {
      isAuthenticated: true,
      principal: principalResult.principal,
      user,
      roles,
    })

    return handler(request, context)
  }
}
