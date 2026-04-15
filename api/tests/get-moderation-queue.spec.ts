import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetModerationQueueHandler } from '../src/functions/get-moderation-queue.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import {
  lookupModerationQueue,
  type ModerationQueueReadStore,
  type StoredReportDocument,
} from '../src/lib/moderation-queue.js'
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
    query: new URLSearchParams(),
  } as unknown as HttpRequest
}

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'abc123',
    userDetails: 'moddy',
    userRoles: ['authenticated', 'user', 'moderator'],
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
    email: 'mod@example.com',
    emailLower: 'mod@example.com',
    handle: 'moddy',
    handleLower: 'moddy',
    displayName: 'Moderator',
    expertise: ['safety'],
    links: {},
    status: 'active',
    roles: ['moderator', 'user'],
    counters: {
      posts: 0,
      followers: 0,
      following: 0,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createStoredReport(
  overrides: Partial<StoredReportDocument> = {},
): StoredReportDocument {
  return {
    id: 'report-1',
    type: 'report',
    status: 'open',
    reason: 'Spam',
    details: 'Repeated scam links',
    severity: 'med',
    reporterUserId: 'github:reporter-1',
    reporterHandle: ' reporter ',
    reporterDisplayName: ' Reporter ',
    targetType: 'post',
    targetId: 'post-1',
    targetHandle: 'ada',
    targetExcerpt: ' suspicious body ',
    targetUrl: 'https://example.com/posts/post-1',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:05:00.000Z',
    triagedAt: null,
    triagedByUserId: null,
    ...overrides,
  }
}

function createRepository(user: UserDocument): UserRepository {
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

describe('lookupModerationQueue', () => {
  it('returns normalized open and triaged moderation queue entries with counts', async () => {
    const store = {
      listReportsByStatus: vi.fn(async (status) => {
        if (status === 'open') {
          return [
            createStoredReport(),
            createStoredReport({
              id: '   ',
            }),
          ]
        }

        return [
          createStoredReport({
            id: 'report-2',
            status: 'triaged',
            reason: '',
            category: 'Harassment',
            details: '',
            description: 'Escalated',
            severity: 'high',
            reporterUserId: '',
            reporterHandle: '',
            reporterDisplayName: '',
            targetType: '',
            targetId: '',
            targetHandle: '',
            targetExcerpt: '',
            targetUrl: '',
            reporter: {
              userId: 'github:reporter-2',
              handle: 'triager',
              displayName: 'Triager',
            },
            target: {
              type: 'account',
              id: 'user-7',
              handle: 'bot7',
              excerpt: '',
              url: 'https://example.com/users/bot7',
            },
            createdAt: '2026-04-15T12:00:00.000Z',
            updatedAt: '2026-04-15T13:00:00.000Z',
            triagedAt: '2026-04-15T12:30:00.000Z',
            triagedByUserId: 'github:mod-1',
          }),
        ]
      }),
      countReportsByStatus: vi.fn(async (status) => (status === 'open' ? 4 : 2)),
    } satisfies ModerationQueueReadStore

    const result = await lookupModerationQueue(store)

    expect(store.listReportsByStatus).toHaveBeenNthCalledWith(1, 'open', 50)
    expect(store.listReportsByStatus).toHaveBeenNthCalledWith(2, 'triaged', 50)
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          openReports: [
            {
              id: 'report-1',
              status: 'open',
              reason: 'Spam',
              details: 'Repeated scam links',
              severity: 'medium',
              reporter: {
                userId: 'github:reporter-1',
                handle: 'reporter',
                displayName: 'Reporter',
              },
              target: {
                type: 'post',
                id: 'post-1',
                handle: 'ada',
                excerpt: 'suspicious body',
                url: 'https://example.com/posts/post-1',
              },
              createdAt: '2026-04-16T00:00:00.000Z',
              updatedAt: '2026-04-16T00:05:00.000Z',
              triagedAt: null,
              triagedByUserId: null,
            },
          ],
          triagedReports: [
            {
              id: 'report-2',
              status: 'triaged',
              reason: 'Harassment',
              details: 'Escalated',
              severity: 'high',
              reporter: {
                userId: 'github:reporter-2',
                handle: 'triager',
                displayName: 'Triager',
              },
              target: {
                type: 'user',
                id: 'user-7',
                handle: 'bot7',
                excerpt: null,
                url: 'https://example.com/users/bot7',
              },
              createdAt: '2026-04-15T12:00:00.000Z',
              updatedAt: '2026-04-15T13:00:00.000Z',
              triagedAt: '2026-04-15T12:30:00.000Z',
              triagedByUserId: 'github:mod-1',
            },
          ],
          counts: {
            open: 4,
            triaged: 2,
          },
        },
        errors: [],
      },
    })
  })
})

