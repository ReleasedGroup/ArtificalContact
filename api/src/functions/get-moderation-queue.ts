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
import { CosmosModerationQueueStore } from '../lib/cosmos-moderation-queue-store.js'
import {
  lookupModerationQueue,
  type ModerationQueueReadStore,
} from '../lib/moderation-queue.js'
import { withHttpAuth } from '../lib/http-auth.js'
import { createUserRepository, type UserRepository } from '../lib/users.js'

export interface GetModerationQueueHandlerDependencies {
  repositoryFactory?: () => UserRepository
  storeFactory?: () => ModerationQueueReadStore
}

let cachedStore: CosmosModerationQueueStore | undefined

function getStore(): CosmosModerationQueueStore {
  cachedStore ??= CosmosModerationQueueStore.fromEnvironment()
  return cachedStore
}

export function buildGetModerationQueueHandler(
  dependencies: GetModerationQueueHandlerDependencies = {},
) {
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createUserRepository())
  const storeFactory = dependencies.storeFactory ?? (() => getStore())

  async function getModerationQueueHandler(
    _request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let store: ModerationQueueReadStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the moderation queue store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown moderation queue store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The moderation queue store is not configured.',
      })
    }

    const authenticatedUser = context.auth?.user
    if (authenticatedUser === null || authenticatedUser === undefined) {
      return createErrorResponse(500, {
        code: 'server.auth_context_missing',
        message: 'The authenticated user context was not available.',
      })
    }

    try {
      const result = await lookupModerationQueue(store)

      context.log('Moderation queue lookup completed.', {
        moderatorUserId: authenticatedUser.id,
        openCount: result.body.data?.counts.open ?? 0,
        status: result.status,
        triagedCount: result.body.data?.counts.triaged ?? 0,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the moderation queue.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown moderation queue lookup error.',
        moderatorUserId: authenticatedUser.id,
      })

      return createErrorResponse(500, {
        code: 'server.moderation_queue_lookup_failed',
        message: 'Unable to load the moderation queue.',
      })
    }
  }

  return withHttpAuth(getModerationQueueHandler, {
    requiredRoles: ['moderator'],
    repositoryFactory,
  })
}

export const getModerationQueueHandler = buildGetModerationQueueHandler()

export function registerGetModerationQueueFunction() {
  app.http('getModerationQueue', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'mod/queue',
    handler: getModerationQueueHandler,
  })
}
