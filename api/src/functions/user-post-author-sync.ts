import { app, type InvocationContext } from '@azure/functions'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
  DEFAULT_USERS_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'
import { syncUserPostAuthorDenormalizationsBatch } from '../lib/user-post-author-sync.js'
import type { UserDocument } from '../lib/users.js'

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

export async function userPostAuthorSyncFn(
  documents: UserDocument[],
  context: InvocationContext,
): Promise<void> {
  await syncUserPostAuthorDenormalizationsBatch(documents, getStore(), context)
}

export function registerUserPostAuthorSyncFunction() {
  app.cosmosDB<UserDocument>('userPostAuthorSyncFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.USERS_CONTAINER_NAME) ??
      DEFAULT_USERS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'userPostAuthorSync',
    createLeaseContainerIfNotExists: true,
    handler: userPostAuthorSyncFn,
  })
}