describe('getModerationQueueHandler', () => {
  it('returns the moderation queue for an authenticated moderator', async () => {
    const store = {
      listReportsByStatus: vi.fn(async (status) =>
        status === 'open'
          ? [createStoredReport()]
          : [
              createStoredReport({
                id: 'report-2',
                status: 'triaged',
                targetType: 'user',
                targetId: 'user-2',
              }),
            ],
      ),
      countReportsByStatus: vi.fn(async (status) => (status === 'open' ? 1 : 1)),
    } satisfies ModerationQueueReadStore
    const handler = buildGetModerationQueueHandler({
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => store,
    })

    const response = await handler(
      createPrincipalRequest(createAuthenticatedPrincipal()),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        openReports: [
          {
            id: 'report-1',
            status: 'open',
            reason: 'Spam',
            details: 'Repeated scam links',
            severity: 'medium',
            reporter: {
              userId: 'github:reporter-1',
              handle: 'reporter',
              displayName: 'Reporter',
            },
            target: {
              type: 'post',
              id: 'post-1',
              handle: 'ada',
              excerpt: 'suspicious body',
              url: 'https://example.com/posts/post-1',
            },
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:05:00.000Z',
            triagedAt: null,
            triagedByUserId: null,
          },
        ],
        triagedReports: [
          {
            id: 'report-2',
            status: 'triaged',
            reason: 'Spam',
            details: 'Repeated scam links',
            severity: 'medium',
            reporter: {
              userId: 'github:reporter-1',
              handle: 'reporter',
              displayName: 'Reporter',
            },
            target: {
              type: 'user',
              id: 'user-2',
              handle: 'ada',
              excerpt: 'suspicious body',
              url: 'https://example.com/posts/post-1',
            },
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:05:00.000Z',
            triagedAt: null,
            triagedByUserId: null,
          },
        ],
        counts: {
          open: 1,
          triaged: 1,
        },
      },
      errors: [],
    })
  })

  it('rejects authenticated users without the moderator role', async () => {
    const handler = buildGetModerationQueueHandler({
      repositoryFactory: () =>
        createRepository(
          createStoredUser({
            roles: ['user'],
          }),
        ),
      storeFactory: () => ({
        listReportsByStatus: vi.fn(async () => []),
        countReportsByStatus: vi.fn(async () => 0),
      }),
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

  it('returns a configuration error when the moderation queue store cannot be created', async () => {
    const handler = buildGetModerationQueueHandler({
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => {
        throw new Error('Missing reports configuration')
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
          message: 'The moderation queue store is not configured.',
        },
      ],
    })
  })

  it('returns a server error when the moderation queue lookup fails', async () => {
    const handler = buildGetModerationQueueHandler({
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => ({
        listReportsByStatus: async () => {
          throw new Error('Cosmos unavailable')
        },
        countReportsByStatus: async () => 0,
      }),
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
          code: 'server.moderation_queue_lookup_failed',
          message: 'Unable to load the moderation queue.',
        },
      ],
    })
  })
})
