import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createJsonEnvelopeResponse,
} from '../lib/api-envelope.js'
import {
  lookupAdminMetrics,
  parseAdminMetricsRange,
  type AdminMetricsReadStore,
} from '../lib/admin-metrics.js'
import { CosmosAdminMetricsStore } from '../lib/cosmos-admin-metrics-store.js'
import { withHttpAuth } from '../lib/http-auth.js'
import { createUserRepository, type UserRepository } from '../lib/users.js'

export interface GetAdminMetricsHandlerDependencies {
  now?: () => Date
  repositoryFactory?: () => UserRepository
  storeFactory?: () => AdminMetricsReadStore
}

let cachedStore: CosmosAdminMetricsStore | undefined

function getStore(): CosmosAdminMetricsStore {
  cachedStore ??= CosmosAdminMetricsStore.fromEnvironment()
  return cachedStore
}

export function buildGetAdminMetricsHandler(
  dependencies: GetAdminMetricsHandlerDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  async function getAdminMetricsHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const range = parseAdminMetricsRange(request.query.get('range') ?? undefined)
    if (range === null) {
      return createErrorResponse(400, {
        code: 'invalid_range',
        message: "The range query parameter must be one of '24h', '7d', or '30d'.",
        field: 'range',
      })
    }

    let store: AdminMetricsReadStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the admin metrics store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown admin metrics configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The admin metrics store is not configured.',
      })
    }

    const authenticatedUser = context.auth?.user
    if (!authenticatedUser) {
      return createErrorResponse(500, {
        code: 'server.auth_context_missing',
        message: 'The authenticated user context was not available.',
      })
    }

    try {
      const result = await lookupAdminMetrics(range, store, now)

      context.log('Admin metrics lookup completed.', {
        adminUserId: authenticatedUser.id,
        posts: result.body.data?.summary.posts.value ?? 0,
        range,
        registrations: result.body.data?.summary.registrations.value ?? 0,
        reports: result.body.data?.summary.reports.value ?? 0,
        status: result.status,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load admin metrics.', {
        adminUserId: authenticatedUser.id,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown admin metrics lookup error.',
        range,
      })

      return createErrorResponse(500, {
        code: 'server.admin_metrics_lookup_failed',
        message: 'Unable to load admin metrics.',
      })
    }
  }

  return withHttpAuth(getAdminMetricsHandler, {
    requiredRoles: ['admin'],
    repositoryFactory,
  })
}

export const getAdminMetricsHandler = buildGetAdminMetricsHandler()

export function registerGetAdminMetricsFunction() {
  app.http('getAdminMetrics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'admin/metrics',
    handler: getAdminMetricsHandler,
  })
}
