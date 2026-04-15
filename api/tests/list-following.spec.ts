import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildListFollowingHandler } from '../src/functions/list-following.js'
import {
  DEFAULT_FOLLOWING_PAGE_SIZE,
  lookupFollowing,
  type FollowingPageRequest,
} from '../src/lib/following.js'
import type {
  FollowDocument,
  FollowingListRepository,
} from '../src/lib/follows.js'
import type {
  StoredUserDocument,
  UserProfileStore,
} from '../src/lib/user-profile.js'
import type { ExistingMirrorRecord } from '../src/lib/users-by-handle-mirror.js'

function createFollow(overrides: Partial<FollowDocument> = {}): FollowDocument {
  return {
    id: 'u1:u2',
    type: 'follow',
    followerId: 'u1',
    followedId: 'u2',
    createdAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

function createUser(
  overrides: Partial<StoredUserDocument> = {},
): StoredUserDocument {
  return {
    id: 'u1',
    handle: 'ada',
    handleLower: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Analytical engine enthusiast.',
    avatarUrl: 'https://cdn.example.com/ada.png',
    bannerUrl: 'https://cdn.example.com/ada-banner.png',
    expertise: ['ai', 'math'],
    counters: {
      posts: 10,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    status: 'active',
    ...overrides,
  }
}

function createStore({
  mirrors = [],
  users = [],
}: {
  mirrors?: ExistingMirrorRecord[]
  users?: StoredUserDocument[]
} = {}): UserProfileStore {
  return {
    getByHandle: vi.fn(async (handle: string) => {
      return mirrors.find((mirror) => mirror.handle === handle) ?? null
    }),
    getUserById: vi.fn(async (userId: string) => {
      return users.find((user) => user.id === userId) ?? null
    }),
  }
}

function createRepository(result: {
  follows: FollowDocument[]
  continuationToken?: string
}): FollowingListRepository {
  return {
    listByFollowerId: vi.fn(async () => result),
  }
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('lookupFollowing', () => {
  it('returns a normalized following page for an existing public profile', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createUser(),
        createUser({
          id: 'u2',
          handle: 'grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
          avatarUrl: 'https://cdn.example.com/grace.png',
        }),
        createUser({
          id: 'u3',
          handle: 'linus',
          handleLower: 'linus',
          displayName: 'Linus Torvalds',
          avatarUrl: 'https://cdn.example.com/linus.png',
        }),
      ],
    })
    const repository = createRepository({
      follows: [
        createFollow(),
        createFollow({
          id: 'u1:u3',
          followedId: 'u3',
          createdAt: '2026-04-14T00:00:00.000Z',
        }),
      ],
      continuationToken: 'next-page-token',
    })

    const result = await lookupFollowing(
      {
        handle: ' ada ',
        limit: '2',
      },
      repository,
      store,
    )

    expect(repository.listByFollowerId).toHaveBeenCalledWith('u1', {
      limit: 2,
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          handle: 'ada',
          following: [
            {
              id: 'u2',
              handle: 'grace',
              displayName: 'Grace Hopper',
              bio: 'Analytical engine enthusiast.',
              avatarUrl: 'https://cdn.example.com/grace.png',
              bannerUrl: 'https://cdn.example.com/ada-banner.png',
              expertise: ['ai', 'math'],
              counters: {
                posts: 10,
                followers: 8,
                following: 5,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
            },
            {
              id: 'u3',
              handle: 'linus',
              displayName: 'Linus Torvalds',
              bio: 'Analytical engine enthusiast.',
              avatarUrl: 'https://cdn.example.com/linus.png',
              bannerUrl: 'https://cdn.example.com/ada-banner.png',
              expertise: ['ai', 'math'],
              counters: {
                posts: 10,
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
      },
    })
  })

  it('uses the default page size and allows empty continuation pages', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [createUser()],
    })
    const repository = createRepository({
      follows: [],
    })

    const request: FollowingPageRequest = {
      handle: 'ada',
      continuationToken: 'opaque-token',
    }
    const result = await lookupFollowing(request, repository, store)

    expect(repository.listByFollowerId).toHaveBeenCalledWith('u1', {
      limit: DEFAULT_FOLLOWING_PAGE_SIZE,
      continuationToken: 'opaque-token',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          handle: 'ada',
          following: [],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('returns a validation error when the limit is invalid', async () => {
    const result = await lookupFollowing(
      {
        handle: 'ada',
        limit: '500',
      },
      createRepository({
        follows: [],
      }),
      createStore({
        mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
        users: [createUser()],
      }),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_limit',
            message:
              'The limit query parameter must be an integer between 1 and 100.',
            field: 'limit',
          },
        ],
      },
    })
  })

  it('returns not found when the source user does not exist', async () => {
    const result = await lookupFollowing(
      {
        handle: 'missing',
      },
      createRepository({
        follows: [],
      }),
      createStore(),
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

  it('filters missing and non-public followed users from the page', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createUser(),
        createUser({
          id: 'u2',
          handle: 'grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
        }),
        createUser({
          id: 'u3',
          handle: 'hidden',
          handleLower: 'hidden',
          status: 'suspended',
        }),
      ],
    })
    const repository = createRepository({
      follows: [
        createFollow(),
        createFollow({
          id: 'u1:u3',
          followedId: 'u3',
        }),
        createFollow({
          id: 'u1:u4',
          followedId: 'u4',
        }),
      ],
    })

    const result = await lookupFollowing(
      {
        handle: 'ada',
      },
      repository,
      store,
    )

    expect(result.body.data).toEqual({
      handle: 'ada',
      following: [
        {
          id: 'u2',
          handle: 'grace',
          displayName: 'Grace Hopper',
          bio: 'Analytical engine enthusiast.',
          avatarUrl: 'https://cdn.example.com/ada.png',
          bannerUrl: 'https://cdn.example.com/ada-banner.png',
          expertise: ['ai', 'math'],
          counters: {
            posts: 10,
            followers: 8,
            following: 5,
          },
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T01:00:00.000Z',
        },
      ],
      continuationToken: null,
    })
  })
})

describe('listFollowingHandler', () => {
  it('returns an HTTP response with the following envelope and headers', async () => {
    const repository = createRepository({
      follows: [createFollow()],
      continuationToken: 'next-page-token',
    })
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        createUser(),
        createUser({
          id: 'u2',
          handle: 'grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
        }),
      ],
    })
    const handler = buildListFollowingHandler({
      repositoryFactory: () => repository,
      storeFactory: () => store,
    })

    const response = await handler(
      {
        params: { handle: 'ada' },
        query: new URLSearchParams('limit=10&continuationToken=opaque-token'),
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(repository.listByFollowerId).toHaveBeenCalledWith('u1', {
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
        handle: 'ada',
        following: [
          {
            id: 'u2',
            handle: 'grace',
            displayName: 'Grace Hopper',
            bio: 'Analytical engine enthusiast.',
            avatarUrl: 'https://cdn.example.com/ada.png',
            bannerUrl: 'https://cdn.example.com/ada-banner.png',
            expertise: ['ai', 'math'],
            counters: {
              posts: 10,
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

  it('returns a predictable 500 response when the repository is not configured', async () => {
    const handler = buildListFollowingHandler({
      repositoryFactory: () => {
        throw new Error('Missing Cosmos configuration')
      },
    })

    const response = await handler(
      {
        params: { handle: 'ada' },
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
          message: 'The follow store is not configured.',
        },
      ],
    })
  })
})
