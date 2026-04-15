import { app, type InvocationContext } from '@azure/functions'
import { CosmosFollowersMirrorStore } from '../lib/cosmos-followers-mirror-store.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from '../lib/follows.js'
import {
  syncFollowersMirrorBatch,
  type FollowersMirrorSourceDocument,
  type FollowersMirrorStore,
} from '../lib/followers-mirror.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedStore: CosmosFollowersMirrorStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getStore(): CosmosFollowersMirrorStore {
  cachedStore ??= CosmosFollowersMirrorStore.fromEnvironment()
  return cachedStore
}

export interface FollowersMirrorFunctionDependencies {
  storeFactory?: () => FollowersMirrorStore
}

export function buildFollowersMirrorFn(
  dependencies: FollowersMirrorFunctionDependencies = {},
) {
  const storeFactory = dependencies.storeFactory ?? getStore

  return async function followersMirrorFn(
    documents: FollowersMirrorSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncFollowersMirrorBatch(documents, storeFactory(), context)
  }
}

export const followersMirrorFn = buildFollowersMirrorFn()

export function registerFollowersMirrorFunction() {
  app.cosmosDB<FollowersMirrorSourceDocument>('followersMirrorFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.FOLLOWS_CONTAINER_NAME) ??
      DEFAULT_FOLLOWS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'followersMirror',
    createLeaseContainerIfNotExists: true,
    handler: followersMirrorFn,
  })
}
