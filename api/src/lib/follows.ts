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
  deletedAt?: string | null
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

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isDeletedFollowDocument(document: FollowDocument | null): boolean {
  return toNullableString(document?.deletedAt) !== null
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
  async function readExistingFollow(
    followerId: string,
    followedId: string,
  ): Promise<FollowDocument | null> {
    const id = buildFollowDocumentId(followerId, followedId)

    try {
      const response = await container.item(id, followerId).read<FollowDocument>()
      return response.resource ?? null
    } catch (error) {
      if (isExpectedCosmosStatusCode(error, 404)) {
        return null
      }

      throw error
    }
  }

  return {
    async create(follow: FollowDocument) {
      try {
        const response = await container.items.create<FollowDocument>(follow)
        return response.resource ?? follow
      } catch (error) {
        if (!isExpectedCosmosStatusCode(error, 409)) {
          throw error
        }

        const existingFollow = await readExistingFollow(
          follow.followerId,
          follow.followedId,
        )

        if (!isDeletedFollowDocument(existingFollow)) {
          throw error
        }

        const response = await container.items.upsert<FollowDocument>(follow)
        return response.resource ?? follow
      }
    },
    async getByFollowerAndFollowed(
      followerId: string,
      followedId: string,
    ): Promise<FollowDocument | null> {
      const existingFollow = await readExistingFollow(followerId, followedId)
      return isDeletedFollowDocument(existingFollow) ? null : existingFollow
    },
    async deleteByFollowerAndFollowed(
      followerId: string,
      followedId: string,
    ): Promise<void> {
      const existingFollow = await readExistingFollow(followerId, followedId)
      if (existingFollow === null || isDeletedFollowDocument(existingFollow)) {
        return
      }

      await container.items.upsert<FollowDocument>({
        ...existingFollow,
        deletedAt: new Date().toISOString(),
      })
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
