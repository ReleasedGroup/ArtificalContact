import { CosmosClient, type Container } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { CosmosPostStore } from './cosmos-post-store.js'
import { CosmosUserProfileStore } from './cosmos-user-profile-store.js'
import {
  DEFAULT_FEEDS_CONTAINER_NAME,
  MAX_FANOUT_FOLLOWERS,
  buildFeedEntryDocument,
  buildFeedEntrySource,
  type FeedEntryDocument,
  type FeedStore as FeedFanOutStore,
} from './feed-fanout.js'
import {
  DEFAULT_FEED_PAGE_SIZE,
  type FeedStore as FeedReadStore,
  type StoredFeedDocument,
} from './feed.js'
import { createFollowingListRepository, type FollowingListRepository } from './follows.js'
import { readOptionalValue } from './strings.js'
import type { UserProfileStore } from './user-profile.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

const FOLLOWEE_LOOKUP_BATCH_SIZE = 100
const FOLLOWEE_PROFILE_LOOKUP_CONCURRENCY = 10

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: readonly TInput[],
  concurrencyLimit: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<TOutput>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrencyLimit, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(items[currentIndex]!)
      }
    }),
  )

  return results
}

export class CosmosFeedStore implements FeedFanOutStore, FeedReadStore {
  constructor(
    private readonly container: Container,
    private readonly followingRepository: FollowingListRepository,
    private readonly userProfileStore: UserProfileStore,
    private readonly postStore: CosmosPostStore,
  ) {}

  static fromEnvironment(client?: CosmosClient): CosmosFeedStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClient(config)
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const feedsContainerName =
      readOptionalValue(process.env.FEEDS_CONTAINER_NAME) ??
      DEFAULT_FEEDS_CONTAINER_NAME

    return new CosmosFeedStore(
      resolvedClient.database(databaseName).container(feedsContainerName),
      createFollowingListRepository(),
      CosmosUserProfileStore.fromEnvironment(resolvedClient),
      CosmosPostStore.fromEnvironment(resolvedClient),
    )
  }

  async upsertFeedEntry(document: FeedEntryDocument): Promise<void> {
    await this.container.items.upsert(document)
  }

  async listFeedEntries(
    feedOwnerId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    entries: StoredFeedDocument[]
    cursor?: string
  }> {
    try {
      const queryIterator = this.container.items.query<StoredFeedDocument>(
        {
          query: `
            SELECT * FROM c
            WHERE c.feedOwnerId = @feedOwnerId
            ORDER BY c.createdAt DESC
          `,
          parameters: [{ name: '@feedOwnerId', value: feedOwnerId }],
        },
        {
          partitionKey: feedOwnerId,
          maxItemCount: options.limit || DEFAULT_FEED_PAGE_SIZE,
          enableQueryControl: true,
          ...(options.cursor === undefined
            ? {}
            : { continuationToken: options.cursor }),
        },
      )

      const { resources, continuationToken } = await queryIterator.fetchNext()

      return {
        entries: resources ?? [],
        ...(continuationToken === undefined
          ? {}
          : { cursor: continuationToken }),
      }
    } catch {
      return {
        entries: [],
      }
    }
  }

  async listPullOnReadFeedEntries(
    feedOwnerId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    entries: StoredFeedDocument[]
    cursor?: string
  }> {
    try {
      const celebrityFolloweeIds =
        await this.listCelebrityFolloweeIdsByFeedOwnerId(feedOwnerId)
      const authorIds = [...new Set([feedOwnerId, ...celebrityFolloweeIds])]

      const page = await this.postStore.listRootPostsByAuthorIds(
        authorIds,
        options,
      )

      return {
        entries: page.posts
          .map((post) => {
            const source = buildFeedEntrySource(post)
            return source === null
              ? null
              : buildFeedEntryDocument(feedOwnerId, source)
          })
          .filter((entry): entry is FeedEntryDocument => entry !== null),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      }
    } catch {
      return {
        entries: [],
      }
    }
  }

  private async listCelebrityFolloweeIdsByFeedOwnerId(
    feedOwnerId: string,
  ): Promise<string[]> {
    const followedIds: string[] = []
    let continuationToken: string | undefined

    do {
      const page = await this.followingRepository.listByFollowerId(feedOwnerId, {
        limit: FOLLOWEE_LOOKUP_BATCH_SIZE,
        ...(continuationToken === undefined ? {} : { continuationToken }),
      })

      followedIds.push(...page.follows.map((follow) => follow.followedId))
      continuationToken = page.continuationToken
    } while (continuationToken !== undefined)

    if (followedIds.length === 0) {
      return []
    }

    const profiles = await mapWithConcurrencyLimit(
      followedIds,
      FOLLOWEE_PROFILE_LOOKUP_CONCURRENCY,
      async (followedId) => this.userProfileStore.getUserById(followedId),
    )

    return followedIds.filter((_followedId, index) => {
      const followerCount = profiles[index]?.counters?.followers
      return (
        typeof followerCount === 'number' &&
        Number.isFinite(followerCount) &&
        followerCount > MAX_FANOUT_FOLLOWERS
      )
    })
  }
}
