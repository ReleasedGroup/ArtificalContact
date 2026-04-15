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
          getById: async () => null,
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

  it('returns 403 when the authenticated user has no provisioned profile', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => null),
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

  it('attaches the resolved user and roles for an authorized request', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () =>
        createStoredUser({
          roles: ['moderator', 'user'],
        }),
      ),
    }
    const innerHandler = vi.fn(
      async (_request: HttpRequest, context: InvocationContext) =>
        createSuccessResponse({
          userId: context.auth?.user?.id ?? null,
          roles: context.auth?.roles ?? [],
        }),
    )
    const handler = withHttpAuth(innerHandler, {
      requiredRoles: ['moderator'],
      repositoryFactory: () => repository,
    })

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

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        userId: 'github:abc123',
        roles: ['moderator', 'user'],
      },
      errors: [],
    })
    expect(innerHandler).toHaveBeenCalledOnce()
  })

  it('returns 403 when the resolved user lacks a required role', async () => {
    const repository: UserRepository = {
      getById: vi.fn(async () => createStoredUser()),
    }
    const handler = withHttpAuth(
      async () => createSuccessResponse({ ok: true }),
      {
        requiredRoles: ['admin'],
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
      createPrincipalRequest({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['authenticated', 'user'],
        claims: [],
      }),
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
})
