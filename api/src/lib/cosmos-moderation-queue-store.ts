import { CosmosClient, type Container, type SqlQuerySpec } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  DEFAULT_REPORTS_CONTAINER_NAME,
  type ModerationQueueReadStore,
  type ModerationQueueStatus,
  type StoredReportDocument,
} from './moderation-queue.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

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

export class CosmosModerationQueueStore implements ModerationQueueReadStore {
  constructor(private readonly reportsContainer: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosModerationQueueStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const reportsContainerName =
      readOptionalValue(process.env.REPORTS_CONTAINER_NAME) ??
      DEFAULT_REPORTS_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosModerationQueueStore(
      database.container(reportsContainerName),
    )
  }

  async listReportsByStatus(
    status: ModerationQueueStatus,
    limit: number,
  ): Promise<StoredReportDocument[]> {
    const querySpec: SqlQuerySpec = {
      query: `
        SELECT * FROM c
        WHERE c.status = @status
          AND (
            NOT IS_DEFINED(c.type)
            OR IS_NULL(c.type)
            OR c.type = @type
          )
        ORDER BY c.createdAt DESC, c.id DESC
      `,
      parameters: [
        { name: '@status', value: status },
        { name: '@type', value: 'report' },
      ],
    }

    const { resources } = await this.reportsContainer.items
      .query<StoredReportDocument>(querySpec, {
        partitionKey: status,
        maxItemCount: limit,
      })
      .fetchAll()

    return resources ?? []
  }

  async countReportsByStatus(status: ModerationQueueStatus): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.status = @status
          AND (
            NOT IS_DEFINED(c.type)
            OR IS_NULL(c.type)
            OR c.type = @type
          )
      `,
      parameters: [
        { name: '@status', value: status },
        { name: '@type', value: 'report' },
      ],
    }

    const { resources } = await this.reportsContainer.items
      .query<number>(querySpec, {
        partitionKey: status,
        maxItemCount: 1,
      })
      .fetchAll()

    return resources[0] ?? 0
  }
}
