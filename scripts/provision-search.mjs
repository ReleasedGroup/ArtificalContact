import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  AzureKeyCredential,
  SearchIndexClient,
  SearchIndexerClient,
} from '@azure/search-documents'

const DEFAULT_COSMOS_DATABASE_NAME = 'acn'
const DEFAULT_POSTS_CONTAINER_NAME = 'posts'
const POSTS_INDEX_NAME = 'posts-v1'
const USERS_INDEX_NAME = 'users-v1'
const HASHTAGS_INDEX_NAME = 'hashtags-v1'
const POSTS_DATA_SOURCE_NAME = 'posts-v1-cosmosdb-ds'
const POSTS_INDEXER_NAME = 'posts-v1-cosmosdb-idx'
const RETRY_DELAY_MS = 10000
const SEARCH_READY_TIMEOUT_MS = 5 * 60 * 1000
const edmCollection = (elementType) => `Collection(${elementType})`
const azCommand = process.platform === 'win32' ? 'az' : 'az'
const windowsShell = 'pwsh.exe'

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function runAz(args) {
  if (process.platform === 'win32') {
    const commandLine = `& ${azCommand} ${args.map(quotePowerShellArg).join(' ')}`
    return execFileSync(
      windowsShell,
      ['-NoLogo', '-NoProfile', '-Command', commandLine],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim()
  }

  return execFileSync(azCommand, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function readOptionalEnv(name, fallback) {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function getSingleResourceName(resourceGroup, resourceType) {
  const name = runAz([
    'resource',
    'list',
    '--resource-group',
    resourceGroup,
    '--resource-type',
    resourceType,
    '--query',
    '[0].name',
    '-o',
    'tsv',
  ])

  if (!name) {
    throw new Error(
      `Could not find a ${resourceType} resource in resource group ${resourceGroup}.`,
    )
  }

  return name
}

function getSearchAdminKey(resourceGroup, serviceName) {
  return runAz([
    'search',
    'admin-key',
    'show',
    '--resource-group',
    resourceGroup,
    '--service-name',
    serviceName,
    '--query',
    'primaryKey',
    '-o',
    'tsv',
  ])
}

function buildStorageServiceUri(storageAccountName, service) {
  return `https://${storageAccountName}.${service}.core.windows.net`
}

function buildFunctionAppSettings(
  functionAppName,
  storageAccountName,
  searchEndpoint,
  searchApiKey,
) {
  const frontDoorHostName = readOptionalEnv('frontDoorHostName', '')

  return {
    APPLICATIONINSIGHTS_CONNECTION_STRING: readRequiredEnv(
      'applicationInsightsConnectionString',
    ),
    AZURE_REGION: readRequiredEnv('AZURE_LOCATION'),
    AzureWebJobsStorage__blobServiceUri: buildStorageServiceUri(
      storageAccountName,
      'blob',
    ),
    AzureWebJobsStorage__credential: 'managedidentity',
    AzureWebJobsStorage__queueServiceUri: buildStorageServiceUri(
      storageAccountName,
      'queue',
    ),
    AzureWebJobsStorage__tableServiceUri: buildStorageServiceUri(
      storageAccountName,
      'table',
    ),
    CONTENT_SAFETY_THRESHOLD: readOptionalEnv('contentSafetyThreshold', '4'),
    COSMOS_CONNECTION__accountEndpoint: readRequiredEnv('cosmosEndpoint'),
    COSMOS_CONNECTION__credential: 'managedidentity',
    COSMOS_DATABASE_NAME: readOptionalEnv(
      'cosmosDatabaseName',
      DEFAULT_COSMOS_DATABASE_NAME,
    ),
    COSMOS_ENDPOINT: readRequiredEnv('cosmosEndpoint'),
    FUNCTIONS_EXTENSION_VERSION: '~4',
    MEDIA_BASE_URL: frontDoorHostName ? `https://${frontDoorHostName}` : '',
    MEDIA_CONTAINER_NAME: readOptionalEnv('cosmosMediaContainerName', 'media'),
    NOTIFICATIONS_CONTAINER_NAME: readOptionalEnv(
      'cosmosNotificationsContainerName',
      'notifications',
    ),
    NOTIFICATION_PREFS_CONTAINER_NAME: readOptionalEnv(
      'cosmosNotificationPrefsContainerName',
      'notificationPrefs',
    ),
    RATE_LIMITS_CONTAINER_NAME: readOptionalEnv(
      'cosmosRateLimitsContainerName',
      'rateLimits',
    ),
    SEARCH_ENDPOINT: searchEndpoint,
    SEARCH_INDEX_HASHTAGS_NAME: HASHTAGS_INDEX_NAME,
    SEARCH_INDEX_POSTS_NAME: POSTS_INDEX_NAME,
    SEARCH_INDEX_USERS_NAME: USERS_INDEX_NAME,
    SEARCH_API_KEY: searchApiKey,
    AZURE_AI_SEARCH_API_KEY: searchApiKey,
    WEBSITE_CLOUD_ROLENAME: functionAppName,
  }
}

function updateFunctionAppSearchSettings(resourceGroup, functionAppName, searchEndpoint, searchApiKey) {
  const storageAccountName = getSingleResourceName(
    resourceGroup,
    'Microsoft.Storage/storageAccounts',
  )
  const appSettings = buildFunctionAppSettings(
    functionAppName,
    storageAccountName,
    searchEndpoint,
    searchApiKey,
  )

  runAz([
    'functionapp',
    'config',
    'appsettings',
    'set',
    '--resource-group',
    resourceGroup,
    '--name',
    functionAppName,
    '--settings',
    ...Object.entries(appSettings).map(([key, value]) => `${key}=${value}`),
  ])
}

function getCosmosEndpoint(resourceGroup, accountName) {
  return runAz([
    'resource',
    'show',
    '--resource-group',
    resourceGroup,
    '--resource-type',
    'Microsoft.DocumentDB/databaseAccounts',
    '--name',
    accountName,
    '--query',
    'properties.documentEndpoint',
    '-o',
    'tsv',
  ])
}

function getCosmosReadonlyKey(resourceGroup, accountName) {
  return runAz([
    'cosmosdb',
    'keys',
    'list',
    '--resource-group',
    resourceGroup,
    '--name',
    accountName,
    '--type',
    'keys',
    '--query',
    'primaryReadonlyMasterKey',
    '-o',
    'tsv',
  ])
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPostsIndex() {
  return {
    name: POSTS_INDEX_NAME,
    defaultScoringProfile: 'recencyAndEngagement',
    fields: [
      {
        name: 'id',
        type: 'Edm.String',
        key: true,
        filterable: true,
        searchable: false,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'authorId',
        type: 'Edm.String',
        filterable: true,
        searchable: false,
        sortable: false,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'authorHandle',
        type: 'Edm.String',
        filterable: true,
        searchable: true,
        sortable: false,
        facetable: false,
        retrievable: true,
        analyzerName: 'keyword',
      },
      {
        name: 'text',
        type: 'Edm.String',
        searchable: true,
        filterable: false,
        sortable: false,
        facetable: false,
        retrievable: true,
        analyzerName: 'en.lucene',
      },
      {
        name: 'hashtags',
        type: edmCollection('Edm.String'),
        searchable: true,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'mediaKinds',
        type: edmCollection('Edm.String'),
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'createdAt',
        type: 'Edm.DateTimeOffset',
        searchable: false,
        filterable: true,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'visibility',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'moderationState',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'likeCount',
        type: 'Edm.Int32',
        searchable: false,
        filterable: true,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'replyCount',
        type: 'Edm.Int32',
        searchable: false,
        filterable: true,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'kind',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'githubEventType',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'githubRepo',
        type: 'Edm.String',
        searchable: true,
        filterable: true,
        sortable: false,
        facetable: false,
        retrievable: true,
      },
    ],
    scoringProfiles: [
      {
        name: 'recencyAndEngagement',
        functionAggregation: 'sum',
        functions: [
          {
            type: 'freshness',
            boost: 12,
            fieldName: 'createdAt',
            parameters: {
              boostingDuration: 'P7D',
              interpolation: 'exponential',
            },
          },
          {
            type: 'magnitude',
            boost: 3,
            fieldName: 'likeCount',
            parameters: {
              boostingRangeStart: 0,
              boostingRangeEnd: 250,
              interpolation: 'linear',
              constantBoostBeyondRange: true,
            },
          },
          {
            type: 'magnitude',
            boost: 2,
            fieldName: 'replyCount',
            parameters: {
              boostingRangeStart: 0,
              boostingRangeEnd: 100,
              interpolation: 'linear',
              constantBoostBeyondRange: true,
            },
          },
        ],
      },
    ],
  }
}

function buildUsersIndex() {
  return {
    name: USERS_INDEX_NAME,
    fields: [
      {
        name: 'id',
        type: 'Edm.String',
        key: true,
        filterable: true,
        searchable: false,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'handle',
        type: 'Edm.String',
        searchable: true,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
        analyzerName: 'keyword',
      },
      {
        name: 'handleLower',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'displayName',
        type: 'Edm.String',
        searchable: true,
        filterable: false,
        sortable: false,
        facetable: false,
        retrievable: true,
        analyzerName: 'en.lucene',
      },
      {
        name: 'bio',
        type: 'Edm.String',
        searchable: true,
        filterable: false,
        sortable: false,
        facetable: false,
        retrievable: true,
        analyzerName: 'en.lucene',
      },
      {
        name: 'expertise',
        type: edmCollection('Edm.String'),
        searchable: true,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
      {
        name: 'followerCount',
        type: 'Edm.Int32',
        searchable: false,
        filterable: true,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'status',
        type: 'Edm.String',
        searchable: false,
        filterable: true,
        sortable: false,
        facetable: true,
        retrievable: true,
      },
    ],
  }
}

function buildHashtagsIndex() {
  return {
    name: HASHTAGS_INDEX_NAME,
    fields: [
      {
        name: 'id',
        type: 'Edm.String',
        key: true,
        filterable: true,
        searchable: false,
        sortable: false,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'count',
        type: 'Edm.Int32',
        filterable: true,
        searchable: false,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
      {
        name: 'lastUsedAt',
        type: 'Edm.DateTimeOffset',
        filterable: true,
        searchable: false,
        sortable: true,
        facetable: false,
        retrievable: true,
      },
    ],
  }
}

export function buildPostsDataSource(
  cosmosEndpoint,
  cosmosReadonlyKey,
  databaseName,
  postsContainerName,
) {
  return {
    name: POSTS_DATA_SOURCE_NAME,
    type: 'cosmosdb',
    connectionString: `AccountEndpoint=${cosmosEndpoint};AccountKey=${cosmosReadonlyKey};Database=${databaseName}`,
    container: {
      name: postsContainerName,
    },
    dataChangeDetectionPolicy: {
      odatatype: '#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy',
      highWaterMarkColumnName: '_ts',
    },
  }
}

function buildPostsIndexer() {
  return {
    name: POSTS_INDEXER_NAME,
    dataSourceName: POSTS_DATA_SOURCE_NAME,
    targetIndexName: POSTS_INDEX_NAME,
    schedule: {
      interval: 'PT5M',
    },
  }
}

async function retryUntilReady(action, timeoutMs, errorPrefix) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.log(`${errorPrefix}: ${errorMessage}. Retrying in 10s...`)
      await sleep(RETRY_DELAY_MS)
    }
  }

  throw lastError
}

export async function main() {
  const resourceGroup = readRequiredEnv('AZURE_RESOURCE_GROUP')
  const databaseName = readOptionalEnv(
    'cosmosDatabaseName',
    DEFAULT_COSMOS_DATABASE_NAME,
  )
  const postsContainerName = readOptionalEnv(
    'cosmosPostsContainerName',
    DEFAULT_POSTS_CONTAINER_NAME,
  )

  const searchServiceName = getSingleResourceName(
    resourceGroup,
    'Microsoft.Search/searchServices',
  )
  const cosmosAccountName = getSingleResourceName(
    resourceGroup,
    'Microsoft.DocumentDB/databaseAccounts',
  )
  const functionAppName = getSingleResourceName(
    resourceGroup,
    'Microsoft.Web/sites',
  )

  const searchEndpoint =
    readOptionalEnv('searchEndpoint', '') ||
    runAz([
      'search',
      'service',
      'show',
      '--resource-group',
      resourceGroup,
      '--name',
      searchServiceName,
      '--query',
      'endpoint',
      '-o',
      'tsv',
    ])
  const searchAdminKey = getSearchAdminKey(resourceGroup, searchServiceName)
  const cosmosEndpoint = getCosmosEndpoint(resourceGroup, cosmosAccountName)
  const cosmosReadonlyKey = getCosmosReadonlyKey(resourceGroup, cosmosAccountName)

  const credential = new AzureKeyCredential(searchAdminKey)
  const indexClient = new SearchIndexClient(searchEndpoint, credential)
  const indexerClient = new SearchIndexerClient(searchEndpoint, credential)

  console.log(`Waiting for Azure AI Search service ${searchServiceName} to accept data-plane requests...`)
  await retryUntilReady(
    async () => indexClient.getServiceStatistics(),
    SEARCH_READY_TIMEOUT_MS,
    'Azure AI Search is not ready yet',
  )

  console.log('Creating or updating Azure AI Search indexes...')
  await indexClient.createOrUpdateIndex(buildPostsIndex())
  await indexClient.createOrUpdateIndex(buildUsersIndex())
  await indexClient.createOrUpdateIndex(buildHashtagsIndex())

  console.log('Creating or updating Azure AI Search data source and indexer...')
  await indexerClient.createOrUpdateDataSourceConnection(
    buildPostsDataSource(
      cosmosEndpoint,
      cosmosReadonlyKey,
      databaseName,
      postsContainerName,
    ),
  )
  await indexerClient.createOrUpdateIndexer(buildPostsIndexer())

  try {
    console.log('Starting the posts indexer...')
    await indexerClient.runIndexer(POSTS_INDEXER_NAME)
  } catch (error) {
    console.warn(
      `Posts indexer run request was not accepted immediately: ${error.message}`,
    )
  }

  console.log(`Updating Function App ${functionAppName} search settings...`)
  updateFunctionAppSearchSettings(
    resourceGroup,
    functionAppName,
    searchEndpoint,
    searchAdminKey,
  )

  console.log('Azure AI Search schema provisioning completed.')
}

function isDirectExecution() {
  const entryPoint = process.argv[1]

  if (!entryPoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entryPoint).href
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
