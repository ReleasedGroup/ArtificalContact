import { CosmosClient, type Container, type SqlQuerySpec } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import {
  applyKeysetPagination,
  type KeysetCursorState,
} from './keyset-pagination.js'
import {
  DEFAULT_POSTS_CONTAINER_NAME,
  type MutablePostStore,
  type PostRepository,
  type StoredPostDocument,
  type UserPostDocument,
} from './posts.js'
import { DEFAULT_REACTIONS_CONTAINER_NAME } from './reactions.js'
import type { ReactionCounterStore } from './reaction-counter.js'
import type { ReplyCounterStore } from './reply-counter.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

type CosmosLikeError = Error & {
  code?: number | string
  statusCode?: number
}

const ROOT_POSTS_CURSOR_PREFIX = 'ac.posts.root.v1:'

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cosmosError = error as CosmosLikeError
  return cosmosError.statusCode === 404 || cosmosError.code === 404
}

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readCursorValue(value: unknown): string | undefined {
  return typeof value === 'string' ? readOptionalValue(value) : undefined
}

function createCosmosClientFromEnvironment(): CosmosClient {
  const config = getEnvironmentConfig()

  if (config.cosmosConnectionString) {
    return new CosmosClient(config.cosmosConnectionString)
  }

  if (!config.cosmosEndpoint) {
    throw new Error(
      'COSMOS_CONNECTION_STRING or COSMOS_CONNECTION__accountEndpoint must be configured.',
    )
  }

  return new CosmosClient({
    endpoint: config.cosmosEndpoint,
    aadCredentials: new DefaultAzureCredential(),
  })
}

