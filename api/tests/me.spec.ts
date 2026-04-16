import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildAuthMeHandler } from '../src/functions/me.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

function createPrincipalRequest(
  principal: Record<string, unknown>,
): HttpRequest {
  const encodedPrincipal = Buffer.from(JSON.stringify(principal)).toString(
    'base64',
  )

  return {
    headers: {
      get(name: string) {
        if (name.toLowerCase() !== CLIENT_PRINCIPAL_HEADER) {
          return null
        }

        return encodedPrincipal
      },
    },
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

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('authMeHandler', () => {
  it('returns the existing user profile without provisioning a new document', async () => {
    const existingUser = createStoredUser()
    const emitSigninTelemetry = vi.fn()
    const repository: UserRepository = {
      getById: vi.fn(async () => existingUser),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => 8),
      countActiveFollowing: vi.fn(async () => 5),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 3),
    }

    const handler = buildAuthMeHandler({
      emitSigninTelemetry,
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [{ typ: 'emails', val: 'nick@example.com' }],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        isNewUser: false,
        user: {
          id: 'github:abc123',
          handle: 'nick',
          status: 'active',
        },
      },
      errors: [],
    })
    expect(repository.create).not.toHaveBeenCalled()
    expect(emitSigninTelemetry).toHaveBeenCalledWith({
      identityProvider: 'github',
      isNewUser: false,
    })
    expect(postCounterStore.countActiveRootPostsByAuthorId).toHaveBeenCalledWith(
      'github:abc123',
    )
    expect(followCounterStore.countActiveFollowers).toHaveBeenCalledWith(
      'github:abc123',
    )
    expect(followCounterStore.countActiveFollowing).toHaveBeenCalledWith(
      'github:abc123',
    )
  })

  it('jit provisions a pending user on first sign-in', async () => {
    const emitSigninTelemetry = vi.fn()
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => 0),
      countActiveFollowing: vi.fn(async () => 0),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 0),
    }

    const handler = buildAuthMeHandler({
      emitSigninTelemetry,
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:30:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [
          { typ: 'name', val: 'Nick Beaugeard' },
          { typ: 'emails', val: 'nick@example.com' },
        ],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        isNewUser: true,
        user: {
          id: 'github:abc123',
          handle: null,
          displayName: 'Nick Beaugeard',
          email: 'nick@example.com',
          status: 'pending',
        },
      },
      errors: [],
    })
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        status: 'pending',
        createdAt: '2026-04-15T02:30:00.000Z',
        updatedAt: '2026-04-15T02:30:00.000Z',
      }),
    )
    expect(emitSigninTelemetry).toHaveBeenCalledWith({
      identityProvider: 'github',
      isNewUser: true,
    })
  })

  it('re-reads the user when jit provisioning races with another request', async () => {
    const existingUser = createStoredUser({
      status: 'pending',
    })
    delete existingUser.handle
    delete existingUser.handleLower

    const repository: UserRepository = {
      getById: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingUser),
      create: vi.fn(async () => {
        const error = new Error('Conflict')
        ;(error as Error & { statusCode: number }).statusCode = 409
        throw error
      }),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => 8),
      countActiveFollowing: vi.fn(async () => 5),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 3),
    }

    const handler = buildAuthMeHandler({
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:45:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        isNewUser: false,
        user: {
          id: 'github:abc123',
          status: 'pending',
        },
      },
      errors: [],
    })
  })

  it('returns a 401 response when the request is unauthenticated', async () => {
    const handler = buildAuthMeHandler({
      repositoryFactory: () => ({
        getById: async () => null,
        create: async (user) => user,
        upsert: async (user) => user,
      }),
    })

    const response = await handler(
      { headers: { get: () => null } } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(401)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.missing_principal',
          message: 'Authentication is required.',
        },
      ],
    })
  })

  it('does not fail the request when auth.signin telemetry emission throws', async () => {
    const context = createContext()
    const repository: UserRepository = {
      getById: vi.fn(async () => createStoredUser()),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => 8),
      countActiveFollowing: vi.fn(async () => 5),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 3),
    }

    const handler = buildAuthMeHandler({
      emitSigninTelemetry: () => {
        throw new Error('Telemetry unavailable')
      },
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [{ typ: 'emails', val: 'nick@example.com' }],
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(context.log).toHaveBeenCalledWith(
      'Failed to emit auth.signin telemetry.',
      {
        error: 'Telemetry unavailable',
      },
    )
  })

  it('returns live counters when the stored profile counters are stale', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () =>
        createStoredUser({
          counters: {
            posts: 0,
            followers: 0,
            following: 0,
          },
        }),
      ),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => 1),
      countActiveFollowing: vi.fn(async () => 2),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 4),
    }

    const handler = buildAuthMeHandler({
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [{ typ: 'emails', val: 'nick@example.com' }],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        user: {
          counters: {
            posts: 4,
            followers: 1,
            following: 2,
          },
        },
      },
      errors: [],
    })
  })

  it('falls back to the stored counters when live counter reconciliation fails', async () => {
    const context = createContext()
    const repository: UserRepository = {
      getById: vi.fn(async () => createStoredUser()),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const followCounterStore = {
      countActiveFollowers: vi.fn(async () => {
        throw new Error('Followers unavailable')
      }),
      countActiveFollowing: vi.fn(async () => 5),
    }
    const postCounterStore = {
      countActiveRootPostsByAuthorId: vi.fn(async () => 3),
    }

    const handler = buildAuthMeHandler({
      followCounterStoreFactory: () => followCounterStore,
      postCounterStoreFactory: () => postCounterStore,
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated'],
        claims: [{ typ: 'emails', val: 'nick@example.com' }],
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        user: {
          counters: {
            posts: 3,
            followers: 8,
            following: 5,
          },
        },
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to reconcile authenticated profile counters.',
      {
        error: 'Followers unavailable',
        userId: 'github:abc123',
      },
    )
  })
})
