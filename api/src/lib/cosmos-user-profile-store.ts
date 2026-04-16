import { CosmosClient, type Container, type ItemDefinition } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME,
  DEFAULT_USERS_CONTAINER_NAME,
  type ExistingMirrorRecord,
} from './users-by-handle-mirror.js'
import type { StoredUserDocument, UserProfileStore } from './user-profile.js'

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

export class CosmosUserProfileStore implements UserProfileStore {
  constructor(
    private readonly usersContainer: Container,
    private readonly usersByHandleContainer: Container,
  ) {}

  static fromEnvironment(client?: CosmosClient): CosmosUserProfileStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName = config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const usersContainerName =
      readOptionalValue(process.env.USERS_CONTAINER_NAME) ??
      DEFAULT_USERS_CONTAINER_NAME
    const usersByHandleContainerName =
      readOptionalValue(process.env.USERS_BY_HANDLE_CONTAINER_NAME) ??
      DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME
    const database = resolvedClient.database(databaseName)

    return new CosmosUserProfileStore(
      database.container(usersContainerName),
      database.container(usersByHandleContainerName),
    )
  }

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.readItem<ExistingMirrorRecord>(
      this.usersByHandleContainer,
      handle,
      handle,
    )
  }

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    return this.readItem<StoredUserDocument>(this.usersContainer, userId, userId)
  }

  async findUserByHandle(handle: string): Promise<StoredUserDocument | null> {
    const queryIterator = this.usersContainer.items.query<StoredUserDocument>(
      {
        query: `
          SELECT TOP 1 *
          FROM c
          WHERE c.type = 'user' AND c.handleLower = @handle
        `,
        parameters: [{ name: '@handle', value: handle }],
      },
      {
        maxItemCount: 1,
      },
    )
    const { resources } = await queryIterator.fetchAll()
    return resources[0] ?? null
  }

  private async readItem<T extends ItemDefinition>(
    container: Container,
    id: string,
    partitionKey: string,
  ): Promise<T | null> {
    try {
      const { resource } = await container.item(id, partitionKey).read<T>()
      return resource ?? null
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }

      throw error
    }
  }
}