export class CosmosPostStore
  implements MutablePostStore, PostRepository, ReplyCounterStore, ReactionCounterStore
{
  constructor(
    private readonly postsContainer: Container,
    private readonly reactionsContainer?: Container,
  ) {}

  static fromEnvironment(client?: CosmosClient): CosmosPostStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const postsContainerName =
      readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
      DEFAULT_POSTS_CONTAINER_NAME
    const reactionsContainerName =
      readOptionalValue(process.env.REACTIONS_CONTAINER_NAME) ??
      DEFAULT_REACTIONS_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosPostStore(
      database.container(postsContainerName),
      database.container(reactionsContainerName),
    )
  }

  async getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null> {
    const normalizedThreadId = readOptionalValue(threadId)
    if (normalizedThreadId) {
      const pointReadResult = await this.readItem(postId, normalizedThreadId)
      if (pointReadResult !== null) {
        return pointReadResult
      }
    }

    return this.queryById(postId)
  }

  async create(post: UserPostDocument): Promise<UserPostDocument> {
    const { resource } =
      await this.postsContainer.items.create<UserPostDocument>(post)
    return resource ?? post
  }

  async listPostsByAuthorId(authorId: string): Promise<StoredPostDocument[]> {
    const querySpec: SqlQuerySpec = {
      query:
        'SELECT * FROM c WHERE c.authorId = @authorId AND c.kind = @kind ORDER BY c.createdAt ASC',
      parameters: [
        { name: '@authorId', value: authorId },
        { name: '@kind', value: 'user' },
      ],
    }
    const { resources } = await this.postsContainer.items
      .query<StoredPostDocument>(querySpec)
      .fetchAll()

    return resources
  }

  async listRootPostsByAuthorIds(
    authorIds: readonly string[],
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    posts: StoredPostDocument[]
    cursor?: string
  }> {
    if (authorIds.length === 0) {
      return {
        posts: [],
      }
    }

    const querySpec: SqlQuerySpec = {
      query: `
        SELECT * FROM c
        WHERE ARRAY_CONTAINS(@authorIds, c.authorId)
          AND c.type = @type
          AND c.kind = @kind
          AND c.threadId = c.id
          AND (NOT IS_DEFINED(c.parentId) OR IS_NULL(c.parentId))
          AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))
          AND (
            NOT IS_DEFINED(c.visibility)
            OR IS_NULL(c.visibility)
            OR c.visibility = @visibility
          )
          AND (
            NOT IS_DEFINED(c.moderationState)
            OR IS_NULL(c.moderationState)
            OR (
              c.moderationState != @hiddenModerationState
              AND c.moderationState != @removedModerationState
            )
          )
      `,
      parameters: [
        { name: '@authorIds', value: [...authorIds] },
        { name: '@type', value: 'post' },
        { name: '@kind', value: 'user' },
        { name: '@visibility', value: 'public' },
        { name: '@hiddenModerationState', value: 'hidden' },
        { name: '@removedModerationState', value: 'removed' },
      ],
    }
    const { resources } = await this.postsContainer.items
      .query<StoredPostDocument>(querySpec)
      .fetchAll()
    const page = applyKeysetPagination(resources ?? [], {
      limit: options.limit,
      prefix: ROOT_POSTS_CURSOR_PREFIX,
      resolveCursorState: resolvePostCursorState,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    })

    return {
      posts: page.items,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    }
  }

  async listPostsByIds(postIds: readonly string[]): Promise<StoredPostDocument[]> {
    const normalizedPostIds: string[] = [
      ...new Set(
        postIds.filter(
          (postId): postId is string => readOptionalValue(postId) !== undefined,
        ),
      ),
    ]

    if (normalizedPostIds.length === 0) {
      return []
    }

    const querySpec: SqlQuerySpec = {
      query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@postIds, c.id)',
      parameters: [{ name: '@postIds', value: normalizedPostIds }],
    }
    const { resources } = await this.postsContainer.items
      .query<StoredPostDocument>(querySpec)
      .fetchAll()

    return resources ?? []
  }

  async countActiveRootPostsByAuthorId(authorId: string): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.authorId = @authorId
          AND c.type = @type
          AND c.kind = @kind
          AND c.threadId = c.id
          AND (NOT IS_DEFINED(c.parentId) OR IS_NULL(c.parentId))
          AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))
          AND (
            NOT IS_DEFINED(c.visibility)
            OR IS_NULL(c.visibility)
            OR c.visibility = @visibility
          )
          AND (
            NOT IS_DEFINED(c.moderationState)
            OR IS_NULL(c.moderationState)
            OR (
              c.moderationState != @hiddenModerationState
              AND c.moderationState != @removedModerationState
            )
          )
      `,
      parameters: [
        { name: '@authorId', value: authorId },
        { name: '@type', value: 'post' },
        { name: '@kind', value: 'user' },
        { name: '@visibility', value: 'public' },
        { name: '@hiddenModerationState', value: 'hidden' },
        { name: '@removedModerationState', value: 'removed' },
      ],
    }
    const { resources } = await this.postsContainer.items
      .query<number>(querySpec, {
        maxItemCount: 1,
      })
      .fetchAll()

    return resources[0] ?? 0
  }

  async upsertPost(post: StoredPostDocument): Promise<StoredPostDocument> {
    const { resource } =
      await this.postsContainer.items.upsert<StoredPostDocument>(post)

    return resource ?? post
  }

  async setReplyCount(
    postId: string,
    threadId: string,
    replyCount: number,
  ): Promise<void> {
    try {
      await this.postsContainer.item(postId, threadId).patch([
        {
          op: 'set',
          path: '/counters/replies',
          value: replyCount,
        },
      ])
    } catch (error) {
      if (!isBadRequest(error)) {
        throw error
      }

      await this.postsContainer.item(postId, threadId).patch([
        {
          op: 'set',
          path: '/counters',
          value: {
            replies: replyCount,
          },
        },
      ])
    }
  }

  async getReactionSummary(postId: string): Promise<{
    likes: number
    dislikes: number
    emoji: number
  }> {
    const querySpec: SqlQuerySpec = {
      query:
        'SELECT c.sentiment, c.emojiValues FROM c WHERE c.postId = @postId AND c.type = @type',
      parameters: [
        { name: '@postId', value: postId },
        { name: '@type', value: 'reaction' },
      ],
    }
    const queryIterator = this.getReactionsContainer().items.query<{
      sentiment?: string | null
      emojiValues?: string[] | null
    }>(querySpec, {
      partitionKey: postId,
    })

    let likes = 0
    let dislikes = 0
    let emoji = 0

    while (queryIterator.hasMoreResults()) {
      const { resources } = await queryIterator.fetchNext()

      for (const reaction of resources) {
        if (reaction.sentiment === 'like') {
          likes += 1
        } else if (reaction.sentiment === 'dislike') {
          dislikes += 1
        }

        if (Array.isArray(reaction.emojiValues)) {
          emoji += reaction.emojiValues.filter(
            (value) => typeof value === 'string' && value.trim().length > 0,
          ).length
        }
      }
    }

    return {
      likes,
      dislikes,
      emoji,
    }
  }

  async setReactionCounts(
    postId: string,
    threadId: string,
    counts: {
      likes: number
      dislikes: number
      emoji: number
      replies: number
    },
  ): Promise<void> {
    try {
      await this.postsContainer.item(postId, threadId).patch([
        {
          op: 'set',
          path: '/counters/likes',
          value: counts.likes,
        },
        {
          op: 'set',
          path: '/counters/dislikes',
          value: counts.dislikes,
        },
        {
          op: 'set',
          path: '/counters/emoji',
          value: counts.emoji,
        },
      ])
    } catch (error) {
      if (!isBadRequest(error)) {
        throw error
      }

      await this.postsContainer.item(postId, threadId).patch([
        {
          op: 'set',
          path: '/counters',
          value: {
            likes: counts.likes,
            dislikes: counts.dislikes,
            emoji: counts.emoji,
            replies: counts.replies,
          },
        },
      ])
    }
  }

  async countActiveReplies(
    threadId: string,
    parentId: string,
  ): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query:
        'SELECT VALUE COUNT(1) FROM c WHERE c.threadId = @threadId AND c.parentId = @parentId AND c.type = @type AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))',
      parameters: [
        { name: '@threadId', value: threadId },
        { name: '@parentId', value: parentId },
        { name: '@type', value: 'reply' },
      ],
    }
    const { resources } = await this.postsContainer.items
      .query<number>(querySpec, {
        maxItemCount: 1,
        partitionKey: threadId,
      })
      .fetchAll()

    return resources[0] ?? 0
  }

  private async readItem(
    id: string,
    partitionKey: string,
  ): Promise<StoredPostDocument | null> {
    try {
      const { resource } = await this.postsContainer
        .item(id, partitionKey)
        .read<StoredPostDocument>()
      return resource ?? null
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }

      throw error
    }
  }

  private async queryById(postId: string): Promise<StoredPostDocument | null> {
    const querySpec: SqlQuerySpec = {
      query: 'SELECT TOP 1 * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: postId }],
    }
    const { resources } = await this.postsContainer.items
      .query<StoredPostDocument>(querySpec, { maxItemCount: 1 })
      .fetchAll()

    return resources[0] ?? null
  }

  private getReactionsContainer(): Container {
    if (this.reactionsContainer === undefined) {
      throw new Error('The reactions container is not configured.')
    }

    return this.reactionsContainer
  }
}

function resolvePostCursorState(
  post: StoredPostDocument,
): KeysetCursorState | null {
  const createdAt = readCursorValue(post.createdAt)
  const id = readCursorValue(post.id)

  if (createdAt === undefined || id === undefined) {
    return null
  }

  return {
    createdAt,
    id,
  }
}

function isBadRequest(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cosmosError = error as CosmosLikeError
  return cosmosError.statusCode === 400 || cosmosError.code === 400
}
