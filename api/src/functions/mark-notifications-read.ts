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
import { withHttpAuth } from '../lib/http-auth.js'
import {
  applyNotificationRead,
  buildMarkNotificationsReadRequestSchema,
  createNotificationRepository,
  mapMarkNotificationsReadValidationIssues,
  type NotificationRepository,
} from '../lib/notifications.js'

export interface MarkNotificationsReadHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => NotificationRepository
}

interface MarkNotificationsReadResponse {
  read: {
    scope: 'all' | 'single'
    notificationId: string | null
    updatedCount: number
  }
}

const NOTIFICATION_READ_UPSERT_BATCH_SIZE = 25

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export function buildMarkNotificationsReadHandler(
  dependencies: MarkNotificationsReadHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createNotificationRepository())
  const requestSchema = buildMarkNotificationsReadRequestSchema()

  return async function markNotificationsReadHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user

    if (!authenticatedUser || authenticatedUser.status !== 'active') {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before marking notifications as read.',
      })
    }

    let repository: NotificationRepository

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the notification repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The notification store is not configured.',
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

    const parsedBody = requestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapMarkNotificationsReadValidationIssues(
          parsedBody.error.issues,
        ),
      })
    }

    const operationTime = now()

    try {
      if (parsedBody.data.scope === 'single') {
        const existingNotification = await repository.getByTargetUserAndId(
          authenticatedUser.id,
          parsedBody.data.notificationId,
        )

        let updatedCount = 0

        if (existingNotification !== null) {
          const mutation = applyNotificationRead(
            existingNotification,
            operationTime,
          )

          if (mutation.changed) {
            await repository.upsert(mutation.notification)
            updatedCount = 1
          }
        }

        const responseBody: MarkNotificationsReadResponse = {
          read: {
            scope: 'single',
            notificationId: parsedBody.data.notificationId,
            updatedCount,
          },
        }

        context.log('Processed notification read request.', {
          actorId: authenticatedUser.id,
          notificationId: parsedBody.data.notificationId,
          scope: 'single',
          updatedCount,
        })

        return createSuccessResponse(responseBody)
      }

      const unreadNotifications = await repository.listUnreadByTargetUserId(
        authenticatedUser.id,
      )

      let updatedCount = 0

      for (const notificationBatch of chunkArray(
        unreadNotifications,
        NOTIFICATION_READ_UPSERT_BATCH_SIZE,
      )) {
        const batchCounts: number[] = await Promise.all(
          notificationBatch.map(async (notification) => {
            const mutation = applyNotificationRead(notification, operationTime)
            if (!mutation.changed) {
              return 0
            }

            await repository.upsert(mutation.notification)
            return 1
          }),
        )

        updatedCount += batchCounts.reduce((total, count) => total + count, 0)
      }

      const responseBody: MarkNotificationsReadResponse = {
        read: {
          scope: 'all',
          notificationId: null,
          updatedCount,
        },
      }

      context.log('Processed notification read request.', {
        actorId: authenticatedUser.id,
        notificationId: null,
        scope: 'all',
        updatedCount,
      })

      return createSuccessResponse(responseBody)
    } catch (error) {
      context.log('Failed to mark notifications as read.', {
        actorId: authenticatedUser.id,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown notification read error.',
        scope: parsedBody.data.scope,
      })

      return createErrorResponse(500, {
        code: 'server.notification_read_failed',
        message: 'Unable to mark notifications as read.',
      })
    }
  }
}

export const markNotificationsReadHandler = withHttpAuth(
  buildMarkNotificationsReadHandler(),
)

export function registerMarkNotificationsReadFunction() {
  app.http('markNotificationsRead', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'notifications/read',
    handler: markNotificationsReadHandler,
  })
}
