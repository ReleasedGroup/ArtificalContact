import { app, type InvocationContext } from '@azure/functions'
import { CosmosUserFollowCounterStore } from '../lib/cosmos-user-follow-counter-store.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import {
  syncFollowCountersBatch,
  type FollowCounterSourceDocument,
  type FollowCounterStore,
} from '../lib/follow-counter.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from '../lib/follows.js'
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

let cachedReplyCounterStore: CosmosPostStore | undefined
let cachedFollowCounterStore: CosmosUserFollowCounterStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getStore(): CosmosPostStore {
  cachedReplyCounterStore ??= CosmosPostStore.fromEnvironment()
  return cachedReplyCounterStore
}

function getFollowStore(): CosmosUserFollowCounterStore {
  cachedFollowCounterStore ??= CosmosUserFollowCounterStore.fromEnvironment()
  return cachedFollowCounterStore
}

export interface CounterFunctionDependencies {
  storeFactory?: () => ReplyCounterStore
  replyStoreFactory?: () => ReplyCounterStore
  followStoreFactory?: () => FollowCounterStore
}

export function buildCounterFn(dependencies: CounterFunctionDependencies = {}) {
  const storeFactory =
    dependencies.replyStoreFactory ?? dependencies.storeFactory ?? getStore

  return async function counterFn(
    documents: ReplyCounterSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncReplyCountersBatch(documents, storeFactory(), context)
  }
}

export function buildFollowCounterFn(
  dependencies: CounterFunctionDependencies = {},
) {
  const storeFactory = dependencies.followStoreFactory ?? getFollowStore

  return async function followCounterFn(
    documents: FollowCounterSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncFollowCountersBatch(documents, storeFactory(), context)
  }
}

export const counterFn = buildCounterFn()
export const followCounterFn = buildFollowCounterFn()

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

  app.cosmosDB<FollowCounterSourceDocument>('followCounterFn', {
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
    leaseContainerPrefix: 'followCounter',
    createLeaseContainerIfNotExists: true,
    handler: followCounterFn,
  })
}
