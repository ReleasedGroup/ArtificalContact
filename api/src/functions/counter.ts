import { app, type InvocationContext } from '@azure/functions'
import { CosmosFollowersMirrorStore } from '../lib/cosmos-followers-mirror-store.js'
import { CosmosUserFollowCounterStore } from '../lib/cosmos-user-follow-counter-store.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import {
  syncFollowCountersBatch,
  type FollowCounterSourceDocument,
  type FollowCounterStore,
} from '../lib/follow-counter.js'
import {
  syncFollowersMirrorBatch,
  type FollowersMirrorStore,
} from '../lib/followers-mirror.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from '../lib/follows.js'
import { DEFAULT_POSTS_CONTAINER_NAME } from '../lib/posts.js'
import {
  syncReactionCountersBatch,
  type ReactionCounterSourceDocument,
  type ReactionCounterStore,
} from '../lib/reaction-counter.js'
import { DEFAULT_REACTIONS_CONTAINER_NAME } from '../lib/reactions.js'
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

let cachedCounterStore: CosmosPostStore | undefined
let cachedFollowCounterStore: CosmosUserFollowCounterStore | undefined
let cachedFollowersMirrorStore: CosmosFollowersMirrorStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getStore(): CosmosPostStore {
  cachedCounterStore ??= CosmosPostStore.fromEnvironment()
  return cachedCounterStore
}

function getFollowStore(): CosmosUserFollowCounterStore {
  cachedFollowCounterStore ??= CosmosUserFollowCounterStore.fromEnvironment()
  return cachedFollowCounterStore
}

function getFollowersMirrorStore(): CosmosFollowersMirrorStore {
  cachedFollowersMirrorStore ??= CosmosFollowersMirrorStore.fromEnvironment()
  return cachedFollowersMirrorStore
}

export interface CounterFunctionDependencies {
  storeFactory?: () => ReplyCounterStore
  replyStoreFactory?: () => ReplyCounterStore
  reactionStoreFactory?: () => ReactionCounterStore
  followStoreFactory?: () => FollowCounterStore
  followersMirrorStoreFactory?: () => FollowersMirrorStore
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
  const followersMirrorStoreFactory =
    dependencies.followersMirrorStoreFactory ?? getFollowersMirrorStore

  return async function followCounterFn(
    documents: FollowCounterSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncFollowersMirrorBatch(
      documents,
      followersMirrorStoreFactory(),
      context,
    )
    await syncFollowCountersBatch(documents, storeFactory(), context)
  }
}

export function buildReactionCounterFn(
  dependencies: CounterFunctionDependencies = {},
) {
  const storeFactory = dependencies.reactionStoreFactory ?? getStore

  return async function reactionCounterFn(
    documents: ReactionCounterSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncReactionCountersBatch(documents, storeFactory(), context)
  }
}

export const counterFn = buildCounterFn()
export const followCounterFn = buildFollowCounterFn()
export const reactionCounterFn = buildReactionCounterFn()

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

  app.cosmosDB<ReactionCounterSourceDocument>('reactionCounterFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.REACTIONS_CONTAINER_NAME) ??
      DEFAULT_REACTIONS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'reactionCounter',
    createLeaseContainerIfNotExists: true,
    handler: reactionCounterFn,
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
