import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createSuccessResponse,
  type ApiError,
} from '../lib/api-envelope.js'
import { resolveAuthenticatedPrincipal } from '../lib/auth.js'
import {
  applyProfileUpdate,
  createUserRepository,
  ensureUserForPrincipal,
  toMeProfile,
  type UserProfileUpdate,
  type ResolvedMeProfile,
  type UserRepository,
} from '../lib/users.js'

export interface AuthMeHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => UserRepository
}

const maxDisplayNameLength = 80
const maxBioLength = 280
const maxExpertiseCount = 12
const maxExpertiseLength = 32
const maxAssetUrlLength = 2048

interface ProfileUpdateRequestBody {
  displayName?: unknown
  bio?: unknown
  avatarUrl?: unknown
  bannerUrl?: unknown
  expertise?: unknown
}

type ProfileUpdateValidation =
  | {
      ok: true
      value: UserProfileUpdate
    }
  | {
      ok: false
      error: ApiError
    }

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function invalidProfileField(
  field: string,
  message: string,
  code = 'profile.invalid_payload',
): ProfileUpdateValidation {
  return {
    ok: false,
    error: {
      code,
      field,
      message,
    },
  }
}

function validateAssetUrl(
  field: 'avatarUrl' | 'bannerUrl',
  value: unknown,
): string | null | ApiError {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return {
      code: 'profile.invalid_payload',
      field,
      message: 'Profile asset placeholders must be strings when provided.',
    }
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length > maxAssetUrlLength) {
    return {
      code: 'profile.invalid_payload',
      field,
      message: `Profile asset placeholders must be ${maxAssetUrlLength} characters or fewer.`,
    }
  }

  try {
    const parsedUrl = new URL(trimmed)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        code: 'profile.invalid_payload',
        field,
        message: 'Profile asset placeholders must use http or https URLs.',
      }
    }
  } catch {
    return {
      code: 'profile.invalid_payload',
      field,
      message: 'Profile asset placeholders must be valid URLs.',
    }
  }

  return trimmed
}

function validateProfileUpdate(
  body: unknown,
): ProfileUpdateValidation {
  if (typeof body !== 'object' || body === null) {
    return invalidProfileField(
      'body',
      'The profile update payload must be a JSON object.',
      'request.invalid_body',
    )
  }

  const payload = body as ProfileUpdateRequestBody

  if (typeof payload.displayName !== 'string') {
    return invalidProfileField(
      'displayName',
      'Display name is required.',
    )
  }

  const displayName = trimString(payload.displayName)
  if (displayName === null) {
    return invalidProfileField(
      'displayName',
      'Display name cannot be empty.',
    )
  }

  if (displayName.length > maxDisplayNameLength) {
    return invalidProfileField(
      'displayName',
      `Display name must be ${maxDisplayNameLength} characters or fewer.`,
    )
  }

  if (
    payload.bio !== undefined &&
    payload.bio !== null &&
    typeof payload.bio !== 'string'
  ) {
    return invalidProfileField(
      'bio',
      'Bio must be a string when provided.',
    )
  }

  const bio = trimString(payload.bio)
  if (bio !== null && bio.length > maxBioLength) {
    return invalidProfileField(
      'bio',
      `Bio must be ${maxBioLength} characters or fewer.`,
    )
  }

  const avatarUrl = validateAssetUrl('avatarUrl', payload.avatarUrl)
  if (typeof avatarUrl === 'object' && avatarUrl !== null) {
    return {
      ok: false,
      error: avatarUrl,
    }
  }

  const bannerUrl = validateAssetUrl('bannerUrl', payload.bannerUrl)
  if (typeof bannerUrl === 'object' && bannerUrl !== null) {
    return {
      ok: false,
      error: bannerUrl,
    }
  }

  if (!Array.isArray(payload.expertise)) {
    return invalidProfileField(
      'expertise',
      'Expertise must be an array of strings.',
    )
  }

  const normalizedExpertise: string[] = []
  const seenExpertise = new Set<string>()

  for (const item of payload.expertise) {
    if (typeof item !== 'string') {
      return invalidProfileField(
        'expertise',
        'Expertise must be an array of strings.',
      )
    }

    const normalizedItem = trimString(item)?.toLowerCase() ?? null
    if (normalizedItem === null) {
      continue
    }

    if (normalizedItem.length > maxExpertiseLength) {
      return invalidProfileField(
        'expertise',
        `Expertise tags must be ${maxExpertiseLength} characters or fewer.`,
      )
    }

    if (seenExpertise.has(normalizedItem)) {
      continue
    }

    normalizedExpertise.push(normalizedItem)
    seenExpertise.add(normalizedItem)
  }

  if (normalizedExpertise.length > maxExpertiseCount) {
    return invalidProfileField(
      'expertise',
      `Add at most ${maxExpertiseCount} expertise tags.`,
    )
  }

  return {
    ok: true,
    value: {
      displayName,
      bio,
      avatarUrl,
      bannerUrl,
      expertise: normalizedExpertise,
    },
  }
}

function resolveRepository(
  repositoryFactory: () => UserRepository,
  context: InvocationContext,
):
  | {
      ok: true
      value: UserRepository
    }
  | {
      ok: false
      response: HttpResponseInit
    } {
  try {
    return {
      ok: true,
      value: repositoryFactory(),
    }
  } catch (error) {
    context.log('Failed to configure the user repository.', {
      error:
        error instanceof Error
          ? error.message
          : 'Unknown repository configuration error.',
    })

    return {
      ok: false,
      response: createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The user profile store is not configured.',
      }),
    }
  }
}

export function buildAuthMeHandler(
  dependencies: AuthMeHandlerDependencies = {},
) {
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

    const repositoryResult = resolveRepository(repositoryFactory, context)
    if (!repositoryResult.ok) {
      return repositoryResult.response
    }
    const repository = repositoryResult.value

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

export function buildUpdateProfileHandler(
  dependencies: AuthMeHandlerDependencies = {},
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

    let requestBody: unknown

    try {
      requestBody = await request.json()
    } catch {
      return createErrorResponse(400, {
        code: 'request.invalid_json',
        field: 'body',
        message: 'The profile update payload must be valid JSON.',
      })
    }

    const validation = validateProfileUpdate(requestBody)
    if (!validation.ok) {
      return createErrorResponse(400, validation.error)
    }

    const repositoryResult = resolveRepository(repositoryFactory, context)
    if (!repositoryResult.ok) {
      return repositoryResult.response
    }
    const repository = repositoryResult.value

    try {
      const resolvedUser = await ensureUserForPrincipal(
        principalResult.principal,
        repository,
        now,
      )
      const updatedUser = applyProfileUpdate(
        resolvedUser.user,
        validation.value,
        now(),
      )
      const storedUser = await repository.replace(updatedUser)

      context.log('Updated authenticated profile.', {
        identityProvider: storedUser.identityProvider,
        isNewUser: resolvedUser.isNewUser,
        status: storedUser.status,
        userId: storedUser.id,
      })

      const responsePayload: ResolvedMeProfile = {
        user: toMeProfile(storedUser),
        isNewUser: resolvedUser.isNewUser,
      }

      return createSuccessResponse(responsePayload)
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

export function registerAuthMeFunction() {
  app.http('authMe', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'me',
    handler: authMeHandler,
  })

  app.http('updateProfile', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'me',
    handler: updateProfileHandler,
  })
}
