import { CosmosClient, type Container } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { CosmosPostStore } from './cosmos-post-store.js'
import {
  DEFAULT_FEEDS_CONTAINER_NAME,
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
import {
  applyKeysetPagination,
  type KeysetCursorState,
} from './keyset-pagination.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

function isCosmosNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const statusCode = (error as Error & { statusCode?: number }).statusCode
  const code = (error as Error & { code?: number | string }).code
  return statusCode === 404 || code === 404
}

const FOLLOWEE_LOOKUP_BATCH_SIZE = 100
export const MAX_PULL_ON_READ_FOLLOWEES = 250
const FEED_ENTRY_CURSOR_PREFIX = 'ac.feed.entries.v1:'

export class CosmosFeedStore implements FeedFanOutStore, FeedReadStore {
  constructor(
    private readonly container: Container,
    private readonly followingRepository: FollowingListRepository,
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
      const { resources } = await this.container.items
        .query<StoredFeedDocument>(
          {
            query: 'SELECT * FROM c',
          },
          {
            partitionKey: feedOwnerId,
          },
        )
        .fetchAll()
      const page = applyKeysetPagination(resources ?? [], {
        limit: options.limit || DEFAULT_FEED_PAGE_SIZE,
        prefix: FEED_ENTRY_CURSOR_PREFIX,
        resolveCursorState: resolveFeedDocumentCursorState,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      })

      return {
        entries: page.items,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      }
    } catch (error) {
      if (isCosmosNotFound(error)) {
        return { entries: [] }
      }

      throw error
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
      const followeeIds = await this.listFolloweeIdsByFeedOwnerId(feedOwnerId)
      const authorIds = [...new Set([feedOwnerId, ...followeeIds])]

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
    } catch (error) {
      if (isCosmosNotFound(error)) {
        return { entries: [] }
      }

      throw error
    }
  }

  async hydrateFeedEntries(
    entries: readonly StoredFeedDocument[],
  ): Promise<StoredFeedDocument[]> {
    const postIds = [
      ...new Set(
        entries
          .map((entry) => readOptionalValue(entry.postId))
          .filter((postId): postId is string => postId !== undefined),
      ),
    ]

    if (postIds.length === 0) {
      return [...entries]
    }

    const canonicalPosts = await this.postStore.listPostsByIds(postIds)
    const canonicalPostsById = new Map(
      canonicalPosts.map((post) => [post.id, post] as const),
    )

    return entries.flatMap((entry) => {
      const canonicalPost = canonicalPostsById.get(entry.postId)
      if (canonicalPost === undefined) {
        return [entry]
      }

      const source = buildFeedEntrySource(canonicalPost)
      if (source === null) {
        return []
      }

      return [buildFeedEntryDocument(entry.feedOwnerId, source)]
    })
  }

  private async listFolloweeIdsByFeedOwnerId(
    feedOwnerId: string,
    maxFollowees = MAX_PULL_ON_READ_FOLLOWEES,
  ): Promise<string[]> {
    if (maxFollowees <= 0) {
      return []
    }

    const followedIds: string[] = []
    const seenFollowedIds = new Set<string>()
    let continuationToken: string | undefined

    do {
      const page = await this.followingRepository.listByFollowerId(feedOwnerId, {
        limit: FOLLOWEE_LOOKUP_BATCH_SIZE,
        ...(continuationToken === undefined ? {} : { continuationToken }),
      })

      for (const follow of page.follows) {
        if (seenFollowedIds.has(follow.followedId)) {
          continue
        }

        seenFollowedIds.add(follow.followedId)
        followedIds.push(follow.followedId)

        if (followedIds.length >= maxFollowees) {
          break
        }
      }

      continuationToken = page.continuationToken
    } while (
      continuationToken !== undefined &&
      followedIds.length < maxFollowees
    )

    if (followedIds.length === 0) {
      return []
    }

    return followedIds
  }
}

function resolveFeedDocumentCursorState(
  document: StoredFeedDocument,
): KeysetCursorState | null {
  const createdAt = readOptionalValue(document.createdAt)
  const id = readOptionalValue(document.id)

  if (createdAt === undefined || id === undefined) {
    return null
  }

  return {
    createdAt,
    id,
  }
}
