import { CosmosClient, type Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'
import type { StoredPostDocument, ThreadStore } from './thread.js'

const DEFAULT_POSTS_CONTAINER_NAME = 'posts'

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function createCosmosClientFromEnvironment(): CosmosClient {
  const config = getEnvironmentConfig()

  if (config.cosmosConnectionString) {
    return createCosmosClient(config)
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

export class CosmosThreadStore implements ThreadStore {
  constructor(private readonly postsContainer: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosThreadStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName = config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const postsContainerName =
      readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
      DEFAULT_POSTS_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosThreadStore(database.container(postsContainerName))
  }

  async listThreadPosts(
    threadId: string,
    options: {
      limit: number
      continuationToken?: string
    },
  ): Promise<{
    posts: StoredPostDocument[]
    continuationToken?: string
  }> {
    const queryIterator = this.postsContainer.items.query<StoredPostDocument>(
      {
        query: `
          SELECT * FROM c
          WHERE c.threadId = @threadId
            AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))
            AND (
              NOT IS_DEFINED(c.visibility)
              OR IS_NULL(c.visibility)
              OR c.visibility = @publicVisibility
            )
            AND (
              NOT IS_DEFINED(c.moderationState)
              OR IS_NULL(c.moderationState)
              OR c.moderationState = @okModerationState
              OR c.moderationState = @flaggedModerationState
            )
          ORDER BY c.createdAt ASC
        `,
        parameters: [
          { name: '@threadId', value: threadId },
          { name: '@publicVisibility', value: 'public' },
          { name: '@okModerationState', value: 'ok' },
          { name: '@flaggedModerationState', value: 'flagged' },
        ],
      },
      {
        partitionKey: threadId,
        maxItemCount: options.limit,
        enableQueryControl: true,
        ...(options.continuationToken === undefined
          ? {}
          : { continuationToken: options.continuationToken }),
      },
    )

    const { resources, continuationToken } = await queryIterator.fetchNext()

    return {
      posts: resources ?? [],
      ...(continuationToken === undefined ? {} : { continuationToken }),
    }
  }
}
