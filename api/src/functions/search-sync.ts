import { app, type InvocationContext } from '@azure/functions'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
  DEFAULT_USERS_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'
import {
  DEFAULT_POSTS_CONTAINER_NAME,
  type StoredPostDocument,
} from '../lib/posts.js'
import { syncSearchPostsBatch, syncSearchUsersBatch } from '../lib/search-sync.js'
import { AzureSearchStore } from '../lib/azure-search-store.js'
import type { UserDocument } from '../lib/users.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedSearchStore: AzureSearchStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getSearchStore(): AzureSearchStore {
  cachedSearchStore ??= AzureSearchStore.fromEnvironment()
  return cachedSearchStore
}

export async function searchSyncPostsFn(
  documents: StoredPostDocument[],
  context: InvocationContext,
): Promise<void> {
  await syncSearchPostsBatch(documents, getSearchStore(), context)
}

export async function searchSyncUsersFn(
  documents: UserDocument[],
  context: InvocationContext,
): Promise<void> {
  await syncSearchUsersBatch(documents, getSearchStore(), context)
}

export function registerSearchSyncFunctions() {
  app.cosmosDB<StoredPostDocument>('searchSyncPostsFn', {
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
    leaseContainerPrefix: 'searchSyncPosts',
    createLeaseContainerIfNotExists: true,
    handler: searchSyncPostsFn,
  })

  app.cosmosDB<UserDocument>('searchSyncUsersFn', {
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
    leaseContainerPrefix: 'searchSyncUsers',
    createLeaseContainerIfNotExists: true,
    handler: searchSyncUsersFn,
  })
}
