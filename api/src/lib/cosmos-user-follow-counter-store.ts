import { type Container, type CosmosClient, type SqlQuerySpec } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { type FollowCounterStore } from './follow-counter.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from './follows.js'
import { readOptionalValue } from './strings.js'
import type { StoredUserDocument } from './user-profile.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_USERS_CONTAINER_NAME,
} from './users-by-handle-mirror.js'

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

function isBadRequest(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cosmosError = error as CosmosLikeError
  return cosmosError.statusCode === 400 || cosmosError.code === 400
}

export class CosmosUserFollowCounterStore implements FollowCounterStore {
  constructor(
    private readonly usersContainer: Container,
    private readonly followsContainer: Container,
  ) {}

  static fromEnvironment(client?: CosmosClient): CosmosUserFollowCounterStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClient(config)
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const usersContainerName =
      readOptionalValue(process.env.USERS_CONTAINER_NAME) ??
      DEFAULT_USERS_CONTAINER_NAME
    const followsContainerName =
      readOptionalValue(process.env.FOLLOWS_CONTAINER_NAME) ??
      DEFAULT_FOLLOWS_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosUserFollowCounterStore(
      database.container(usersContainerName),
      database.container(followsContainerName),
    )
  }

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    try {
      const { resource } = await this.usersContainer
        .item(userId, userId)
        .read<StoredUserDocument>()
      return resource ?? null
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }

      throw error
    }
  }

  async countActiveFollowers(userId: string): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query:
        'SELECT VALUE COUNT(1) FROM c WHERE c.followedId = @userId AND c.type = @type AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))',
      parameters: [
        { name: '@userId', value: userId },
        { name: '@type', value: 'follow' },
      ],
    }
    const { resources } = await this.followsContainer.items
      .query<number>(querySpec, { maxItemCount: 1 })
      .fetchAll()

    return resources[0] ?? 0
  }

  async countActiveFollowing(userId: string): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query:
        'SELECT VALUE COUNT(1) FROM c WHERE c.followerId = @userId AND c.type = @type AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))',
      parameters: [
        { name: '@userId', value: userId },
        { name: '@type', value: 'follow' },
      ],
    }
    const { resources } = await this.followsContainer.items
      .query<number>(querySpec, {
        maxItemCount: 1,
        partitionKey: userId,
      })
      .fetchAll()

    return resources[0] ?? 0
  }

  async setFollowCounts(
    userId: string,
    counts: {
      followers: number
      following: number
      posts: number
    },
  ): Promise<void> {
    try {
      await this.usersContainer.item(userId, userId).patch([
        {
          op: 'set',
          path: '/counters/followers',
          value: counts.followers,
        },
        {
          op: 'set',
          path: '/counters/following',
          value: counts.following,
        },
      ])
    } catch (error) {
      if (!isBadRequest(error)) {
        throw error
      }

      await this.usersContainer.item(userId, userId).patch([
        {
          op: 'set',
          path: '/counters',
          value: {
            posts: counts.posts,
            followers: counts.followers,
            following: counts.following,
          },
        },
      ])
    }
  }
}
