import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import { createSuccessResponse } from '../src/lib/api-envelope.js'
import { withHttpAuth } from '../src/lib/http-auth.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

function createPrincipalRequest(
  principal?: Record<string, unknown>,
): HttpRequest {
  const encodedPrincipal = principal
    ? Buffer.from(JSON.stringify(principal)).toString('base64')
    : null

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

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'abc123',
    userDetails: 'nickbeau',
    userRoles: ['authenticated', 'user'],
    claims: [],
    ...overrides,
  }
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

describe('withHttpAuth', () => {
  it('allows anonymous requests through and marks the context as anonymous', async () => {
    const innerHandler = vi.fn(
      async (_request: HttpRequest, context: InvocationContext) =>
        createSuccessResponse({
          isAuthenticated: context.auth?.isAuthenticated ?? null,
          roles: context.auth?.roles ?? [],
        }),
    )
    const handler = withHttpAuth(innerHandler, {
      allowAnonymous: true,
    })

    const response = await handler(createPrincipalRequest(), createContext())

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        isAuthenticated: false,
        roles: ['anonymous'],
      },
      errors: [],
    })
    expect(innerHandler).toHaveBeenCalledOnce()
  })

  it('returns 401 for protected routes without a principal header', async () => {
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        repositoryFactory: () => ({
          create: async (user) => user,
          getById: async () => null,
          upsert: async (user) => user,
        }),
      },
    )

    const response = await handler(createPrincipalRequest(), createContext())

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

  it('returns 401 for protected routes with a malformed principal header', async () => {
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        repositoryFactory: () => ({
          create: async (user) => user,
          getById: async () => null,
          upsert: async (user) => user,
        }),
      },
    )

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        claims: [],
      }),
      createContext(),
    )

    expect(response.status).toBe(401)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.invalid_principal',
          message: 'The authentication context is invalid.',
        },
      ],
    })
  })

  it('returns 403 when the authenticated user has no provisioned profile', async () => {
    const repository: UserRepository = {
      create: async (user) => user,
      getById: vi.fn(async () => null),
      upsert: async (user) => user,
    }
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        repositoryFactory: () => repository,
      },
    )

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['authenticated', 'user'],
        claims: [],
      }),
      createContext(),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user does not have a provisioned profile.',
        },
      ],
    })
  })

  it.each([
    {
      label: 'user',
      principalRoles: ['authenticated', 'user'],
      storedRoles: ['user'],
      requiredRoles: ['user'],
      expectedRoles: ['user'],
    },
    {
      label: 'moderator',
      principalRoles: ['authenticated', 'user', 'moderator'],
      storedRoles: ['moderator', 'user'],
      requiredRoles: ['moderator'],
      expectedRoles: ['moderator', 'user'],
    },
    {
      label: 'admin',
      principalRoles: ['authenticated', 'user', 'admin'],
      storedRoles: ['admin', 'moderator', 'user'],
      requiredRoles: ['admin'],
      expectedRoles: ['admin', 'moderator', 'user'],
    },
  ])(
    'attaches the resolved $label roles for an authorized request',
    async ({ principalRoles, storedRoles, requiredRoles, expectedRoles }) => {
      const repository: UserRepository = {
        create: async (user) => user,
        getById: vi.fn(async () =>
          createStoredUser({
            roles: storedRoles,
          }),
        ),
        upsert: async (user) => user,
      }
      const innerHandler = vi.fn(
        async (_request: HttpRequest, context: InvocationContext) =>
          createSuccessResponse({
            userId: context.auth?.user?.id ?? null,
            roles: context.auth?.roles ?? [],
          }),
      )
      const handler = withHttpAuth(innerHandler, {
        requiredRoles,
        repositoryFactory: () => repository,
      })

      const response = await handler(
        createPrincipalRequest(
          createAuthenticatedPrincipal({
            userRoles: principalRoles,
          }),
        ),
        createContext(),
      )

      expect(response.status).toBe(200)
      expect(response.jsonBody).toEqual({
        data: {
          userId: 'github:abc123',
          roles: expectedRoles,
        },
        errors: [],
      })
      expect(innerHandler).toHaveBeenCalledOnce()
    },
  )

  it('returns 403 when the resolved user lacks a required role', async () => {
    const repository: UserRepository = {
      create: async (user) => user,
      getById: vi.fn(async () => createStoredUser()),
      upsert: async (user) => user,
    }
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        requiredRoles: ['admin'],
        repositoryFactory: () => repository,
      },
    )

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message: 'The authenticated user does not have the required role.',
        },
      ],
    })
  })

  it('keeps anonymous routes working when user enrichment cannot be configured', async () => {
    const innerHandler = vi.fn(
      async (_request: HttpRequest, context: InvocationContext) =>
        createSuccessResponse({
          isAuthenticated: context.auth?.isAuthenticated ?? null,
          roles: context.auth?.roles ?? [],
        }),
    )
    const handler = withHttpAuth(innerHandler, {
      allowAnonymous: true,
      repositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        isAuthenticated: true,
        roles: ['authenticated', 'user'],
      },
      errors: [],
    })
    expect(innerHandler).toHaveBeenCalledOnce()
  })

  it('returns 500 for protected routes when the repository cannot be configured', async () => {
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        repositoryFactory: () => {
          throw new Error('missing config')
        },
      },
    )

    const response = await handler(
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['authenticated', 'user'],
        claims: [],
      }),
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

  it('rejects an invalid allowAnonymous plus requiredRoles configuration', () => {
    expect(() =>
      withHttpAuth(async () => createSuccessResponse({ ok: true }), {
        allowAnonymous: true,
        requiredRoles: ['admin'],
      }),
    ).toThrowError(
      'withHttpAuth cannot combine allowAnonymous with requiredRoles.',
    )
  })

  it('reuses the repository instance across requests for the same wrapper', async () => {
    const repositoryFactory = vi.fn(
      (): UserRepository => ({
        create: async (user) => user,
        getById: async () => createStoredUser(),
        upsert: async (user) => user,
      }),
    )
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        repositoryFactory,
      },
    )

    const request = createPrincipalRequest({
      ...createAuthenticatedPrincipal(),
    })

    await handler(request, createContext())
    await handler(request, createContext())

    expect(repositoryFactory).toHaveBeenCalledOnce()
  })
})
