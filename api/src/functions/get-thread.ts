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
import { CosmosThreadStore } from '../lib/cosmos-thread-store.js'
import { lookupThread, type ThreadStore } from '../lib/thread.js'

let cachedStore: CosmosThreadStore | undefined

function getStore(): CosmosThreadStore {
  cachedStore ??= CosmosThreadStore.fromEnvironment()
  return cachedStore
}

export function buildGetThreadHandler(
  storeFactory: () => ThreadStore = getStore,
) {
  return async function getThreadHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let store: ThreadStore

    try {
      store = storeFactory()
    } catch (error) {
      context.log('Failed to configure the thread store.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown thread store configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The thread store is not configured.',
      })
    }

    try {
      const result = await lookupThread(
        {
          threadId: request.params.threadId,
          limit: request.query.get('limit') ?? undefined,
          continuationToken:
            request.query.get('continuationToken') ?? undefined,
        },
        store,
      )

      context.log('Thread lookup completed.', {
        continuationTokenPresent:
          (result.body.data?.continuationToken ?? null) !== null,
        status: result.status,
        threadId: request.params.threadId ?? null,
      })

      return createJsonEnvelopeResponse(result.status, result.body)
    } catch (error) {
      context.log('Failed to load the requested thread.', {
        error:
          error instanceof Error ? error.message : 'Unknown thread lookup error.',
        threadId: request.params.threadId ?? null,
      })

      return createErrorResponse(500, {
        code: 'server.thread_lookup_failed',
        message: 'Unable to load the requested thread.',
      })
    }
  }
}

export const getThreadHandler = buildGetThreadHandler()

export function registerGetThreadFunction() {
  app.http('getThread', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'threads/{threadId}',
    handler: getThreadHandler,
  })
}
