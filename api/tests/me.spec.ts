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
    const repository: UserRepository = {
      getById: vi.fn(async () => existingUser),
      create: vi.fn(async (user) => user),
    }

    const handler = buildAuthMeHandler({
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
  })

  it('jit provisions a pending user on first sign-in', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (user) => user),
    }

    const handler = buildAuthMeHandler({
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
    }

    const handler = buildAuthMeHandler({
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
})
