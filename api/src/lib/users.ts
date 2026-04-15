import type { Container } from '@azure/cosmos'
import type { AuthenticatedPrincipal } from './auth.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'

const defaultUsersContainerName = 'users'
let cachedUserRepository: MutableUserRepository | undefined

export type UserStatus =
  | 'active'
  | 'pending'
  | 'suspended'
  | 'deactivated'
  | 'deleted'

export interface UserCounters {
  posts: number
  followers: number
  following: number
}

export interface UserDocument {
  id: string
  type: 'user'
  identityProvider: string
  identityProviderUserId: string
  email?: string
  emailLower?: string
  handle?: string
  handleLower?: string
  displayName: string
  bio?: string
  avatarUrl?: string
  bannerUrl?: string
  expertise: string[]
  links: Record<string, string>
  status: UserStatus
  roles: string[]
  counters: UserCounters
  createdAt: string
  updatedAt: string
}

export interface UserRepository {
  create(user: UserDocument): Promise<UserDocument>
  getById(userId: string): Promise<UserDocument | null>
  upsert(user: UserDocument): Promise<UserDocument>
}

export interface MutableUserRepository extends UserRepository {
  upsert(user: UserDocument): Promise<UserDocument>
}

export interface ResolvedMeProfile {
  user: MeProfile
  isNewUser: boolean
}

export interface MeProfile {
  id: string
  identityProvider: string
  identityProviderUserId: string
  email: string | null
  handle: string | null
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
  links: Record<string, string>
  status: UserStatus
  roles: string[]
  counters: UserCounters
  createdAt: string
  updatedAt: string
}

export interface EnsureUserResult {
  user: UserDocument
  isNewUser: boolean
}

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

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function createCosmosUserRepository(
  container: Container,
): MutableUserRepository {
  return {
    async getById(userId: string) {
      try {
        const response = await container
          .item(userId, userId)
          .read<UserDocument>()
        return response.resource ?? null
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return null
        }

        throw error
      }
    },
    async create(user: UserDocument) {
      const response = await container.items.create<UserDocument>(user)
      return response.resource ?? user
    },
    async upsert(user: UserDocument) {
      const response = await container.items.upsert<UserDocument>(user)
      return response.resource ?? user
    },
  }
}

export function createUserRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): MutableUserRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve users.')
  }

  const usersContainerName =
    readOptionalValue(env.USERS_CONTAINER_NAME) ?? defaultUsersContainerName
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(usersContainerName)

  return createCosmosUserRepository(container)
}

export function createUserRepository(): MutableUserRepository {
  cachedUserRepository ??= createUserRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedUserRepository
}

export function createPendingUserDocument(
  principal: AuthenticatedPrincipal,
  createdAt: Date,
): UserDocument {
  const timestamp = createdAt.toISOString()
  const normalizedEmail = principal.email?.toLowerCase()

  return {
    id: principal.subject,
    type: 'user',
    identityProvider: principal.identityProvider.toLowerCase(),
    identityProviderUserId: principal.userId,
    displayName: principal.displayName,
    expertise: [],
    links: {},
    status: 'pending',
    roles: ['user'],
    counters: {
      posts: 0,
      followers: 0,
      following: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(principal.email
      ? {
          email: principal.email,
          emailLower: normalizedEmail ?? principal.email.toLowerCase(),
        }
      : {}),
  }
}

export async function ensureUserForPrincipal(
  principal: AuthenticatedPrincipal,
  repository: UserRepository,
  now: () => Date = () => new Date(),
): Promise<EnsureUserResult> {
  const existingUser = await repository.getById(principal.subject)
  if (existingUser) {
    return {
      user: existingUser,
      isNewUser: false,
    }
  }

  const pendingUser = createPendingUserDocument(principal, now())

  try {
    return {
      user: await repository.create(pendingUser),
      isNewUser: true,
    }
  } catch (error) {
    if (!isExpectedCosmosStatusCode(error, 409)) {
      throw error
    }

    const concurrentlyCreatedUser = await repository.getById(principal.subject)
    if (!concurrentlyCreatedUser) {
      throw error
    }

    return {
      user: concurrentlyCreatedUser,
      isNewUser: false,
    }
  }
}

export function toMeProfile(user: UserDocument): MeProfile {
  return {
    id: user.id,
    identityProvider: user.identityProvider,
    identityProviderUserId: user.identityProviderUserId,
    email: user.email ?? null,
    handle: user.handle ?? null,
    displayName: user.displayName,
    bio: user.bio ?? null,
    avatarUrl: user.avatarUrl ?? null,
    bannerUrl: user.bannerUrl ?? null,
    expertise: [...user.expertise],
    links: { ...user.links },
    status: user.status,
    roles: [...user.roles],
    counters: {
      posts: user.counters.posts,
      followers: user.counters.followers,
      following: user.counters.following,
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function resolveUserRoles(
  principal: AuthenticatedPrincipal,
  user: UserDocument | null,
): string[] {
  if (user?.roles.length) {
    return [
      ...new Set(
        user.roles.map((role) => role.trim().toLowerCase()).filter(Boolean),
      ),
    ]
  }

  return principal.userRoles
}
