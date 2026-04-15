import type { Container } from '@azure/cosmos'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'

export const DEFAULT_FOLLOWS_CONTAINER_NAME = 'follows'
let cachedFollowRepository: MutableFollowRepository | undefined

export interface FollowDocument {
  id: string
  type: 'follow'
  followerId: string
  followedId: string
  createdAt: string
}

export interface FollowRepository {
  create(follow: FollowDocument): Promise<FollowDocument>
  getByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<FollowDocument | null>
  deleteByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<void>
}

export type MutableFollowRepository = FollowRepository

function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const record = error as Record<string, unknown>
  const statusCode = record.statusCode
  if (typeof statusCode === 'number') {
    return statusCode
  }

  const code = record.code
  if (typeof code === 'number') {
    return code
  }

  if (typeof code === 'string') {
    const parsedValue = Number.parseInt(code, 10)
    return Number.isNaN(parsedValue) ? undefined : parsedValue
  }

  return undefined
}

function isExpectedCosmosStatusCode(error: unknown, statusCode: number) {
  return getErrorStatusCode(error) === statusCode
}

export function buildFollowDocumentId(
  followerId: string,
  followedId: string,
): string {
  return `${followerId}:${followedId}`
}

function createCosmosFollowRepository(
  container: Container,
): MutableFollowRepository {
  return {
    async create(follow: FollowDocument) {
      const response = await container.items.create<FollowDocument>(follow)
      return response.resource ?? follow
    },
    async getByFollowerAndFollowed(
      followerId: string,
      followedId: string,
    ): Promise<FollowDocument | null> {
      const id = buildFollowDocumentId(followerId, followedId)

      try {
        const response = await container
          .item(id, followerId)
          .read<FollowDocument>()
        return response.resource ?? null
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return null
        }

        throw error
      }
    },
    async deleteByFollowerAndFollowed(
      followerId: string,
      followedId: string,
    ): Promise<void> {
      const id = buildFollowDocumentId(followerId, followedId)

      try {
        await container.item(id, followerId).delete()
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return
        }

        throw error
      }
    },
  }
}

export function createFollowRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): MutableFollowRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve follows.')
  }

  const followsContainerName =
    readOptionalValue(env.FOLLOWS_CONTAINER_NAME) ?? DEFAULT_FOLLOWS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(followsContainerName)

  return createCosmosFollowRepository(container)
}

export function createFollowRepository(): MutableFollowRepository {
  cachedFollowRepository ??= createFollowRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedFollowRepository
}

export function createFollowDocument(
  followerId: string,
  followedId: string,
  createdAt: Date,
): FollowDocument {
  return {
    id: buildFollowDocumentId(followerId, followedId),
    type: 'follow',
    followerId,
    followedId,
    createdAt: createdAt.toISOString(),
  }
}
