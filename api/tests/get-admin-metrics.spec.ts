import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import {
  loadAdminMetricsSnapshot,
  type AdminMetricsStore,
} from '../src/lib/admin-metrics.js'
import {
  buildGetAdminMetricsHandler,
} from '../src/functions/get-admin-metrics.js'
import { withHttpAuth } from '../src/lib/http-auth.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

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
    roles: ['admin', 'user'],
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

function createContext(user: UserDocument | null = createStoredUser()) {
  return {
    auth: user
      ? {
          isAuthenticated: true,
          principal: null,
          user,
          roles: user.roles,
        }
      : undefined,
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createStore(): AdminMetricsStore {
  return {
    countRegistrations: vi.fn(async () => 42),
    countRegistrationsSince: vi.fn(async (since: string) =>
      since.includes('2026-04-15T12:')
        ? 2
        : since.includes('2026-04-09T12:')
          ? 9
          : 17,
    ),
    listUserIdsWithPostsSince: vi.fn(async () => ['user-1', ' user-2 ']),
    listUserIdsWithReactionsSince: vi.fn(async () => ['user-2', 'user-3']),
    listUserIdsWithFollowsSince: vi.fn(async () => ['user-4']),
    listUserIdsWithReportsSince: vi.fn(async () => ['user-1', '']),
    countRootPostsSince: vi.fn(async (since: string) =>
      since.includes('2026-04-15T12:')
        ? 3
        : since.includes('2026-04-09T12:')
          ? 11
          : 24,
    ),
    countRepliesSince: vi.fn(async (since: string) =>
      since.includes('2026-04-15T12:')
        ? 4
        : since.includes('2026-04-09T12:')
          ? 12
          : 28,
    ),
    countReports: vi.fn(async () => 16),
    countReportsSince: vi.fn(async (since: string) =>
      since.includes('2026-04-15T12:')
        ? 1
        : since.includes('2026-04-09T12:')
          ? 5
          : 8,
    ),
    countReportsByStatus: vi.fn(async (status) =>
      status === 'open' ? 6 : status === 'triaged' ? 4 : 6,
    ),
    countReportsUpdatedSince: vi.fn(async (since: string, status) => {
      if (status === 'triaged') {
        return since.includes('2026-04-15T12:')
          ? 1
          : since.includes('2026-04-09T12:')
            ? 3
            : 4
      }

      return since.includes('2026-04-15T12:')
        ? 2
        : since.includes('2026-04-09T12:')
          ? 5
          : 7
    }),
    countNotificationsSince: vi.fn(async (since: string) =>
      since.includes('2026-04-15T12:')
        ? 14
        : since.includes('2026-04-09T12:')
          ? 70
          : 123,
    ),
  }
}

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
    query: new URLSearchParams(),
  } as unknown as HttpRequest
}

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'abc123',
    userDetails: 'nickbeau',
    userRoles: ['authenticated', 'user', 'admin'],
    claims: [],
    ...overrides,
  }
}

describe('loadAdminMetricsSnapshot', () => {
  it('builds the admin metrics payload from the store counts and activity sets', async () => {
    const result = await loadAdminMetricsSnapshot(
      createStore(),
      new Date('2026-04-16T12:00:00.000Z'),
    )

    expect(result).toEqual({
      generatedAt: '2026-04-16T12:00:00.000Z',
      windowStarts: {
        last24Hours: '2026-04-15T12:00:00.000Z',
        last7Days: '2026-04-09T12:00:00.000Z',
        last30Days: '2026-03-17T12:00:00.000Z',
      },
      registrations: {
        total: 42,
        last24Hours: 2,
        last7Days: 9,
        last30Days: 17,
      },
      dailyActiveUsers: 4,
      posts: {
        last24Hours: {
          total: 7,
          rootPosts: 3,
          replies: 4,
        },
        last7Days: {
          total: 23,
          rootPosts: 11,
          replies: 12,
        },
        last30Days: {
          total: 52,
          rootPosts: 24,
          replies: 28,
        },
      },
      reports: {
        total: 16,
        created: {
          last24Hours: 1,
          last7Days: 5,
          last30Days: 8,
        },
        byStatus: {
          open: 6,
          triaged: 4,
          resolved: 6,
        },
      },
      queueDepth: {
        openReports: 6,
      },
      moderation: {
        last24Hours: {
          triaged: 1,
          resolved: 2,
          reviewed: 3,
        },
        last7Days: {
          triaged: 3,
          resolved: 5,
          reviewed: 8,
        },
        last30Days: {
          triaged: 4,
          resolved: 7,
          reviewed: 11,
        },
      },
      notifications: {
        last24Hours: 14,
        last7Days: 70,
        last30Days: 123,
      },
    })
  })
})

describe('buildGetAdminMetricsHandler', () => {
  it('returns the admin metrics in the standard JSON envelope', async () => {
    const handler = buildGetAdminMetricsHandler({
      now: () => new Date('2026-04-16T12:00:00.000Z'),
      storeFactory: createStore,
    })

    const response = await handler({} as HttpRequest, createContext())

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toMatchObject({
      data: {
        registrations: {
          total: 42,
        },
        dailyActiveUsers: 4,
        queueDepth: {
          openReports: 6,
        },
      },
      errors: [],
    })
  })

  it('returns 403 when invoked without an authenticated admin user context', async () => {
    const handler = buildGetAdminMetricsHandler({
      storeFactory: createStore,
    })

    const response = await handler({} as HttpRequest, createContext(null))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have a provisioned admin profile before reading admin metrics.',
        },
      ],
    })
  })

  it('returns 500 when the store cannot be configured', async () => {
    const handler = buildGetAdminMetricsHandler({
      storeFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler({} as HttpRequest, createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The admin metrics store is not configured.',
        },
      ],
    })
  })
})

describe('getAdminMetricsHandler', () => {
  it('rejects non-admin users before the handler body runs', async () => {
    const repository: UserRepository = {
      create: async (user) => user,
      getById: vi.fn(async () =>
        createStoredUser({
          roles: ['user'],
        }),
      ),
      upsert: async (user) => user,
    }
    const handler = buildGetAdminMetricsHandler({
      storeFactory: createStore,
    })

    const protectedHandler = withHttpAuth(handler, {
      requiredRoles: ['admin'],
      repositoryFactory: () => repository,
    })
    const response = await protectedHandler(
      createPrincipalRequest(
        createAuthenticatedPrincipal({
          userRoles: ['authenticated', 'user'],
        }),
      ),
      {
        log: vi.fn(),
      } as unknown as InvocationContext,
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

  it('allows admin users through the exported auth wrapper', async () => {
    const repository: UserRepository = {
      create: async (user) => user,
      getById: vi.fn(async () => createStoredUser()),
      upsert: async (user) => user,
    }
    const handler = buildGetAdminMetricsHandler({
      now: () => new Date('2026-04-16T12:00:00.000Z'),
      storeFactory: createStore,
    })

    const response = await withHttpAuth(handler, {
      requiredRoles: ['admin'],
      repositoryFactory: () => repository,
    })(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      {
        log: vi.fn(),
      } as unknown as InvocationContext,
    )

    expect(response.status).toBe(200)
  })
})
