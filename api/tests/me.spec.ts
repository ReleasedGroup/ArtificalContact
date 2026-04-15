import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAuthMeHandler,
  buildUpdateProfileHandler,
} from '../src/functions/me.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

function createPrincipalRequest(
  principal: Record<string, unknown>,
  body?: unknown,
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

function createRepository(
  existingUser: UserDocument | null = createStoredUser(),
): UserRepository {
  return {
    getById: vi.fn(async () => existingUser),
    create: vi.fn(async (user) => user),
    replace: vi.fn(async (user) => user),
  }
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

const authenticatedPrincipal = {
  identityProvider: 'github',
  userId: 'abc123',
  userDetails: 'nickbeau',
  userRoles: ['anonymous', 'authenticated'],
  claims: [
    { typ: 'name', val: 'Nick Beaugeard' },
    { typ: 'emails', val: 'nick@example.com' },
  ],
}

describe('authMeHandler', () => {
  it('returns the existing user profile without provisioning a new document', async () => {
    const existingUser = createStoredUser()
    const repository = createRepository(existingUser)

    const handler = buildAuthMeHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal),
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
    expect(repository.replace).not.toHaveBeenCalled()
  })

  it('jit provisions a pending user on first sign-in', async () => {
    const repository = createRepository(null)

    const handler = buildAuthMeHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:30:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal),
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
      replace: vi.fn(async (user) => user),
    }

    const handler = buildAuthMeHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T02:45:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal),
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
      repositoryFactory: () => createRepository(null),
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
})

describe('updateProfileHandler', () => {
  it('updates the authenticated profile with normalized expertise tags', async () => {
    const existingUser = createStoredUser({
      bio: 'Old bio',
      avatarUrl: 'https://cdn.example.com/avatar.png',
    })
    const repository = createRepository(existingUser)

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T03:00:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal, {
        displayName: '  Ada Lovelace  ',
        bio: '  Building robust agent evals.  ',
        expertise: ['LLM', ' evals ', 'llm', ''],
        avatarUrl: null,
        bannerUrl: null,
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        displayName: 'Ada Lovelace',
        bio: 'Building robust agent evals.',
        expertise: ['llm', 'evals'],
        updatedAt: '2026-04-15T03:00:00.000Z',
      }),
    )
    expect(response.jsonBody).toMatchObject({
      data: {
        isNewUser: false,
        user: {
          displayName: 'Ada Lovelace',
          bio: 'Building robust agent evals.',
          expertise: ['llm', 'evals'],
          avatarUrl: null,
          bannerUrl: null,
        },
      },
      errors: [],
    })
  })

  it('jit provisions a user before applying the profile update on first save', async () => {
    const repository = createRepository(null)

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
      now: () => new Date('2026-04-15T03:30:00.000Z'),
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal, {
        displayName: 'Nick Beaugeard',
        bio: '',
        expertise: ['agents'],
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(repository.create).toHaveBeenCalledOnce()
    expect(repository.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:abc123',
        displayName: 'Nick Beaugeard',
        expertise: ['agents'],
        updatedAt: '2026-04-15T03:30:00.000Z',
      }),
    )
    expect(response.jsonBody).toMatchObject({
      data: {
        isNewUser: true,
        user: {
          displayName: 'Nick Beaugeard',
          expertise: ['agents'],
        },
      },
      errors: [],
    })
  })

  it('returns a validation error when the display name is blank', async () => {
    const repository = createRepository()

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal, {
        displayName: '   ',
        bio: '',
        expertise: [],
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'profile.invalid_payload',
          field: 'displayName',
          message: 'Display name cannot be empty.',
        },
      ],
    })
    expect(repository.replace).not.toHaveBeenCalled()
  })

  it('returns a validation error when too many expertise tags are supplied', async () => {
    const repository = createRepository()

    const handler = buildUpdateProfileHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createPrincipalRequest(authenticatedPrincipal, {
        displayName: 'Nick Beaugeard',
        bio: '',
        expertise: [
          'one',
          'two',
          'three',
          'four',
          'five',
          'six',
          'seven',
          'eight',
          'nine',
          'ten',
          'eleven',
          'twelve',
          'thirteen',
        ],
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'profile.invalid_payload',
          field: 'expertise',
          message: 'Add at most 12 expertise tags.',
        },
      ],
    })
  })
})
