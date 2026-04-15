import { CosmosClient, type Container, type ItemDefinition } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import type { FollowerFeedTarget, FollowersFeedSourceStore } from './feed-fanout.js'
import {
  DEFAULT_FOLLOWERS_CONTAINER_NAME,
  type ExistingFollowersMirrorRecord,
  type FollowersMirrorDocument,
  type FollowersMirrorStore,
} from './followers-mirror.js'
import { buildFollowDocumentId } from './follows.js'
import { readOptionalValue } from './strings.js'
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

export class CosmosFollowersMirrorStore
  implements FollowersMirrorStore, FollowersFeedSourceStore
{
  constructor(private readonly container: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosFollowersMirrorStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClient(config)
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const containerName =
      readOptionalValue(process.env.FOLLOWERS_CONTAINER_NAME) ??
      DEFAULT_FOLLOWERS_CONTAINER_NAME

    return new CosmosFollowersMirrorStore(
      resolvedClient.database(databaseName).container(containerName),
    )
  }

  async getByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<ExistingFollowersMirrorRecord | null> {
    return this.readItem<ExistingFollowersMirrorRecord>(
      buildFollowDocumentId(followerId, followedId),
      followedId,
    )
  }

  async upsertMirror(document: FollowersMirrorDocument): Promise<void> {
    await this.container.items.upsert(document)
  }

  async deleteMirror(followerId: string, followedId: string): Promise<void> {
    try {
      await this.container
        .item(buildFollowDocumentId(followerId, followedId), followedId)
        .delete()
    } catch (error) {
      if (isNotFound(error)) {
        return
      }

      throw error
    }
  }

  async listFollowersByFollowedId(
    followedId: string,
    limit: number,
  ): Promise<FollowerFeedTarget[]> {
    const cappedLimit = Math.max(1, Math.trunc(limit))
    const query = `SELECT TOP ${cappedLimit} c.followerId, c.followedId FROM c WHERE c.followedId = @followedId ORDER BY c.createdAt ASC`
    const { resources } = await this.container.items
      .query<FollowerFeedTarget>(
        {
          query,
          parameters: [{ name: '@followedId', value: followedId }],
        },
        {
          partitionKey: followedId,
          maxItemCount: cappedLimit,
        },
      )
      .fetchAll()

    return resources
  }

  private async readItem<T extends ItemDefinition>(
    id: string,
    partitionKey: string,
  ): Promise<T | null> {
    try {
      const { resource } = await this.container.item(id, partitionKey).read<T>()
      return resource ?? null
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }

      throw error
    }
  }
}
