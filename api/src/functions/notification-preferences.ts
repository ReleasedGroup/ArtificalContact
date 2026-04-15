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
import {
  CosmosNotificationPreferenceStore,
  type NotificationPreferenceStore,
} from '../lib/cosmos-notification-preference-store.js'
import {
  applyNotificationPreferencesUpdate,
  buildDefaultNotificationPreferences,
  mapNotificationPreferenceValidationIssues,
  toNotificationPreferencesView,
  updateNotificationPreferencesRequestSchema,
} from '../lib/notification-preferences.js'

export interface NotificationPreferencesHandlerDependencies {
  now?: () => Date
  storeFactory?: () => NotificationPreferenceStore
}

let cachedStore: CosmosNotificationPreferenceStore | undefined

function getStore(): CosmosNotificationPreferenceStore {
  cachedStore ??= CosmosNotificationPreferenceStore.fromEnvironment()
  return cachedStore
}

function resolveStore(
  storeFactory: () => NotificationPreferenceStore,
  context: InvocationContext,
): NotificationPreferenceStore | null {
  try {
    return storeFactory()
  } catch (error) {
    context.log('Failed to configure the notification preference store.', {
      error:
        error instanceof Error
          ? error.message
          : 'Unknown notification preference store configuration error.',
    })

    return null
  }
}

export function buildGetNotificationPreferencesHandler(
  dependencies: NotificationPreferencesHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function getNotificationPreferencesHandler(
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

    const store = resolveStore(storeFactory, context)
    if (store === null) {
      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The notification preference store is not configured.',
      })
    }

    try {
      const document =
        (await store.getByUserId(principalResult.principal.subject)) ??
        buildDefaultNotificationPreferences(
          principalResult.principal.subject,
          now(),
        )

      return createSuccessResponse({
        preferences: toNotificationPreferencesView(document),
      })
    } catch (error) {
      context.log('Failed to load notification preferences.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown notification preference lookup error.',
        userId: principalResult.principal.subject,
      })

      return createErrorResponse(500, {
        code: 'server.notification_preferences_lookup_failed',
        message: 'Unable to load notification preferences.',
      })
    }
  }
}

export function buildUpdateNotificationPreferencesHandler(
  dependencies: NotificationPreferencesHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function updateNotificationPreferencesHandler(
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

    const store = resolveStore(storeFactory, context)
    if (store === null) {
      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The notification preference store is not configured.',
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

    const parsedBody =
      updateNotificationPreferencesRequestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapNotificationPreferenceValidationIssues(
          parsedBody.error.issues,
        ),
      })
    }

    try {
      const timestamp = now()
      const existingDocument =
        (await store.getByUserId(principalResult.principal.subject)) ??
        buildDefaultNotificationPreferences(
          principalResult.principal.subject,
          timestamp,
        )

      const persistedDocument = await store.upsert(
        applyNotificationPreferencesUpdate(
          existingDocument,
          parsedBody.data,
          timestamp,
        ),
      )

      return createSuccessResponse({
        preferences: toNotificationPreferencesView(persistedDocument),
      })
    } catch (error) {
      context.log('Failed to update notification preferences.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown notification preference update error.',
        userId: principalResult.principal.subject,
      })

      return createErrorResponse(500, {
        code: 'server.notification_preferences_update_failed',
        message: 'Unable to update notification preferences.',
      })
    }
  }
}

export const getNotificationPreferencesHandler =
  buildGetNotificationPreferencesHandler()
export const updateNotificationPreferencesHandler =
  buildUpdateNotificationPreferencesHandler()

export function registerNotificationPreferencesFunctions() {
  app.http('getNotificationPreferences', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'me/notifications',
    handler: getNotificationPreferencesHandler,
  })

  app.http('updateNotificationPreferences', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'me/notifications',
    handler: updateNotificationPreferencesHandler,
  })
}
