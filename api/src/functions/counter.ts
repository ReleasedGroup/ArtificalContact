import { app, type InvocationContext } from '@azure/functions'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { DEFAULT_POSTS_CONTAINER_NAME } from '../lib/posts.js'
import {
  syncReplyCountersBatch,
  type ReplyCounterSourceDocument,
  type ReplyCounterStore,
} from '../lib/reply-counter.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedStore: CosmosPostStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getStore(): CosmosPostStore {
  cachedStore ??= CosmosPostStore.fromEnvironment()
  return cachedStore
}

export interface CounterFunctionDependencies {
  storeFactory?: () => ReplyCounterStore
}

export function buildCounterFn(dependencies: CounterFunctionDependencies = {}) {
  const storeFactory = dependencies.storeFactory ?? getStore

  return async function counterFn(
    documents: ReplyCounterSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncReplyCountersBatch(documents, storeFactory(), context)
  }
}

export const counterFn = buildCounterFn()

export function registerCounterFunction() {
  app.cosmosDB<ReplyCounterSourceDocument>('counterFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
      DEFAULT_POSTS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'counter',
    createLeaseContainerIfNotExists: true,
    handler: counterFn,
  })
}
