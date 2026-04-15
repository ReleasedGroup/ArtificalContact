import { CosmosClient, type Container, type ItemDefinition } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { getEnvironmentConfig } from './config.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME,
  buildUserHandleStateId,
  type ExistingMirrorRecord,
  type ExistingUserHandleState,
  type UsersByHandleMirrorDocument,
  type UsersByHandleMirrorStateDocument,
  type UsersByHandleMirrorStore,
} from './users-by-handle-mirror.js'

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

export class CosmosUsersByHandleMirrorStore implements UsersByHandleMirrorStore {
  constructor(private readonly container: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosUsersByHandleMirrorStore {
    const config = getEnvironmentConfig()
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const databaseName = config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const containerName =
      readOptionalValue(process.env.USERS_BY_HANDLE_CONTAINER_NAME) ??
      DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME

    return new CosmosUsersByHandleMirrorStore(
      resolvedClient.database(databaseName).container(containerName),
    )
  }

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.readItem<ExistingMirrorRecord>(handle, handle)
  }

  async getStateByUserId(userId: string): Promise<ExistingUserHandleState | null> {
    const stateId = buildUserHandleStateId(userId)
    return this.readItem<ExistingUserHandleState>(stateId, stateId)
  }

  async upsertMirror(document: UsersByHandleMirrorDocument): Promise<void> {
    await this.container.items.upsert(document)
  }

  async upsertState(document: UsersByHandleMirrorStateDocument): Promise<void> {
    await this.container.items.upsert(document)
  }

  async deleteByHandle(handle: string): Promise<void> {
    await this.deleteItem(handle, handle)
  }

  async deleteStateByUserId(userId: string): Promise<void> {
    const stateId = buildUserHandleStateId(userId)
    await this.deleteItem(stateId, stateId)
  }

  private async deleteItem(id: string, partitionKey: string): Promise<void> {
    try {
      await this.container.item(id, partitionKey).delete()
    } catch (error) {
      if (isNotFound(error)) {
        return
      }

      throw error
    }
  }

  private async readItem<T extends ItemDefinition>(
    id: string,
    partitionKey: string,
  ): Promise<T | null> {
    try {
      const { resource } = await this.container.item(id, partitionKey).read<T>()
      return resource ?? null
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }

      throw error
    }
  }
}
