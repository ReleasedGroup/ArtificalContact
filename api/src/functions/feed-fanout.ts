import { app, type InvocationContext } from '@azure/functions'
import { CosmosFeedStore } from '../lib/cosmos-feed-store.js'
import { CosmosFollowersMirrorStore } from '../lib/cosmos-followers-mirror-store.js'
import {
  syncFeedFanOutBatch,
  type FeedFanOutSourceDocument,
  type FeedStore,
  type FollowersFeedSourceStore,
} from '../lib/feed-fanout.js'
import { DEFAULT_POSTS_CONTAINER_NAME } from '../lib/posts.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedFollowersStore: CosmosFollowersMirrorStore | undefined
let cachedFeedStore: CosmosFeedStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getFollowersStore(): CosmosFollowersMirrorStore {
  cachedFollowersStore ??= CosmosFollowersMirrorStore.fromEnvironment()
  return cachedFollowersStore
}

function getFeedStore(): CosmosFeedStore {
  cachedFeedStore ??= CosmosFeedStore.fromEnvironment()
  return cachedFeedStore
}

export interface FeedFanOutFunctionDependencies {
  feedStoreFactory?: () => FeedStore
  followersStoreFactory?: () => FollowersFeedSourceStore
}

export function buildFeedFanOutFn(
  dependencies: FeedFanOutFunctionDependencies = {},
) {
  const followersStoreFactory =
    dependencies.followersStoreFactory ?? getFollowersStore
  const feedStoreFactory = dependencies.feedStoreFactory ?? getFeedStore

  return async function feedFanOutFn(
    documents: FeedFanOutSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncFeedFanOutBatch(
      documents,
      followersStoreFactory(),
      feedStoreFactory(),
      context,
    )
  }
}

export const feedFanOutFn = buildFeedFanOutFn()

export function registerFeedFanOutFunction() {
  app.cosmosDB<FeedFanOutSourceDocument>('feedFanOutFn', {
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
    leaseContainerPrefix: 'feedFanOut',
    createLeaseContainerIfNotExists: true,
    handler: feedFanOutFn,
  })
}
