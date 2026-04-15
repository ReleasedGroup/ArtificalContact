import { CosmosClient, type Container, type SqlQuerySpec } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  DEFAULT_NOTIFICATIONS_CONTAINER_NAME,
  type NotificationDocument,
  type NotificationReadStore,
  type NotificationStore,
  type StoredNotificationDocument,
} from './notifications.js'
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

export class CosmosNotificationStore
  implements NotificationStore, NotificationReadStore
{
  constructor(private readonly notificationsContainer: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosNotificationStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName = config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const notificationsContainerName =
      readOptionalValue(process.env.NOTIFICATIONS_CONTAINER_NAME) ??
      DEFAULT_NOTIFICATIONS_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosNotificationStore(
      database.container(notificationsContainerName),
    )
  }

  async upsertNotification(document: NotificationDocument): Promise<void> {
    await this.notificationsContainer.items.upsert(document)
  }

  async listNotifications(
    targetUserId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    notifications: StoredNotificationDocument[]
    cursor?: string
  }> {
    const querySpec: SqlQuerySpec = {
      query: `
        SELECT * FROM c
        WHERE c.targetUserId = @targetUserId
          AND (
            NOT IS_DEFINED(c.type)
            OR IS_NULL(c.type)
            OR c.type = @type
          )
        ORDER BY c.createdAt DESC, c.id DESC
      `,
      parameters: [
        { name: '@targetUserId', value: targetUserId },
        { name: '@type', value: 'notification' },
      ],
    }

    const queryIterator = this.notificationsContainer.items.query<StoredNotificationDocument>(
      querySpec,
      {
        partitionKey: targetUserId,
        maxItemCount: options.limit,
        enableQueryControl: true,
        ...(options.cursor === undefined
          ? {}
          : { continuationToken: options.cursor }),
      },
    )
    const { resources, continuationToken } = await queryIterator.fetchNext()

    return {
      notifications: resources ?? [],
      ...(continuationToken === undefined ? {} : { cursor: continuationToken }),
    }
  }

  async countUnreadNotifications(targetUserId: string): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.targetUserId = @targetUserId
          AND (
            NOT IS_DEFINED(c.type)
            OR IS_NULL(c.type)
            OR c.type = @type
          )
          AND (
            NOT IS_DEFINED(c.readAt)
            OR IS_NULL(c.readAt)
            OR c.readAt = ''
          )
      `,
      parameters: [
        { name: '@targetUserId', value: targetUserId },
        { name: '@type', value: 'notification' },
      ],
    }
    const { resources } = await this.notificationsContainer.items
      .query<number>(querySpec, {
        partitionKey: targetUserId,
        maxItemCount: 1,
      })
      .fetchAll()

    return resources[0] ?? 0
  }

  async listNotificationsByActorAndWindow(
    targetUserId: string,
    eventType: NotificationDocument['eventType'],
    actorUserId: string,
    windowStart: string,
    windowEndExclusive: string,
  ): Promise<NotificationDocument[]> {
    const { resources } = await this.notificationsContainer.items
      .query<NotificationDocument>(
        {
          query: `
            SELECT * FROM c
            WHERE c.targetUserId = @targetUserId
              AND c.eventType = @eventType
              AND c.actorUserId = @actorUserId
              AND c.createdAt >= @windowStart
              AND c.createdAt < @windowEndExclusive
          `,
          parameters: [
            { name: '@targetUserId', value: targetUserId },
            { name: '@eventType', value: eventType },
            { name: '@actorUserId', value: actorUserId },
            { name: '@windowStart', value: windowStart },
            { name: '@windowEndExclusive', value: windowEndExclusive },
          ],
        },
        {
          partitionKey: targetUserId,
        },
      )
      .fetchAll()

    return resources
  }

  async deleteNotification(
    targetUserId: string,
    notificationId: string,
  ): Promise<void> {
    try {
      await this.notificationsContainer.item(notificationId, targetUserId).delete()
    } catch (error) {
      if (isNotFound(error)) {
        return
      }

      throw error
    }
  }
}
