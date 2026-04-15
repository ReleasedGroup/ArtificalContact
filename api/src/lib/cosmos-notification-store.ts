import { CosmosClient, type Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import {
  DEFAULT_NOTIFICATIONS_CONTAINER_NAME,
  type NotificationDocument,
  type NotificationStore,
} from './notifications.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

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

export class CosmosNotificationStore implements NotificationStore {
  constructor(private readonly container: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosNotificationStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const containerName =
      readOptionalValue(process.env.NOTIFICATIONS_CONTAINER_NAME) ??
      DEFAULT_NOTIFICATIONS_CONTAINER_NAME

    return new CosmosNotificationStore(
      resolvedClient.database(databaseName).container(containerName),
    )
  }

  async upsertNotification(document: NotificationDocument): Promise<void> {
    await this.container.items.upsert(document)
  }
}
