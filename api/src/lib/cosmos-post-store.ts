import { CosmosClient, type Container, type SqlQuerySpec } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import {
  DEFAULT_POSTS_CONTAINER_NAME,
  type MutablePostStore,
  type PostRepository,
  type StoredPostDocument,
  type UserPostDocument,
} from './posts.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

type CosmosLikeError = Error & {
  code?: number | string
  statusCode?: number
}

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

export class CosmosPostStore implements MutablePostStore, PostRepository {
  constructor(private readonly postsContainer: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosPostStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const postsContainerName =
      readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
      DEFAULT_POSTS_CONTAINER_NAME

    return new CosmosPostStore(
      resolvedClient.database(databaseName).container(postsContainerName),
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
}

function isBadRequest(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cosmosError = error as CosmosLikeError
  return cosmosError.statusCode === 400 || cosmosError.code === 400
}
