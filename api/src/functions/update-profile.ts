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
  createPendingUserDocument,
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
      const storedUser = await persistProfileUpdate(
        principalResult.principal,
        repository,
        parsedBody.data,
        now,
      )

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

async function persistProfileUpdate(
  principal: Parameters<typeof createPendingUserDocument>[0],
  repository: UserRepository,
  profileUpdate: Parameters<typeof applyProfileUpdate>[1],
  now: () => Date,
) {
  const existingUser = await repository.getById(principal.subject)

  if (existingUser !== null) {
    return repository.upsert(
      applyProfileUpdate(existingUser, profileUpdate, now()),
    )
  }

  const createdAt = now()
  const pendingUser = createPendingUserDocument(principal, createdAt)

  try {
    return await repository.create(
      applyProfileUpdate(pendingUser, profileUpdate, createdAt),
    )
  } catch (error) {
    if (getErrorStatusCode(error) !== 409) {
      throw error
    }

    const concurrentlyCreatedUser = await repository.getById(principal.subject)
    if (concurrentlyCreatedUser === null) {
      throw error
    }

    return repository.upsert(
      applyProfileUpdate(concurrentlyCreatedUser, profileUpdate, now()),
    )
  }
}
