import { API_BUILD_SHA } from '../build-meta.generated.js'
import { readOptionalValue } from './strings.js'

export interface EnvironmentConfig {
  serviceName: string
  buildSha: string
  region: string
  cosmosConnectionString: string | undefined
  cosmosDatabaseName: string | undefined
  cosmosEndpoint: string | undefined
  mediaBaseUrl: string | undefined
  mediaContainerName: string | undefined
  contentSafetyEndpoint: string | undefined
  contentSafetyKey: string | undefined
  contentSafetyThreshold: number
  ffmpegPath: string | undefined
}

function readCosmosEndpoint(env: NodeJS.ProcessEnv) {
  return (
    readOptionalValue(env.COSMOS_CONNECTION__accountEndpoint) ??
    readOptionalValue(env.COSMOS_ENDPOINT)
  )
}

function readInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  const normalizedValue = readOptionalValue(value)
  if (normalizedValue === undefined) {
    return defaultValue
  }

  const parsedValue = Number.parseInt(normalizedValue, 10)
  if (!Number.isFinite(parsedValue)) {
    return defaultValue
  }

  return Math.min(maximum, Math.max(minimum, parsedValue))
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
    mediaBaseUrl: readOptionalValue(env.MEDIA_BASE_URL),
    mediaContainerName: readOptionalValue(env.MEDIA_CONTAINER_NAME),
    contentSafetyEndpoint: readOptionalValue(env.CONTENT_SAFETY_ENDPOINT),
    contentSafetyKey: readOptionalValue(env.CONTENT_SAFETY_KEY),
    contentSafetyThreshold: readInteger(env.CONTENT_SAFETY_THRESHOLD, 4, 0, 7),
    ffmpegPath:
      readOptionalValue(env.FFMPEG_PATH) ??
      readOptionalValue(env.MEDIA_FFMPEG_PATH),
  }
}
