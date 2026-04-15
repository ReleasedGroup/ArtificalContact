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
import { resolveAuthenticatedPrincipal } from '../lib/auth.js'
import { CosmosUsersByHandleMirrorStore } from '../lib/cosmos-users-by-handle-mirror-store.js'
import {
  normalizeHandleLower,
  type UsersByHandleMirrorStore,
} from '../lib/users-by-handle-mirror.js'
import {
  applyProfileUpdate,
  mapValidationIssues,
  updateProfileRequestSchema,
} from '../lib/profile-update.js'
import {
  createPendingUserDocument,
  createUserRepository,
  toMeProfile,
  type UserRepository,
} from '../lib/users.js'

export interface UpdateProfileHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => UserRepository
  handleStoreFactory?: () => UsersByHandleMirrorStore
}

let cachedHandleStore: CosmosUsersByHandleMirrorStore | undefined

function getHandleStore(): CosmosUsersByHandleMirrorStore {
  cachedHandleStore ??= CosmosUsersByHandleMirrorStore.fromEnvironment()
  return cachedHandleStore
}

export function buildUpdateProfileHandler(
  dependencies: UpdateProfileHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())
  const handleStoreFactory =
    dependencies.handleStoreFactory ?? (() => getHandleStore())

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

    if (parsedBody.data.handle !== undefined) {
      let handleStore: UsersByHandleMirrorStore

      try {
        handleStore = handleStoreFactory()
      } catch (error) {
        context.log('Failed to configure the usersByHandle store.', {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown handle store configuration error.',
        })

        return createErrorResponse(500, {
          code: 'server.configuration_error',
          message: 'The user profile store is not configured.',
        })
      }

      const requestedHandle = normalizeHandleLower({
        handle: parsedBody.data.handle,
      })
      if (requestedHandle !== null) {
        try {
          const existingHandle = await handleStore.getByHandle(requestedHandle)
          if (
            existingHandle !== null &&
            existingHandle.userId !== principalResult.principal.subject
          ) {
            return createJsonEnvelopeResponse(409, {
              data: null,
              errors: [
                {
                  code: 'handle_taken',
                  message: 'The requested handle is already in use.',
                  field: 'handle',
                },
              ],
            })
          }
        } catch (error) {
          context.log('Failed to verify handle uniqueness.', {
            error:
              error instanceof Error
                ? error.message
                : 'Unknown handle lookup error.',
            handle: requestedHandle,
            userId: principalResult.principal.subject,
          })

          return createErrorResponse(500, {
            code: 'server.user_update_failed',
            message: 'Unable to update the authenticated user profile.',
          })
        }
      }
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
