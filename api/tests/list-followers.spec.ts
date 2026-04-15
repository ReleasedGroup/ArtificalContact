import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildListFollowersHandler } from '../src/functions/list-followers.js'
import {
  DEFAULT_FOLLOWERS_PAGE_SIZE,
  lookupFollowersPage,
} from '../src/lib/follower-list.js'
import type { FollowersMirrorRepository, FollowDocument } from '../src/lib/follows.js'
import type {
  StoredUserDocument,
  UserProfileStore,
} from '../src/lib/user-profile.js'
import type { ExistingMirrorRecord } from '../src/lib/users-by-handle-mirror.js'

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

function createProfileStore(options?: {
  mirrors?: ExistingMirrorRecord[]
  users?: StoredUserDocument[]
}) {
  return new InMemoryUserProfileStore(
    new Map((options?.mirrors ?? []).map((record) => [record.handle, record])),
    new Map((options?.users ?? []).map((record) => [record.id, record])),
  )
}

function createFollowersStore(result: {
  follows: FollowDocument[]
  continuationToken?: string
}) {
  return {
    listFollowers: vi.fn(async () => result),
  } satisfies FollowersMirrorRepository
}

function createStoredUser(
  id: string,
  overrides: Partial<StoredUserDocument> = {},
): StoredUserDocument {
  return {
    id,
    handle: `user-${id}`,
    handleLower: `user-${id}`.toLowerCase(),
    displayName: `User ${id}`,
    bio: `Bio for ${id}`,
    avatarUrl: `https://cdn.example.com/${id}.png`,
    bannerUrl: `https://cdn.example.com/${id}-banner.png`,
    expertise: ['llm'],
    counters: {
      posts: 3,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    status: 'active',
    ...overrides,
  }
}

function createFollowDocument(
  followerId: string,
  followedId: string,
  createdAt = '2026-04-15T05:00:00.000Z',
): FollowDocument {
  return {
    id: `${followerId}:${followedId}`,
    type: 'follow',
    followerId,
    followedId,
    createdAt,
  }
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('lookupFollowersPage', () => {
  it('returns the normalized first page of followers', async () => {
    const profileStore = createProfileStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createStoredUser('u1', {
          handle: 'Ada',
          handleLower: 'ada',
          displayName: 'Ada Lovelace',
        }),
        createStoredUser('u2', {
          handle: 'Grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
          expertise: ['systems', 'compilers'],
          counters: {
            posts: 12,
            followers: 34,
            following: 7,
          },
        }),
        createStoredUser('u3', {
          handle: 'Hidden',
          handleLower: 'hidden',
          status: 'suspended',
        }),
        createStoredUser('u4', {
          handle: null,
          handleLower: null,
        }),
      ],
    })
    const followersStore = createFollowersStore({
      follows: [
        createFollowDocument('u2', 'u1'),
        createFollowDocument('u3', 'u1', '2026-04-15T04:00:00.000Z'),
        createFollowDocument('u4', 'u1', '2026-04-15T03:00:00.000Z'),
      ],
      continuationToken: 'next-page-token',
    })

    const result = await lookupFollowersPage(
      {
        handle: ' Ada ',
        limit: '2',
        continuationToken: ' opaque-token ',
      },
      profileStore,
      followersStore,
    )

    expect(followersStore.listFollowers).toHaveBeenCalledWith('u1', {
      limit: 2,
      continuationToken: 'opaque-token',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          users: [
            {
              id: 'u2',
              handle: 'Grace',
              displayName: 'Grace Hopper',
              bio: 'Bio for u2',
              avatarUrl: 'https://cdn.example.com/u2.png',
              bannerUrl: 'https://cdn.example.com/u2-banner.png',
              expertise: ['systems', 'compilers'],
              counters: {
                posts: 12,
                followers: 34,
                following: 7,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
            },
          ],
          continuationToken: 'next-page-token',
        },
        errors: [],
      },
    })
  })

  it('uses the default page size and allows empty pages', async () => {
    const profileStore = createProfileStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createStoredUser('u1', {
          handle: 'Ada',
          handleLower: 'ada',
        }),
      ],
    })
    const followersStore = createFollowersStore({
      follows: [],
    })

    const result = await lookupFollowersPage(
      {
        handle: 'ada',
      },
      profileStore,
      followersStore,
    )

    expect(followersStore.listFollowers).toHaveBeenCalledWith('u1', {
      limit: DEFAULT_FOLLOWERS_PAGE_SIZE,
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          users: [],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('returns a validation error when the handle is missing', async () => {
    const result = await lookupFollowersPage(
      {
        handle: '  ',
      },
      createProfileStore(),
      createFollowersStore({
        follows: [],
      }),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_handle',
            message: 'The handle path parameter is required.',
            field: 'handle',
          },
        ],
      },
    })
  })

  it('returns a validation error when the limit is invalid', async () => {
    const result = await lookupFollowersPage(
      {
        handle: 'ada',
        limit: '500',
      },
      createProfileStore({
        mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
        users: [createStoredUser('u1', { handle: 'Ada', handleLower: 'ada' })],
      }),
      createFollowersStore({
        follows: [],
      }),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_limit',
            message: 'The limit query parameter must be an integer between 1 and 100.',
            field: 'limit',
          },
        ],
      },
    })
  })

  it('returns not found when the target profile does not exist', async () => {
    const result = await lookupFollowersPage(
      {
        handle: 'ada',
      },
      createProfileStore(),
      createFollowersStore({
        follows: [],
      }),
    )

    expect(result).toEqual({
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'user_not_found',
            message: 'No public profile exists for the requested handle.',
            field: 'handle',
          },
        ],
      },
    })
  })
})

