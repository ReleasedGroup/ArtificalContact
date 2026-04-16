import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetFollowRelationshipHandler } from '../src/functions/get-follow-relationship.js'
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

  async findUserByHandle(handle: string): Promise<StoredUserDocument | null> {
    for (const user of this.users.values()) {
      if (user.handleLower === handle || user.handle === handle) {
        return user
      }
    }

    return null
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

describe('getFollowRelationshipHandler', () => {
  it('returns following=true when the viewer already follows the target', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => createStoredFollow()),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
})
    const handler = buildGetFollowRelationshipHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('Ada'), createContext())

    expect(response.status).toBe(200)
    expect(repository.getByFollowerAndFollowed).toHaveBeenCalledWith(
      'github:abc123',
      'u2',
    )
    expect(response.jsonBody).toEqual({
      data: {
        relationship: {
          handle: 'Ada',
          following: true,
        },
      },
      errors: [],
    })
  })

  it('returns following=false when the viewer does not follow the target', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u2' }],
      users: [{ id: 'u2', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const handler = buildGetFollowRelationshipHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(createRequest('Ada'), createContext())

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        relationship: {
          handle: 'Ada',
          following: false,
        },
      },
      errors: [],
    })
  })

  it('treats the authenticated user viewing their own profile as not-following', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => createStoredFollow()),
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
    const handler = buildGetFollowRelationshipHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => store,
    })

    const response = await handler(
      createRequest('nick'),
      createContext(currentUser),
    )

    expect(response.status).toBe(200)
    expect(repository.getByFollowerAndFollowed).not.toHaveBeenCalled()
    expect(response.jsonBody).toEqual({
      data: {
        relationship: {
          handle: 'nick',
          following: false,
        },
      },
      errors: [],
    })
  })

  it('rejects users without an active handled profile', async () => {
    const repository: FollowRepository = {
      create: vi.fn(async (follow) => follow),
      getByFollowerAndFollowed: vi.fn(async () => null),
      deleteByFollowerAndFollowed: vi.fn(async () => undefined),
    }
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower
    const handler = buildGetFollowRelationshipHandler({
      repositoryFactory: () => repository,
      targetStoreFactory: () => createStore(),
    })

    const response = await handler(
      createRequest('Ada'),
      createContext(pendingUser),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before checking follow relationships.',
        },
      ],
    })
  })
})
