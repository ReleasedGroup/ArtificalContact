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
import {
  applyProfileUpdate,
  mapValidationIssues,
  updateProfileRequestSchema,
} from '../lib/profile-update.js'
import { resolveAuthenticatedPrincipal } from '../lib/auth.js'
import {
  createUserRepository,
  ensureUserForPrincipal,
  toMeProfile,
  type UserRepository,
} from '../lib/users.js'

export interface UpdateProfileHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => UserRepository
}

export function buildUpdateProfileHandler(
  dependencies: UpdateProfileHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())

  return async function updateProfileHandler(
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

    let requestBody: unknown

    try {
      requestBody = await request.json()
    } catch {
      return createErrorResponse(400, {
        code: 'invalid_json',
        message: 'The request body must be valid JSON.',
      })
    }

    const parsedBody = updateProfileRequestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const resolvedUser = await ensureUserForPrincipal(
        principalResult.principal,
        repository,
        now,
      )
      const updatedUser = applyProfileUpdate(
        resolvedUser.user,
        parsedBody.data,
        now(),
      )
      const storedUser = await repository.upsert(updatedUser)

      context.log('Updated authenticated profile.', {
        identityProvider: storedUser.identityProvider,
        updatedFields: Object.keys(parsedBody.data),
        userId: storedUser.id,
      })

      return createSuccessResponse({
        user: toMeProfile(storedUser),
      })
    } catch (error) {
      context.log('Failed to update the authenticated profile.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown authenticated profile update error.',
      })

      return createErrorResponse(500, {
        code: 'server.user_update_failed',
        message: 'Unable to update the authenticated user profile.',
      })
    }
  }
}

export const updateProfileHandler = buildUpdateProfileHandler()

export function registerUpdateProfileFunction() {
  app.http('updateProfile', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'me',
    handler: updateProfileHandler,
  })
}
