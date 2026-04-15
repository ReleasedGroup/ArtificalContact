import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreateModActionHandler } from '../src/functions/create-mod-action.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import type {
  ModActionDocument,
  ModActionRepository,
} from '../src/lib/mod-actions.js'
import type { MutablePostStore, StoredPostDocument } from '../src/lib/posts.js'
import type { ReportDocument, ReportRepository } from '../src/lib/reports.js'
import type { MutableUserRepository, UserDocument } from '../src/lib/users.js'

class InMemoryMutablePostStore implements MutablePostStore {
  readonly upsertedPosts: StoredPostDocument[] = []

  constructor(private readonly posts = new Map<string, StoredPostDocument>()) {}

  async getPostById(postId: string): Promise<StoredPostDocument | null> {
    return this.posts.get(postId) ?? null
  }

  async upsertPost(post: StoredPostDocument): Promise<StoredPostDocument> {
    this.upsertedPosts.push(post)
    this.posts.set(post.id, post)
    return post
  }
}

class InMemoryReportRepository implements ReportRepository {
  readonly createdReports: ReportDocument[] = []
  readonly upsertedReports: ReportDocument[] = []

  constructor(private readonly reports = new Map<string, ReportDocument>()) {}

  async create(report: ReportDocument): Promise<ReportDocument> {
    this.createdReports.push(report)
    this.reports.set(report.id, report)
    return report
  }

  async getById(reportId: string): Promise<ReportDocument | null> {
    return this.reports.get(reportId) ?? null
  }

  async upsert(report: ReportDocument): Promise<ReportDocument> {
    this.upsertedReports.push(report)
    this.reports.set(report.id, report)
    return report
  }
}

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'post-123',
    type: 'post',
    kind: 'user',
    threadId: 'post-123',
    parentId: null,
    authorId: 'github:author-1',
    authorHandle: 'author',
    authorDisplayName: 'Author',
    text: 'LLM evals need better dashboards.',
    hashtags: ['evals'],
    mentions: [],
    counters: {
      likes: 3,
      dislikes: 0,
      emoji: 1,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:30:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createStoredReport(
  overrides: Partial<ReportDocument> = {},
): ReportDocument {
  return {
    id: 'report-123',
    type: 'report',
    status: 'open',
    reporterId: 'github:reporter-1',
    reporterHandle: 'reporter',
    reporterDisplayName: 'Reporter',
    targetType: 'post',
    targetId: 'post-123',
    targetPostId: 'post-123',
    targetAuthorId: 'github:author-1',
    targetAuthorHandle: 'author',
    targetProfileHandle: 'author',
    reasonCode: 'spam',
    details: 'Repeated promotions.',
    mediaUrl: null,
    createdAt: '2026-04-15T09:15:00.000Z',
    updatedAt: '2026-04-15T09:15:00.000Z',
    ...overrides,
  }
}

function createStoredUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'github:moderator-1',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'moderator-1',
    email: 'mod@example.com',
    emailLower: 'mod@example.com',
    handle: 'mod',
    handleLower: 'mod',
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

function createUserRepository(
  users: Map<string, UserDocument>,
): MutableUserRepository {
  return {
    create: async (user) => {
      users.set(user.id, user)
      return user
    },
    getById: vi.fn(async (userId: string) => users.get(userId) ?? null),
    upsert: vi.fn(async (user) => {
      users.set(user.id, user)
      return user
    }),
  }
}

function createModActionRepository(): ModActionRepository & {
  createdActions: ModActionDocument[]
} {
  const createdActions: ModActionDocument[] = []

  return {
    createdActions,
    create: vi.fn(async (action) => {
      createdActions.push(action)
      return action
    }),
  }
}

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'moderator-1',
    userDetails: 'mod',
    userRoles: ['authenticated', 'user', 'moderator'],
    claims: [],
    ...overrides,
  }
}

