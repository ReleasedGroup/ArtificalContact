import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildDeleteFollowHandler } from '../src/functions/delete-follow.js'
import type { FollowDocument, FollowRepository } from '../src/lib/follows.js'
import type {
  StoredUserDocument,
  UserProfileStore,
} from '../src/lib/user-profile.js'
import type { ExistingMirrorRecord } from '../src/lib/users-by-handle-mirror.js'
import type { UserDocument } from '../src/lib/users.js'

class InMemoryUserProfileStore implements UserProfileStore {
  constructor(
    private readonly mirrors = new Map<string, ExistingMirrorRecord>(),
    private readonly users = new Map<string, StoredUserDocument>(),
  ) {}

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.mirrors.get(handle) ?? null
  }

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    return this.users.get(userId) ?? null
  }
}

function createStore(options?: {
  mirrors?: ExistingMirrorRecord[]
  users?: StoredUserDocument[]
}) {
  return new InMemoryUserProfileStore(
    new Map((options?.mirrors ?? []).map((record) => [record.handle, record])),
    new Map((options?.users ?? []).map((record) => [record.id, record])),
  )
}

function createStoredFollow(
  overrides: Partial<FollowDocument> = {},
): FollowDocument {
  const followerId = overrides.followerId ?? 'github:abc123'
  const followedId = overrides.followedId ?? 'github:def456'

  return {
    id: `${followerId}:${followedId}`,
    type: 'follow',
    followerId,
    followedId,
    createdAt: '2026-04-15T05:00:00.000Z',
    ...overrides,
  }
}

function createRequest(handle?: string): HttpRequest {
  return {
    params: handle ? { handle } : {},
  } as unknown as HttpRequest
}

function createStoredUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'github:abc123',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'abc123',
    email: 'nick@example.com',
    emailLower: 'nick@example.com',
    handle: 'nick',
    handleLower: 'nick',
    displayName: 'Nick Beaugeard',
    expertise: ['llm'],
    links: {
      website: 'https://example.com',
    },
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 3,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createContext(user: UserDocument | null = createStoredUser()) {
  return {
    auth: user
      ? {
          isAuthenticated: true,
          principal: null,
          user,
          roles: user.roles,
        }
      : undefined,
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('deleteFollowHandler', () => {
  it('deletes an existing follow relationship and returns the post-delete state', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => createStoredFollow()),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })
    const context = createContext()

    const response = await handler(createRequest('Ada'), context)

    expect(response.status).toBe(200)
    expect(repository.deleteByFollowerAndFollowed).toHaveBeenCalledWith(
      'github:abc123',
      'u2',
    )
    expect(response.jsonBody).toEqual({
      data: {
        unfollow: {
          id: 'github:abc123:u2',
          followerId: 'github:abc123',
          followedId: 'u2',
          handle: 'Ada',
          following: false,
          relationshipExisted: true,
        },
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Processed unfollow request.', {
      followerId: 'github:abc123',
      followedId: 'u2',
      relationshipExisted: true,
    })
  })

  it('treats repeated unfollows as a successful no-op', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('Ada'), createContext())

    expect(response.status).toBe(200)
    expect(repository.deleteByFollowerAndFollowed).not.toHaveBeenCalled()
    expect(response.jsonBody).toEqual({
      data: {
        unfollow: {
          id: 'github:abc123:u2',
          followerId: 'github:abc123',
          followedId: 'u2',
          handle: 'Ada',
          following: false,
          relationshipExisted: false,
        },
      },
      errors: [],
    })
  })

  it('rejects users who do not have an active profile with a handle', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('Ada'), createContext(pendingUser))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before unfollowing users.',
        },
      ],
    })
    expect(repository.deleteByFollowerAndFollowed).not.toHaveBeenCalled()
  })

  it('returns a validation error when the handle path parameter is missing', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => createStore(),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_handle',
          message: 'The handle path parameter is required.',
          field: 'handle',
        },
      ],
    })
  })

  it('returns not found when the target profile does not exist', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => createStore(),
    })

    const response = await handler(createRequest('Ada'), createContext())

    expect(response.status).toBe(404)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'user_not_found',
          message: 'No public profile exists for the requested handle.',
          field: 'handle',
        },
      ],
    })
  })

  it('rejects attempts to unfollow the authenticated user', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const currentUser = createStoredUser()
    const store = createStore({
      mirrors: [{ id: 'nick', handle: 'nick', userId: currentUser.id }],
      users: [
        {
          id: currentUser.id,
          handle: currentUser.handle ?? null,
          handleLower: currentUser.handleLower ?? null,
          status: currentUser.status,
        },
      ],
    })
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('nick'), createContext(currentUser))

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'cannot_unfollow_self',
          message: 'Users cannot unfollow themselves.',
          field: 'handle',
        },
      ],
    })
    expect(repository.deleteByFollowerAndFollowed).not.toHaveBeenCalled()
  })

  it('returns 500 when the follow repository is not configured', async () => {
    const context = createContext()
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => {
        throw new Error('missing config')
      },
      targetStoreFactory: () => createStore(),
    })

    const response = await handler(createRequest('Ada'), context)

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The follow store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the follow repository.',
      {
        error: 'missing config',
      },
    )
  })

  it('returns 500 when the user profile store is not configured', async () => {
    const context = createContext()
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => {
        throw new Error('missing profile store')
      },
    })

    const response = await handler(createRequest('Ada'), context)

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The user profile store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the user profile store.',
      {
        error: 'missing profile store',
      },
    )
  })

  it('returns 500 when the follow write fails', async () => {
    const context = createContext()
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => createStoredFollow()),
      deleteByFollowerAndFollowed: vi.fn(async () => {
        throw new Error('Cosmos unavailable')
      }),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const handler = buildDeleteFollowHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('Ada'), context)

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.follow_delete_failed',
          message: 'Unable to delete the requested follow relationship.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to delete the follow relationship.',
      {
        error: 'Cosmos unavailable',
        followerId: 'github:abc123',
        followedId: 'u2',
      },
    )
  })
})
