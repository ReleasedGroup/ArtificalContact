import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createJsonEnvelopeResponse,
  type ApiError,
} from '../lib/api-envelope.js'
import { CosmosNotificationStore } from '../lib/cosmos-notification-store.js'
import {
  lookupNotifications,
  type NotificationReadStore,
} from '../lib/notifications.js'
import { withHttpAuth } from '../lib/http-auth.js'

export interface GetNotificationsHandlerDependencies {
  storeFactory?: () => NotificationReadStore
}

let cachedStore: CosmosNotificationStore | undefined

function getStore(): CosmosNotificationStore {
  cachedStore ??= CosmosNotificationStore.fromEnvironment()
  return cachedStore
}

function createNotificationsErrorResponse(
  status: number,
  error: ApiError,
): HttpResponseInit {
  return createJsonEnvelopeResponse(status, {
    data: null,
    cursor: null,
    errors: [error],
  })
}

export function buildGetNotificationsHandler(
  dependencies: GetNotificationsHandlerDependencies = {},
) {
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  return async function getNotificationsHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user

    if (!authenticatedUser) {
      return createNotificationsErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have a provisioned profile before reading notifications.',
      })
    }

    let store: NotificationReadStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the notifications store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown notifications store configuration error.',
      })

      return createNotificationsErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The notifications store is not configured.',
      })
    }

    try {
      const result = await lookupNotifications(
        {
          targetUserId: authenticatedUser.id,
          limit: request.query.get('limit') ?? undefined,
          cursor: request.query.get('cursor') ?? undefined,
        },
        store,
      )

      context.log('Notifications lookup completed.', {
        cursorPresent: (result.body.cursor ?? null) !== null,
        notificationCount: result.body.data?.notifications.length ?? 0,
        status: result.status,
        unreadCount: result.body.data?.unreadCount ?? 0,
        userId: authenticatedUser.id,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the authenticated notifications.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown notifications lookup error.',
        userId: authenticatedUser.id,
      })

      return createNotificationsErrorResponse(500, {
        code: 'server.notifications_lookup_failed',
        message: "Unable to load the authenticated user's notifications.",
      })
    }
  }
}

export const getNotificationsHandler = withHttpAuth(
  buildGetNotificationsHandler(),
)

export function registerGetNotificationsFunction() {
  app.http('getNotifications', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'notifications',
    handler: getNotificationsHandler,
  })
}