describe('listFollowersHandler', () => {
  it('returns an HTTP response with the followers envelope and headers', async () => {
    const profileStore = createProfileStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createStoredUser('u1', {
          handle: 'Ada',
          handleLower: 'ada',
        }),
        createStoredUser('u2', {
          handle: 'Grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
        }),
      ],
    })
    const followersStore = createFollowersStore({
      follows: [createFollowDocument('u2', 'u1')],
      continuationToken: 'next-page-token',
    })
    const handler = buildListFollowersHandler({
      profileStoreFactory: () => profileStore,
      followersStoreFactory: () => followersStore,
    })

    const response = await handler(
      {
        params: { handle: 'Ada' },
        query: new URLSearchParams('limit=10&continuationToken=opaque-token'),
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(followersStore.listFollowers).toHaveBeenCalledWith('u1', {
      limit: 10,
      continuationToken: 'opaque-token',
    })
    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        users: [
          {
            id: 'u2',
            handle: 'Grace',
            displayName: 'Grace Hopper',
            bio: 'Bio for u2',
            avatarUrl: 'https://cdn.example.com/u2.png',
            bannerUrl: 'https://cdn.example.com/u2-banner.png',
            expertise: ['llm'],
            counters: {
              posts: 3,
              followers: 8,
              following: 5,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T01:00:00.000Z',
          },
        ],
        continuationToken: 'next-page-token',
      },
      errors: [],
    })
  })

  it('returns a predictable 500 response when the user profile store is not configured', async () => {
    const handler = buildListFollowersHandler({
      profileStoreFactory: () => {
        throw new Error('Missing Cosmos configuration')
      },
      followersStoreFactory: () =>
        createFollowersStore({
          follows: [],
        }),
    })

    const response = await handler(
      {
        params: { handle: 'Ada' },
        query: new URLSearchParams(),
      } as unknown as HttpRequest,
      createContext(),
    )

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
  })

  it('returns a predictable 500 response when the followers store is not configured', async () => {
    const handler = buildListFollowersHandler({
      profileStoreFactory: () => createProfileStore(),
      followersStoreFactory: () => {
        throw new Error('Missing followers container')
      },
    })

    const response = await handler(
      {
        params: { handle: 'Ada' },
        query: new URLSearchParams(),
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The followers store is not configured.',
        },
      ],
    })
  })

  it('returns 500 when the followers lookup fails', async () => {
    const handler = buildListFollowersHandler({
      profileStoreFactory: () =>
        createProfileStore({
          mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
          users: [
            createStoredUser('u1', {
              handle: 'Ada',
              handleLower: 'ada',
            }),
          ],
        }),
      followersStoreFactory: () => ({
        listFollowers: vi.fn(async () => {
          throw new Error('Cosmos unavailable')
        }),
      }),
    })

    const response = await handler(
      {
        params: { handle: 'Ada' },
        query: new URLSearchParams(),
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.followers_lookup_failed',
          message: 'Unable to load the requested followers list.',
        },
      ],
    })
  })
})
