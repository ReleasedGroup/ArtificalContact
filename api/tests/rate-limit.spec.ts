import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import { createSuccessResponse } from '../src/lib/api-envelope.js'
import { withHttpAuth } from '../src/lib/http-auth.js'
import {
  evaluateRateLimitBucket,
  resolveRateLimitPolicy,
  withRateLimit,
  type RateLimitConsumeResult,
  type RateLimitRepository,
} from '../src/lib/rate-limit.js'
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

describe('evaluateRateLimitBucket', () => {
  it('refills tokens over elapsed time and consumes one token when allowed', () => {
    const evaluation = evaluateRateLimitBucket(
      {
        lastRefillAt: '2026-04-16T00:00:00.000Z',
        tokens: 2,
      },
      {
        capacity: 6,
        refillPerMinute: 6,
      },
      new Date('2026-04-16T00:00:30.000Z'),
    )

    expect(evaluation).toEqual({
      allowed: true,
      availableTokens: 5,
      remainingTokens: 4,
      retryAfterSeconds: 0,
    })
  })

  it('returns a retry-after value when the bucket is empty', () => {
    const evaluation = evaluateRateLimitBucket(
      {
        lastRefillAt: '2026-04-16T00:00:00.000Z',
        tokens: 0,
      },
      {
        capacity: 6,
        refillPerMinute: 6,
      },
      new Date('2026-04-16T00:00:00.000Z'),
    )

    expect(evaluation).toEqual({
      allowed: false,
      availableTokens: 0,
      remainingTokens: 0,
      retryAfterSeconds: 10,
    })
  })
})

describe('resolveRateLimitPolicy', () => {
  it('uses per-endpoint environment overrides when provided', () => {
    const policy = resolveRateLimitPolicy('posts', {
      RATE_LIMIT_POSTS_CAPACITY: '12',
      RATE_LIMIT_POSTS_REFILL_PER_MINUTE: '24',
    })

    expect(policy).toEqual({
      capacity: 12,
      refillPerMinute: 24,
    })
  })

  it('falls back to defaults when the configured values are invalid', () => {
    const policy = resolveRateLimitPolicy('reports', {
      RATE_LIMIT_REPORTS_CAPACITY: '0',
      RATE_LIMIT_REPORTS_REFILL_PER_MINUTE: 'nan',
    })

    expect(policy).toEqual({
      capacity: 5,
      refillPerMinute: 5,
    })
  })
})

describe('withRateLimit', () => {
  it('returns 429 and a Retry-After header when the repository rejects the request', async () => {
    const repository: RateLimitRepository = {
      consumeToken: vi.fn(async (): Promise<RateLimitConsumeResult> => ({
        allowed: false,
        remainingTokens: 0,
        retryAfterSeconds: 7,
      })),
    }
    const handler = withRateLimit(
      async () => createSuccessResponse({ ok: true }),
      {
        endpointClass: 'posts',
        repositoryFactory: () => repository,
      },
    )

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(429)
    expect(response.headers).toMatchObject({
      'retry-after': '7',
    })
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'rate_limit.exceeded',
          message: 'Too many posts write requests. Retry later.',
        },
      ],
    })
  })

  it('integrates with authenticated handlers and preserves the auth context', async () => {
    const userRepository: UserRepository = {
      create: async (user) => user,
      getById: vi.fn(async () => createStoredUser()),
      upsert: async (user) => user,
    }
    const rateLimitRepository: RateLimitRepository = {
      consumeToken: vi.fn(async (): Promise<RateLimitConsumeResult> => ({
        allowed: true,
        remainingTokens: 5,
        retryAfterSeconds: 0,
      })),
    }
    const innerHandler = vi.fn(
      async (_request: HttpRequest, context: InvocationContext) =>
        createSuccessResponse({
          userId: context.auth?.user?.id ?? null,
          roles: context.auth?.roles ?? [],
        }),
    )
    const handler = withHttpAuth(
      withRateLimit(innerHandler, {
        endpointClass: 'posts',
        repositoryFactory: () => rateLimitRepository,
      }),
      {
        repositoryFactory: () => userRepository,
      },
    )

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        userId: 'github:abc123',
        roles: ['user'],
      },
      errors: [],
    })
    expect(rateLimitRepository.consumeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointClass: 'posts',
        userId: 'github:abc123',
      }),
    )
    expect(innerHandler).toHaveBeenCalledOnce()
  })
})
