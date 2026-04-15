import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetUserHandler } from '../src/functions/get-user.js'
import {
  lookupPublicUserProfile,
  type StoredUserDocument,
  type UserProfileStore,
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

function createStore(options?: {
  mirrors?: ExistingMirrorRecord[]
  users?: StoredUserDocument[]
}) {
  return new InMemoryUserProfileStore(
    new Map((options?.mirrors ?? []).map((record) => [record.handle, record])),
    new Map((options?.users ?? []).map((record) => [record.id, record])),
  )
}

describe('lookupPublicUserProfile', () => {
  it('returns a public profile by handle using a case-insensitive mirror lookup', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        {
          id: 'u1',
          handle: 'Ada',
          handleLower: 'ada',
          displayName: 'Ada Lovelace',
          bio: 'Symbolic AI nerd.',
          avatarUrl: 'https://cdn.example.com/ada.png',
          bannerUrl: 'https://cdn.example.com/ada-banner.png',
          expertise: ['llm', 'evals'],
          counters: {
            posts: 12,
            followers: 34,
            following: 5,
          },
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
          status: 'active',
        },
      ],
    })

    const result = await lookupPublicUserProfile(' Ada ', store)

    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          id: 'u1',
          handle: 'Ada',
          displayName: 'Ada Lovelace',
          bio: 'Symbolic AI nerd.',
          avatarUrl: 'https://cdn.example.com/ada.png',
          bannerUrl: 'https://cdn.example.com/ada-banner.png',
          expertise: ['llm', 'evals'],
          counters: {
            posts: 12,
            followers: 34,
            following: 5,
          },
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
        errors: [],
      },
    })
  })

  it('returns not found when the mirror points to a stale handle mapping', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        {
          id: 'u1',
          handle: 'Grace',
          handleLower: 'grace',
          status: 'active',
        },
      ],
    })

    const result = await lookupPublicUserProfile('Ada', store)

    expect(result.status).toBe(404)
    expect(result.body).toEqual({
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

  it('returns not found for a suspended user profile', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [
        {
          id: 'u1',
          handle: 'Ada',
          handleLower: 'ada',
          status: 'suspended',
        },
      ],
    })

    const result = await lookupPublicUserProfile('Ada', store)

    expect(result.status).toBe(404)
  })

  it('returns a validation error when the route parameter is missing', async () => {
    const result = await lookupPublicUserProfile(undefined, createStore())

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
})

describe('getUserHandler', () => {
  it('returns an HTTP response with the JSON envelope and headers', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      users: [{ id: 'u1', handle: 'Ada', handleLower: 'ada', status: 'active' }],
    })
    const handler = buildGetUserHandler(() => store)
    const context = {
      log: vi.fn(),
    } as unknown as InvocationContext

    const response = await handler(
      {
        params: { handle: 'Ada' },
      } as unknown as HttpRequest,
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        id: 'u1',
        handle: 'Ada',
        displayName: null,
        bio: null,
        avatarUrl: null,
        bannerUrl: null,
        expertise: [],
        counters: {
          posts: 0,
          followers: 0,
          following: 0,
        },
        createdAt: null,
        updatedAt: null,
      },
      errors: [],
    })
  })
})
