import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetAdminMetricsHandler } from '../src/functions/get-admin-metrics.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import {
  lookupAdminMetrics,
  type AdminMetricsActiveUserBucketRecord,
  type AdminMetricsCountBucketRecord,
  type AdminMetricsReadStore,
  type AdminMetricsReportRecord,
} from '../src/lib/admin-metrics.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

function createPrincipalRequest(
  principal?: Record<string, unknown>,
  searchParams = new URLSearchParams(),
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
    query: searchParams,
  } as unknown as HttpRequest
}

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'admin-1',
    userDetails: 'platform-admin',
    userRoles: ['authenticated', 'user', 'admin'],
    claims: [],
    ...overrides,
  }
}

function createStoredUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'github:admin-1',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'admin-1',
    email: 'admin@example.com',
    emailLower: 'admin@example.com',
    handle: 'platform-admin',
    handleLower: 'platform-admin',
    displayName: 'Platform Admin',
    expertise: ['ops'],
    links: {},
    status: 'active',
    roles: ['admin', 'user'],
    counters: {
      posts: 0,
      followers: 0,
      following: 0,
    },
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  }
}

function createRepository(user: UserDocument | null): UserRepository {
  return {
    create: async (createdUser) => createdUser,
    getById: vi.fn(async () => user),
    upsert: async (updatedUser) => updatedUser,
  }
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createCountBucket(
  bucketKey: string,
  count: number,
): AdminMetricsCountBucketRecord {
  return {
    bucketKey,
    count,
  }
}

function createActiveUserBucket(
  bucketKey: string,
  userId: string,
): AdminMetricsActiveUserBucketRecord {
  return {
    bucketKey,
    userId,
  }
}

function createReportRecord(
  overrides: Partial<AdminMetricsReportRecord> = {},
): AdminMetricsReportRecord {
  return {
    createdAt: '2026-04-15T06:20:00.000Z',
    triagedAt: null,
    status: 'open',
    reporterId: 'github:reporter-1',
    ...overrides,
  }
}

describe('lookupAdminMetrics', () => {
  it('aggregates summaries and series for the selected range', async () => {
    const store = {
      countRegistrations: vi.fn(async (start: Date) =>
        start.toISOString() === '2026-04-09T00:00:00.000Z' ? 1 : 1,
      ),
      countPosts: vi.fn(async (start: Date) =>
        start.toISOString() === '2026-04-09T00:00:00.000Z' ? 1 : 1,
      ),
      listActiveUsers: vi.fn(async (start: Date) =>
        start.toISOString() === '2026-04-09T00:00:00.000Z'
          ? ['github:user-1', 'github:user-4', 'github:user-6']
          : ['github:user-2', 'github:user-3', 'github:user-5'],
      ),
      listRegistrationBuckets: vi.fn(async () => [
        createCountBucket('2026-04-15', 1),
      ]),
      listPostBuckets: vi.fn(async () => [createCountBucket('2026-04-15', 1)]),
      listActiveUserBuckets: vi.fn(async () => [
        createActiveUserBucket('2026-04-15', 'github:user-1'),
        createActiveUserBucket('2026-04-15', 'github:user-4'),
        createActiveUserBucket('2026-04-15', 'github:user-6'),
      ]),
      listReportTimeline: vi.fn(async () => [
        createReportRecord(),
        createReportRecord({
          createdAt: '2026-04-14T03:00:00.000Z',
          triagedAt: '2026-04-15T02:30:00.000Z',
          status: 'triaged',
          reporterId: 'github:reporter-2',
        }),
        createReportRecord({
          createdAt: '2026-04-07T02:00:00.000Z',
          triagedAt: '2026-04-08T22:00:00.000Z',
          status: 'resolved',
          reporterId: 'github:reporter-3',
        }),
      ]),
    } satisfies AdminMetricsReadStore

    const result = await lookupAdminMetrics(
      '7d',
      store,
      () => new Date('2026-04-15T12:00:00.000Z'),
    )

    expect(result.status).toBe(200)
    expect(result.body.data?.filters).toEqual({
      range: '7d',
      bucket: 'day',
      startAt: '2026-04-09T00:00:00.000Z',
      endAt: '2026-04-16T00:00:00.000Z',
      generatedAt: '2026-04-15T12:00:00.000Z',
    })
    expect(result.body.data?.summary).toMatchObject({
      registrations: {
        value: 1,
        previousValue: 1,
        changePercent: 0,
      },
      activeUsers: {
        value: 3,
        previousValue: 3,
        changePercent: 0,
      },
      posts: {
        value: 1,
        previousValue: 1,
        changePercent: 0,
      },
      reports: {
        value: 2,
        previousValue: 1,
        changePercent: 100,
      },
      queueDepth: {
        value: 1,
        previousValue: 0,
        changePercent: null,
      },
    })
    expect(result.body.data?.series.at(-1)).toEqual({
      bucketStart: '2026-04-15T00:00:00.000Z',
      bucketEnd: '2026-04-16T00:00:00.000Z',
      registrations: 1,
      activeUsers: 3,
      posts: 1,
      reports: 1,
      queueDepth: 1,
    })
  })
})

describe('getAdminMetricsHandler', () => {
  it('returns metrics for an authenticated admin', async () => {
    const handler = buildGetAdminMetricsHandler({
      now: () => new Date('2026-04-15T12:00:00.000Z'),
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () =>
        ({
          countRegistrations: async () => 1,
          countPosts: async () => 1,
          listActiveUsers: async () => ['github:user-1'],
          listRegistrationBuckets: async () => [
            createCountBucket('2026-04-15', 1),
          ],
          listPostBuckets: async () => [createCountBucket('2026-04-15', 1)],
          listActiveUserBuckets: async () => [
            createActiveUserBucket('2026-04-15', 'github:user-1'),
          ],
          listReportTimeline: async () => [createReportRecord()],
        }) satisfies AdminMetricsReadStore,
    })

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        filters: {
          range: '7d',
        },
        summary: {
          registrations: {
            value: 1,
          },
          posts: {
            value: 1,
          },
          reports: {
            value: 1,
          },
        },
      },
      errors: [],
    })
  })

  it('rejects invalid ranges', async () => {
    const handler = buildGetAdminMetricsHandler({
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () =>
        ({
          countRegistrations: async () => 0,
          countPosts: async () => 0,
          listActiveUsers: async () => [],
          listRegistrationBuckets: async () => [],
          listPostBuckets: async () => [],
          listActiveUserBuckets: async () => [],
          listReportTimeline: async () => [],
        }) satisfies AdminMetricsReadStore,
    })

    const response = await handler(
      createPrincipalRequest(
        createAuthenticatedPrincipal(),
        new URLSearchParams('range=90d'),
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_range',
          message:
            "The range query parameter must be one of '24h', '7d', or '30d'.",
          field: 'range',
        },
      ],
    })
  })

  it('returns 500 when the store cannot be configured', async () => {
    const handler = buildGetAdminMetricsHandler({
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

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

  it('rejects authenticated users without the admin role', async () => {
    const handler = buildGetAdminMetricsHandler({
      repositoryFactory: () =>
        createRepository(
          createStoredUser({
            roles: ['user'],
          }),
        ),
      storeFactory: () =>
        ({
          countRegistrations: async () => 0,
          countPosts: async () => 0,
          listActiveUsers: async () => [],
          listRegistrationBuckets: async () => [],
          listPostBuckets: async () => [],
          listActiveUserBuckets: async () => [],
          listReportTimeline: async () => [],
        }) satisfies AdminMetricsReadStore,
    })

    const response = await handler(
      createPrincipalRequest(
        createAuthenticatedPrincipal({
          userRoles: ['authenticated', 'user'],
        }),
      ),
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
})
