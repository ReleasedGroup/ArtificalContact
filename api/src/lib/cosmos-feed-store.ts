import { CosmosClient, type Container } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  DEFAULT_FEEDS_CONTAINER_NAME,
  type FeedEntryDocument,
  type FeedStore as FeedFanOutStore,
} from './feed-fanout.js'
import {
  DEFAULT_FEED_PAGE_SIZE,
  type FeedStore as FeedReadStore,
  type StoredFeedDocument,
} from './feed.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

export class CosmosFeedStore implements FeedFanOutStore, FeedReadStore {
  constructor(private readonly container: Container) {}

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
      ...(continuationToken === undefined ? {} : { cursor: continuationToken }),
    }
  }
}