function createRequest(
  body: unknown,
  principal?: Record<string, unknown>,
  options?: { invalidJson?: boolean },
): HttpRequest {
  const encodedPrincipal = principal
    ? Buffer.from(JSON.stringify(principal)).toString('base64')
    : null

  return {
    json: async () => {
      if (options?.invalidJson) {
        throw new Error('Invalid JSON')
      }

      return body
    },
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

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('createModActionHandler', () => {
  it('hides a post, resolves the linked report, and records an audit action', async () => {
    const postStore = new InMemoryMutablePostStore(
      new Map([['post-123', createStoredPost()]]),
    )
    const reportRepository = new InMemoryReportRepository(
      new Map([['report-123', createStoredReport()]]),
    )
    const modActionRepository = createModActionRepository()
    const users = new Map([
      ['github:moderator-1', createStoredUser()],
    ])
    const handler = buildCreateModActionHandler({
      idFactory: () => 'mod-action-1',
      now: () => new Date('2026-04-15T12:00:00.000Z'),
      postStoreFactory: () => postStore,
      reportRepositoryFactory: () => reportRepository,
      modActionRepositoryFactory: () => modActionRepository,
      userRepositoryFactory: () => createUserRepository(users),
    })
    const context = createContext()

    const response = await handler(
      createRequest(
        {
          action: 'hidePost',
          targetId: 'post-123',
          reportId: 'report-123',
          notes: 'Confirmed spam pattern.',
        },
        createAuthenticatedPrincipal(),
      ),
      context,
    )

    expect(response.status).toBe(201)
    expect(postStore.upsertedPosts).toEqual([
      expect.objectContaining({
        id: 'post-123',
        moderationState: 'hidden',
        updatedAt: '2026-04-15T12:00:00.000Z',
      }),
    ])
    expect(reportRepository.upsertedReports).toEqual([
      expect.objectContaining({
        id: 'report-123',
        status: 'resolved',
        updatedAt: '2026-04-15T12:00:00.000Z',
      }),
    ])
    expect(modActionRepository.createdActions).toEqual([
      {
        id: 'mod-action-1',
        type: 'modAction',
        action: 'hidePost',
        targetType: 'post',
        targetId: 'post-123',
        reportId: 'report-123',
        moderatorId: 'github:moderator-1',
        moderatorHandle: 'mod',
        notes: 'Confirmed spam pattern.',
        createdAt: '2026-04-15T12:00:00.000Z',
      },
    ])
    expect(response.jsonBody).toEqual({
      data: {
        modAction: modActionRepository.createdActions[0],
        target: {
          id: 'post-123',
          type: 'post',
          alreadyApplied: false,
          moderationState: 'hidden',
        },
        report: {
          id: 'report-123',
          status: 'resolved',
          alreadyApplied: false,
        },
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Created moderation action.', {
      action: 'hidePost',
      moderatorId: 'github:moderator-1',
      modActionId: 'mod-action-1',
      reportId: 'report-123',
      targetId: 'post-123',
      targetType: 'post',
    })
  })

  it('removes reply content and records the actual reply target type', async () => {
    const postStore = new InMemoryMutablePostStore(
      new Map([
        [
          'reply-123',
          createStoredPost({
            id: 'reply-123',
            type: 'reply',
            parentId: 'post-123',
            threadId: 'post-123',
          }),
        ],
      ]),
    )
    const modActionRepository = createModActionRepository()
    const users = new Map([
      ['github:moderator-1', createStoredUser()],
    ])
    const handler = buildCreateModActionHandler({
      idFactory: () => 'mod-action-2',
      now: () => new Date('2026-04-15T12:05:00.000Z'),
      postStoreFactory: () => postStore,
      modActionRepositoryFactory: () => modActionRepository,
      userRepositoryFactory: () => createUserRepository(users),
    })

    const response = await handler(
      createRequest(
        {
          action: 'removePost',
          targetId: 'reply-123',
        },
        createAuthenticatedPrincipal(),
      ),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(postStore.upsertedPosts).toEqual([
      expect.objectContaining({
        id: 'reply-123',
        moderationState: 'removed',
        updatedAt: '2026-04-15T12:05:00.000Z',
      }),
    ])
    expect(modActionRepository.createdActions[0]).toEqual({
      id: 'mod-action-2',
      type: 'modAction',
      action: 'removePost',
      targetType: 'reply',
      targetId: 'reply-123',
      reportId: null,
      moderatorId: 'github:moderator-1',
      moderatorHandle: 'mod',
      notes: null,
      createdAt: '2026-04-15T12:05:00.000Z',
    })
    expect(response.jsonBody).toEqual({
      data: {
        modAction: modActionRepository.createdActions[0],
        target: {
          id: 'reply-123',
          type: 'reply',
          alreadyApplied: false,
          moderationState: 'removed',
        },
        report: null,
      },
      errors: [],
    })
  })

  it('suspends an account and resolves the matching user report', async () => {
    const reportRepository = new InMemoryReportRepository(
      new Map([
        [
          'report-user-1',
          createStoredReport({
            id: 'report-user-1',
            targetType: 'user',
            targetId: 'github:user-2',
            targetPostId: null,
            targetAuthorId: 'github:user-2',
            targetAuthorHandle: 'target',
            targetProfileHandle: 'target',
            reasonCode: 'impersonation',
          }),
        ],
      ]),
    )
    const modActionRepository = createModActionRepository()
    const users = new Map([
      ['github:moderator-1', createStoredUser()],
      [
        'github:user-2',
        createStoredUser({
          id: 'github:user-2',
          identityProviderUserId: 'user-2',
          handle: 'target',
          handleLower: 'target',
          roles: ['user'],
          status: 'active',
        }),
      ],
    ])
    const userRepository = createUserRepository(users)
    const handler = buildCreateModActionHandler({
      idFactory: () => 'mod-action-3',
      now: () => new Date('2026-04-15T12:10:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      modActionRepositoryFactory: () => modActionRepository,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest(
        {
          action: 'suspendAccount',
          targetId: 'github:user-2',
          reportId: 'report-user-1',
          notes: 'Verified account abuse.',
        },
        createAuthenticatedPrincipal(),
      ),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(userRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github:user-2',
        status: 'suspended',
        updatedAt: '2026-04-15T12:10:00.000Z',
      }),
    )
    expect(reportRepository.upsertedReports).toEqual([
      expect.objectContaining({
        id: 'report-user-1',
        status: 'resolved',
        updatedAt: '2026-04-15T12:10:00.000Z',
      }),
    ])
    expect(response.jsonBody).toEqual({
      data: {
        modAction: modActionRepository.createdActions[0],
        target: {
          id: 'github:user-2',
          type: 'user',
          alreadyApplied: false,
          userStatus: 'suspended',
        },
        report: {
          id: 'report-user-1',
          status: 'resolved',
          alreadyApplied: false,
        },
      },
      errors: [],
    })
  })

  it('dismisses a report directly without requiring reportId', async () => {
    const reportRepository = new InMemoryReportRepository(
      new Map([
        [
          'report-456',
          createStoredReport({
            id: 'report-456',
            status: 'triaged',
          }),
        ],
      ]),
    )
    const modActionRepository = createModActionRepository()
    const users = new Map([
      ['github:moderator-1', createStoredUser()],
    ])
    const handler = buildCreateModActionHandler({
      idFactory: () => 'mod-action-4',
      now: () => new Date('2026-04-15T12:15:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      modActionRepositoryFactory: () => modActionRepository,
      userRepositoryFactory: () => createUserRepository(users),
    })

    const response = await handler(
      createRequest(
        {
          action: 'dismissReport',
          targetId: 'report-456',
        },
        createAuthenticatedPrincipal(),
      ),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(reportRepository.upsertedReports).toEqual([
      expect.objectContaining({
        id: 'report-456',
        status: 'resolved',
        updatedAt: '2026-04-15T12:15:00.000Z',
      }),
    ])
    expect(response.jsonBody).toEqual({
      data: {
        modAction: modActionRepository.createdActions[0],
        target: {
          id: 'report-456',
          type: 'report',
          alreadyApplied: false,
          reportStatus: 'resolved',
        },
        report: {
          id: 'report-456',
          status: 'resolved',
          alreadyApplied: false,
        },
      },
      errors: [],
    })
  })

  it('rejects linked reports that do not match the moderation target', async () => {
    const postStore = new InMemoryMutablePostStore(
      new Map([['post-123', createStoredPost()]]),
    )
    const reportRepository = new InMemoryReportRepository(
      new Map([
        [
          'report-mismatch',
          createStoredReport({
            id: 'report-mismatch',
            targetType: 'user',
            targetId: 'github:user-2',
          }),
        ],
      ]),
    )
    const modActionRepository = createModActionRepository()
    const users = new Map([
      ['github:moderator-1', createStoredUser()],
    ])
    const handler = buildCreateModActionHandler({
      idFactory: () => 'mod-action-5',
      now: () => new Date('2026-04-15T12:20:00.000Z'),
      postStoreFactory: () => postStore,
      reportRepositoryFactory: () => reportRepository,
      modActionRepositoryFactory: () => modActionRepository,
      userRepositoryFactory: () => createUserRepository(users),
    })

    const response = await handler(
      createRequest(
        {
          action: 'hidePost',
          targetId: 'post-123',
          reportId: 'report-mismatch',
        },
        createAuthenticatedPrincipal(),
      ),
      createContext(),
    )

    expect(response.status).toBe(409)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'mod_action_conflict',
          message:
            'The linked report does not match the requested moderation target.',
          field: 'reportId',
        },
      ],
    })
    expect(modActionRepository.createdActions).toHaveLength(0)
  })

  it('requires the moderator role before creating an action', async () => {
    const users = new Map([
      [
        'github:moderator-1',
        createStoredUser({
          roles: ['user'],
        }),
      ],
    ])
    const handler = buildCreateModActionHandler({
      userRepositoryFactory: () => createUserRepository(users),
    })

    const response = await handler(
      createRequest(
        {
          action: 'dismissReport',
          targetId: 'report-123',
        },
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
