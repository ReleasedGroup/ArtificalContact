import type { EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'

export interface CosmosPingResult {
  status: 'ok' | 'skipped' | 'error'
  databaseName?: string
  details?: string
}

interface CosmosDatabaseLike {
  read(): Promise<unknown>
}

interface CosmosClientLike {
  database(databaseName: string): CosmosDatabaseLike
}

export type CosmosClientFactory = (
  config: EnvironmentConfig,
) => CosmosClientLike

export async function pingCosmos(
  config: EnvironmentConfig,
  clientFactory: CosmosClientFactory = createCosmosClient,
): Promise<CosmosPingResult> {
  if (!config.cosmosDatabaseName) {
    return {
      status: 'skipped',
      details: 'COSMOS_DATABASE_NAME is not configured.',
    }
  }

  if (!config.cosmosConnectionString && !config.cosmosEndpoint) {
    return {
      status: 'skipped',
      databaseName: config.cosmosDatabaseName,
      details: 'COSMOS_ENDPOINT or COSMOS_CONNECTION_STRING is not configured.',
    }
  }

  try {
    const client = clientFactory(config)
    await client.database(config.cosmosDatabaseName).read()

    return {
      status: 'ok',
      databaseName: config.cosmosDatabaseName,
    }
  } catch (error) {
    return {
      status: 'error',
      databaseName: config.cosmosDatabaseName,
      details:
        error instanceof Error ? error.message : 'Unknown Cosmos DB error.',
    }
  }
}
