import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { createErrorResponse, createSuccessResponse } from '../lib/api-envelope.js'
import {
  loadAdminMetricsSnapshot,
  type AdminMetricsStore,
} from '../lib/admin-metrics.js'
import { createAdminMetricsStore } from '../lib/cosmos-admin-metrics-store.js'
import { withHttpAuth } from '../lib/http-auth.js'

export interface GetAdminMetricsHandlerDependencies {
  now?: () => Date
  storeFactory?: () => AdminMetricsStore
}

export function buildGetAdminMetricsHandler(
  dependencies: GetAdminMetricsHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const storeFactory = dependencies.storeFactory ?? createAdminMetricsStore

  return async function getAdminMetricsHandler(
    _request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    if (!context.auth?.user) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have a provisioned admin profile before reading admin metrics.',
      })
    }

    let store: AdminMetricsStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the admin metrics store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown admin metrics store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The admin metrics store is not configured.',
      })
    }

    try {
      const metrics = await loadAdminMetricsSnapshot(store, now())

      context.log('Loaded admin metrics.', {
        dailyActiveUsers: metrics.dailyActiveUsers,
        queueDepth: metrics.queueDepth.openReports,
        registrations: metrics.registrations.total,
      })

      return createSuccessResponse(metrics)
    } catch (error) {
      context.log('Failed to load admin metrics.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown admin metrics lookup error.',
      })

      return createErrorResponse(500, {
        code: 'server.admin_metrics_lookup_failed',
        message: 'Unable to load the admin metrics.',
      })
    }
  }
}

export const getAdminMetricsHandler = withHttpAuth(
  buildGetAdminMetricsHandler(),
  {
    requiredRoles: ['admin'],
  },
)

export function registerGetAdminMetricsFunction() {
  app.http('getAdminMetrics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'admin/metrics',
    handler: getAdminMetricsHandler,
  })
}
