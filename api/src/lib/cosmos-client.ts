import { CosmosClient } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { EnvironmentConfig } from './config.js'
import { ensureCosmosTelemetryPatched } from './cosmos-telemetry.js'

export function createCosmosClient(config: EnvironmentConfig): CosmosClient {
  ensureCosmosTelemetryPatched()

  if (config.cosmosConnectionString) {
    return new CosmosClient(config.cosmosConnectionString)
  }

  if (!config.cosmosEndpoint) {
    throw new Error(
      'COSMOS_ENDPOINT is required when no connection string is set.',
    )
  }

  return new CosmosClient({
    endpoint: config.cosmosEndpoint,
    aadCredentials: new DefaultAzureCredential(),
  })
}
