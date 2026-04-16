import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildUpdateProfileHandler } from '../src/functions/update-profile.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import type {
  ExistingMirrorRecord,
  ExistingUserHandleState,
  UsersByHandleMirrorDocument,
  UsersByHandleMirrorStateDocument,
} from '../src/lib/users-by-handle-mirror.js'
import type {
  MeProfile,
  UserDocument,
  UserRepository,
} from '../src/lib/users.js'

class InMemoryHandleStore {
  constructor(
    private readonly mirrors = new Map<string, ExistingMirrorRecord>(),
    private readonly states = new Map<string, ExistingUserHandleState>(),
  ) {}

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.mirrors.get(handle) ?? null
  }

  async getStateByUserId(userId: string): Promise<ExistingUserHandleState | null> {
    return this.states.get(userId) ?? null
  }

  async upsertMirror(document: UsersByHandleMirrorDocument): Promise<void> {
    this.mirrors.set(document.handle, {
      id: document.id,
      handle: document.handle,
      userId: document.userId,
    })
  }

  async upsertState(document: UsersByHandleMirrorStateDocument): Promise<void> {
    this.states.set(document.userId, {
      id: document.id,
      handle: document.handle,
      userId: document.userId,
      currentHandle: document.currentHandle,
    })
  }

  async deleteByHandle(handle: string): Promise<void> {
    this.mirrors.delete(handle)
  }

  async deleteStateByUserId(userId: string): Promise<void> {
    this.states.delete(userId)
  }
}

