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
  reactionNotificationHourlyThreshold: number
  ffmpegPath: string | undefined
  searchEndpoint: string | undefined
  searchPostsIndexName: string
  searchUsersIndexName: string
  searchHashtagsIndexName: string
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
    reactionNotificationHourlyThreshold: readInteger(
      env.REACTION_NOTIFICATION_HOURLY_THRESHOLD,
      3,
      1,
      100,
    ),
    searchEndpoint:
      readOptionalValue(env.SEARCH_ENDPOINT) ??
      readOptionalValue(env.SEARCH_SERVICE_ENDPOINT) ??
      readOptionalValue(env.AZURE_AI_SEARCH_ENDPOINT),
    searchPostsIndexName:
      readOptionalValue(env.SEARCH_INDEX_POSTS_NAME) ??
      readOptionalValue(env.AZURE_AI_SEARCH_POSTS_INDEX) ??
      'posts-v1',
    searchUsersIndexName:
      readOptionalValue(env.SEARCH_INDEX_USERS_NAME) ??
      readOptionalValue(env.AZURE_AI_SEARCH_USERS_INDEX) ??
      'users-v1',
    searchHashtagsIndexName:
      readOptionalValue(env.SEARCH_INDEX_HASHTAGS_NAME) ??
      readOptionalValue(env.AZURE_AI_SEARCH_HASHTAGS_INDEX) ??
      'hashtags-v1',
    ffmpegPath:
      readOptionalValue(env.FFMPEG_PATH) ??
      readOptionalValue(env.MEDIA_FFMPEG_PATH),
  }
}
