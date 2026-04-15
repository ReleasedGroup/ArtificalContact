import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreateReportHandler } from '../src/functions/create-report.js'
import type { ReportDocument, ReportRepository } from '../src/lib/reports.js'
import type { UserDocument } from '../src/lib/users.js'

function createRequest(body: unknown, options?: { invalidJson?: boolean }) {
  return {
    json: async () => {
      if (options?.invalidJson) {
        throw new Error('Invalid JSON')
      }

      return body
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
    bio: 'Building with Azure Functions.',
    avatarUrl: 'https://cdn.example.com/nick.png',
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

function createRepository(
  overrides: Partial<ReportRepository> = {},
): ReportRepository {
  return {
    create: vi.fn(async (report) => report),
    getById: vi.fn(async () => null),
    upsert: vi.fn(async (report) => report),
    ...overrides,
  }
}

describe('createReportHandler', () => {
  it('creates a report with status=open for a supported target type', async () => {
    const repository = createRepository()
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-1',
      now: () => new Date('2026-04-15T08:00:00.000Z'),
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-123',
        reason: 'Spam',
        details: 'Repeated unsolicited promotions.',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(repository.create).toHaveBeenCalledWith({
      id: 'report-1',
      type: 'report',
      status: 'open',
      targetType: 'post',
      targetId: 'post-123',
      reporterId: 'github:abc123',
      reporterHandle: 'nick',
      reason: 'Spam',
      details: 'Repeated unsolicited promotions.',
      createdAt: '2026-04-15T08:00:00.000Z',
      updatedAt: '2026-04-15T08:00:00.000Z',
    } satisfies ReportDocument)
    expect(response.jsonBody).toEqual({
      data: {
        report: {
          id: 'report-1',
          type: 'report',
          status: 'open',
          targetType: 'post',
          targetId: 'post-123',
          reporterId: 'github:abc123',
          reporterHandle: 'nick',
          reason: 'Spam',
          details: 'Repeated unsolicited promotions.',
          createdAt: '2026-04-15T08:00:00.000Z',
          updatedAt: '2026-04-15T08:00:00.000Z',
        },
      },
      errors: [],
    })
  })

  it('stores null details when the optional details field is omitted', async () => {
    const repository = createRepository()
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-2',
      now: () => new Date('2026-04-15T08:05:00.000Z'),
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        targetType: 'user',
        targetId: 'github:bad-actor',
        reason: 'Impersonation',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(repository.create).toHaveBeenCalledWith({
      id: 'report-2',
      type: 'report',
      status: 'open',
      targetType: 'user',
      targetId: 'github:bad-actor',
      reporterId: 'github:abc123',
      reporterHandle: 'nick',
      reason: 'Impersonation',
      details: null,
      createdAt: '2026-04-15T08:05:00.000Z',
      updatedAt: '2026-04-15T08:05:00.000Z',
    } satisfies ReportDocument)
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildCreateReportHandler({
      repositoryFactory: () => createRepository(),
    })

    const response = await handler(
      createRequest({}, { invalidJson: true }),
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

  it('returns validation errors when the target type is unsupported', async () => {
    const handler = buildCreateReportHandler({
      repositoryFactory: () => createRepository(),
    })

    const response = await handler(
      createRequest({
        targetType: 'thread',
        targetId: 'thread-1',
        reason: 'Spam',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_report',
          message: 'Invalid option: expected one of "post"|"reply"|"media"|"user"',
          field: 'targetType',
        },
      ],
    })
  })

  it('rejects users who do not have an active profile with a handle', async () => {
    const repository = createRepository()
    const handler = buildCreateReportHandler({
      repositoryFactory: () => repository,
    })
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-123',
        reason: 'Spam',
      }),
      createContext(pendingUser),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before submitting reports.',
        },
      ],
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('returns 500 when the report repository is not configured', async () => {
    const context = createContext()
    const handler = buildCreateReportHandler({
      repositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-123',
        reason: 'Spam',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The report store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the report repository.',
      {
        error: 'missing config',
      },
    )
  })

  it('returns 500 when the report write fails', async () => {
    const context = createContext()
    const handler = buildCreateReportHandler({
      repositoryFactory: () => ({
        create: async () => {
          throw new Error('Cosmos unavailable')
        },
        getById: async () => null,
        upsert: async (report) => report,
      }),
    })

    const response = await handler(
      createRequest({
        targetType: 'media',
        targetId: 'media-123',
        reason: 'Graphic violence',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.report_create_failed',
          message: 'Unable to submit the report.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith('Failed to create the report.', {
      error: 'Cosmos unavailable',
      reporterId: 'github:abc123',
    })
  })
})
