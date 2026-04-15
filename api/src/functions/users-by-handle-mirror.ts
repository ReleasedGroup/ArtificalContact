import { app, type InvocationContext } from '@azure/functions'
import { CosmosUsersByHandleMirrorStore } from '../lib/cosmos-users-by-handle-mirror-store.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
  DEFAULT_USERS_CONTAINER_NAME,
  syncUsersByHandleBatch,
  type UserDocument,
} from '../lib/users-by-handle-mirror.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedStore: CosmosUsersByHandleMirrorStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getStore(): CosmosUsersByHandleMirrorStore {
  cachedStore ??= CosmosUsersByHandleMirrorStore.fromEnvironment()
  return cachedStore
}

export async function usersByHandleMirrorFn(
  documents: UserDocument[],
  context: InvocationContext,
): Promise<void> {
  await syncUsersByHandleBatch(documents, getStore(), context)
}

export function registerUsersByHandleMirrorFunction() {
  app.cosmosDB<UserDocument>('usersByHandleMirrorFn', {
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
    leaseContainerPrefix: 'usersByHandleMirror',
    createLeaseContainerIfNotExists: true,
    handler: usersByHandleMirrorFn,
  })
}
