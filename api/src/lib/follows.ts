import type { Container } from '@azure/cosmos'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  applyKeysetPagination,
  type KeysetCursorState,
} from './keyset-pagination.js'
import { readOptionalValue } from './strings.js'

export const DEFAULT_FOLLOWS_CONTAINER_NAME = 'follows'
export const DEFAULT_FOLLOWERS_CONTAINER_NAME = 'followers'
let cachedFollowRepository: MutableFollowRepository | undefined
let cachedFollowersMirrorRepository: FollowersMirrorRepository | undefined
const FOLLOWS_CURSOR_PREFIX = 'ac.follows.v1:'
const FOLLOWERS_CURSOR_PREFIX = 'ac.followers.v1:'

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

export interface FollowingListRepository {
  listByFollowerId(
    followerId: string,
    options: {
      limit: number
      continuationToken?: string
    },
  ): Promise<{
    follows: FollowDocument[]
    continuationToken?: string
  }>
}

export interface FollowersMirrorRepository {
  listFollowers(
    followedId: string,
    options: {
      limit: number
      continuationToken?: string
    },
  ): Promise<{
    follows: FollowDocument[]
    continuationToken?: string
  }>
}

export type MutableFollowRepository = FollowRepository & FollowingListRepository

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
    async listByFollowerId(
      followerId: string,
      options: {
        limit: number
        continuationToken?: string
      },
    ): Promise<{
      follows: FollowDocument[]
      continuationToken?: string
    }> {
      const { resources } = await container.items
        .query<FollowDocument>(
          {
            query: 'SELECT * FROM c',
          },
          {
            partitionKey: followerId,
          },
        )
        .fetchAll()
      const page = applyKeysetPagination(
        (resources ?? []).filter(
          (follow) =>
            follow.type === 'follow' &&
            !isDeletedFollowDocument(follow),
        ),
        {
          limit: options.limit,
          prefix: FOLLOWS_CURSOR_PREFIX,
          resolveCursorState: resolveFollowCursorState,
          ...(options.continuationToken === undefined
            ? {}
            : { cursor: options.continuationToken }),
        },
      )

      return {
        follows: page.items,
        ...(page.cursor === undefined
          ? {}
          : { continuationToken: page.cursor }),
      }
    },
  }
}

function createCosmosFollowersMirrorRepository(
  container: Container,
): FollowersMirrorRepository {
  return {
    async listFollowers(
      followedId: string,
      options: {
        limit: number
        continuationToken?: string
      },
    ): Promise<{
      follows: FollowDocument[]
      continuationToken?: string
    }> {
      const { resources } = await container.items
        .query<FollowDocument>(
          {
            query: 'SELECT * FROM c',
          },
          {
            partitionKey: followedId,
          },
        )
        .fetchAll()
      const page = applyKeysetPagination(
        (resources ?? []).filter((follow) => !isDeletedFollowDocument(follow)),
        {
          limit: options.limit,
          prefix: FOLLOWERS_CURSOR_PREFIX,
          resolveCursorState: resolveFollowCursorState,
          ...(options.continuationToken === undefined
            ? {}
            : { cursor: options.continuationToken }),
        },
      )

      return {
        follows: page.items,
        ...(page.cursor === undefined
          ? {}
          : { continuationToken: page.cursor }),
      }
    },
  }
}

function resolveFollowCursorState(
  follow: FollowDocument,
): KeysetCursorState | null {
  const createdAt = toNullableString(follow.createdAt)
  const id = toNullableString(follow.id)

  if (createdAt === null || id === null) {
    return null
  }

  return {
    createdAt,
    id,
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
  const container = client.database(config.cosmosDatabaseName).container(followsContainerName)

  return createCosmosFollowRepository(container)
}

export function createFollowRepository(): MutableFollowRepository {
  cachedFollowRepository ??= createFollowRepositoryFromConfig(getEnvironmentConfig())
  return cachedFollowRepository
}

export function createFollowingListRepository(): FollowingListRepository {
  cachedFollowRepository ??= createFollowRepositoryFromConfig(getEnvironmentConfig())
  return cachedFollowRepository
}

export function createFollowersMirrorRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): FollowersMirrorRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error(
      'COSMOS_DATABASE_NAME is required to resolve followers mirror records.',
    )
  }

  const followersContainerName =
    readOptionalValue(env.FOLLOWERS_CONTAINER_NAME) ??
    DEFAULT_FOLLOWERS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(followersContainerName)

  return createCosmosFollowersMirrorRepository(container)
}

export function createFollowersMirrorRepository(): FollowersMirrorRepository {
  cachedFollowersMirrorRepository ??= createFollowersMirrorRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedFollowersMirrorRepository
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