function createPrincipalRequest(
  principal: Record<string, unknown>,
  body: unknown,
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
    json: async () => body,
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
    bio: 'Old bio',
    avatarUrl: 'https://cdn.example.com/old-avatar.png',
    bannerUrl: 'https://cdn.example.com/old-banner.png',
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

describe('updateProfileHandler', () => {
  it('updates the stored profile fields with normalized values', async () => {
    const existingUser = createStoredUser()
    const repository: UserRepository = {
      getById: vi.fn(async () => existingUser),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          displayName: '  Nick B.  ',
          bio: '  Building AI systems.  ',
          avatarUrl: ' https://cdn.example.com/new-avatar.png ',
          bannerUrl: '',
          expertise: ['LLM', ' evals ', 'llm'],
          links: {
            Website: 'https://example.com/about',
            github: 'https://github.com/nickbeau',
          },
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Nick B.',
        bio: 'Building AI systems.',
        avatarUrl: 'https://cdn.example.com/new-avatar.png',
        expertise: ['llm', 'evals'],
        links: {
          website: 'https://example.com/about',
          github: 'https://github.com/nickbeau',
        },
        updatedAt: '2026-04-15T02:00:00.000Z',
      }),
    )

    const responseBody = response.jsonBody as {
      data: {
        user: MeProfile
      }
      errors: unknown[]
    }

    expect(responseBody).toEqual({
      data: {
        user: {
          id: 'github:abc123',
          identityProvider: 'github',
          identityProviderUserId: 'abc123',
          email: 'nick@example.com',
          handle: 'nick',
          displayName: 'Nick B.',
          bio: 'Building AI systems.',
          avatarUrl: 'https://cdn.example.com/new-avatar.png',
          bannerUrl: null,
          expertise: ['llm', 'evals'],
          links: {
            website: 'https://example.com/about',
            github: 'https://github.com/nickbeau',
          },
          status: 'active',
          roles: ['user'],
          counters: {
            posts: 3,
            followers: 8,
            following: 5,
          },
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T02:00:00.000Z',
        },
      },
      errors: [],
    })
  })

  it('rejects a handle that is already owned by another user', async () => {
    const existingUser = createStoredUser()
    const repository: UserRepository = {
      getById: vi.fn(async () => existingUser),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      handleStoreFactory: () =>
        new InMemoryHandleStore(
          new Map([
            ['ada', { id: 'ada', handle: 'ada', userId: 'github:someone-else' }],
          ]),
        ),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          handle: ' Ada ',
          displayName: 'Nick',
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(409)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'handle_taken',
          message: 'The requested handle is already in use.',
          field: 'handle',
        },
      ],
    })
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('updates the handle and promotes a pending user when the handle is free', async () => {
    const existingUser = createStoredUser({
      handle: 'nick',
      handleLower: 'nick',
      status: 'pending',
    })
    const repository: UserRepository = {
      getById: vi.fn(async () => existingUser),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handleStore = new InMemoryHandleStore(
      new Map([['nick', { id: 'nick', handle: 'nick', userId: 'github:abc123' }]]),
    )

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      handleStoreFactory: () => handleStore,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          handle: 'Ada',
          displayName: 'Ada Lovelace',
          bio: 'Symbolic AI nerd.',
          expertise: ['LLM', 'evals', 'llm'],
          links: {
            website: 'https://ada.dev',
          },
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        handle: 'Ada',
        handleLower: 'ada',
        displayName: 'Ada Lovelace',
        bio: 'Symbolic AI nerd.',
        expertise: ['llm', 'evals'],
        links: {
          website: 'https://ada.dev',
        },
        status: 'active',
        updatedAt: '2026-04-15T02:00:00.000Z',
      }),
    )
    expect(response.jsonBody).toMatchObject({
      data: {
        user: {
          handle: 'Ada',
          status: 'active',
          expertise: ['llm', 'evals'],
        },
      },
      errors: [],
    })
    await expect(handleStore.getByHandle('ada')).resolves.toEqual({
      id: 'ada',
      handle: 'ada',
      userId: 'github:abc123',
    })
    await expect(handleStore.getByHandle('nick')).resolves.toBeNull()
    await expect(handleStore.getStateByUserId('github:abc123')).resolves.toEqual({
      id: '__usersByHandleState__:github:abc123',
      handle: '__usersByHandleState__:github:abc123',
      userId: 'github:abc123',
      currentHandle: 'ada',
    })
  })

  it('jit provisions a profile before applying the update when the user is new', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T03:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'name', val: 'Nick Beaugeard' }],
        },
        {
          displayName: 'Nick Beaugeard',
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.create).toHaveBeenCalledOnce()
    expect(repository.upsert).not.toHaveBeenCalled()
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        displayName: 'Nick Beaugeard',
        status: 'pending',
      }),
    )
  })

  it('allows github-prefixed handles because reservation is deferred to sprint 9', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      handleStoreFactory: () => new InMemoryHandleStore(),
      now: () => new Date('2026-04-15T02:30:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'emails', val: 'nick@example.com' }],
        },
        {
          handle: 'github/openai-cookbook',
          displayName: 'Nick',
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.create).toHaveBeenCalledOnce()
    expect(repository.upsert).not.toHaveBeenCalled()
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'github/openai-cookbook',
        handleLower: 'github/openai-cookbook',
        status: 'active',
      }),
    )
  })

  it('creates the public-profile mirror immediately when a new profile claims a handle', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }
    const handleStore = new InMemoryHandleStore()

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      handleStoreFactory: () => handleStore,
      now: () => new Date('2026-04-15T03:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [{ typ: 'name', val: 'Nick Beaugeard' }],
        },
        {
          handle: 'NickBeau',
          displayName: 'Nick Beaugeard',
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    await expect(handleStore.getByHandle('nickbeau')).resolves.toEqual({
      id: 'nickbeau',
      handle: 'nickbeau',
      userId: 'github:abc123',
    })
    await expect(handleStore.getStateByUserId('github:abc123')).resolves.toEqual({
      id: '__usersByHandleState__:github:abc123',
      handle: '__usersByHandleState__:github:abc123',
      userId: 'github:abc123',
      currentHandle: 'nickbeau',
    })
  })

  it('retries against a concurrently provisioned user after a create conflict', async () => {
    const existingUser = createStoredUser({
      status: 'pending',
    })

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

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T03:15:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [],
        },
        {
          bio: 'Recovered after a race.',
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.create).toHaveBeenCalledOnce()
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        bio: 'Recovered after a race.',
      }),
    )
  })

  it('returns validation errors when the profile payload is invalid', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => createStoredUser()),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [],
        },
        {
          displayName: '   ',
          avatarUrl: 'not-a-url',
          links: {
            '   ': 'https://example.com',
          },
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_profile',
          message: 'Too small: expected string to have >=1 characters',
          field: 'displayName',
        },
        {
          code: 'invalid_profile',
          message: 'Invalid URL',
          field: 'avatarUrl',
        },
        {
          code: 'invalid_profile',
          message: 'Link keys must not be empty.',
          field: 'links.   ',
        },
      ],
    })
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('rejects duplicate links after key normalization', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => createStoredUser()),
      create: vi.fn(async (user) => user),
      upsert: vi.fn(async (user) => user),
    }

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest(
        {
          identityProvider: 'github',
          userId: 'abc123',
          userDetails: 'nickbeau',
          userRoles: ['anonymous', 'authenticated'],
          claims: [],
        },
        {
          links: {
            GitHub: 'https://github.com/nickbeau',
            github: 'https://github.com/releasedgroup',
          },
        },
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_profile',
          message: "Duplicate link key 'github' is not allowed.",
          field: 'links.github',
        },
      ],
    })
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('returns a 400 response when the body is not valid JSON', async () => {
    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => ({
        getById: async () => createStoredUser(),
        create: async (user) => user,
        upsert: async (user) => user,
      }),
    })

    const response = await handler(
      {
        headers: {
          get(name: string) {
            if (name.toLowerCase() !== CLIENT_PRINCIPAL_HEADER) {
              return null
            }

            return Buffer.from(
              JSON.stringify({
                identityProvider: 'github',
                userId: 'abc123',
                userDetails: 'nickbeau',
                userRoles: ['anonymous', 'authenticated'],
                claims: [],
              }),
            ).toString('base64')
          },
        },
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_json',
          message: 'The request body must be valid JSON.',
        },
      ],
    })
  })
})
