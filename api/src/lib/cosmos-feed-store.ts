import { CosmosClient, type Container } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  DEFAULT_FEEDS_CONTAINER_NAME,
  type FeedEntryDocument,
  type FeedStore,
} from './feed-fanout.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

export class CosmosFeedStore implements FeedStore {
  constructor(private readonly container: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosFeedStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClient(config)
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const containerName =
      readOptionalValue(process.env.FEEDS_CONTAINER_NAME) ??
      DEFAULT_FEEDS_CONTAINER_NAME

    return new CosmosFeedStore(
      resolvedClient.database(databaseName).container(containerName),
    )
  }

  async upsertFeedEntry(document: FeedEntryDocument): Promise<void> {
    await this.container.items.upsert(document)
  }
}
