import { API_BUILD_SHA } from '../build-meta.generated.js'

export interface EnvironmentConfig {
  serviceName: string
  buildSha: string
  region: string
  cosmosConnectionString: string | undefined
  cosmosDatabaseName: string | undefined
  cosmosEndpoint: string | undefined
}

function readOptionalValue(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readCosmosEndpoint(env: NodeJS.ProcessEnv) {
  return (
    readOptionalValue(env.COSMOS_CONNECTION__accountEndpoint) ??
    readOptionalValue(env.COSMOS_ENDPOINT)
  )
}

export function getEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  return {
    serviceName: 'artificialcontact-api',
    buildSha: readOptionalValue(env.BUILD_SHA) ?? API_BUILD_SHA,
    region: readOptionalValue(env.AZURE_REGION) ?? 'local',
    cosmosConnectionString: readOptionalValue(env.COSMOS_CONNECTION_STRING),
    cosmosDatabaseName: readOptionalValue(env.COSMOS_DATABASE_NAME),
    cosmosEndpoint: readCosmosEndpoint(env),
  }
}
