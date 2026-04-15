import { CosmosClient } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { EnvironmentConfig } from './config.js'

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

function createCosmosClient(config: EnvironmentConfig): CosmosClientLike {
  if (config.cosmosConnectionString) {
    return new CosmosClient(config.cosmosConnectionString)
  }

  if (!config.cosmosEndpoint) {
    throw new Error('COSMOS_ENDPOINT is required when no connection string is set.')
  }

  return new CosmosClient({
    endpoint: config.cosmosEndpoint,
    aadCredentials: new DefaultAzureCredential(),
  })
}

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
