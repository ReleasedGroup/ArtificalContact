import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreateReportHandler } from '../src/functions/create-report.js'
import type { PostStore, StoredPostDocument } from '../src/lib/posts.js'
import type {
  MutableReportRepository,
  ReportDocument,
} from '../src/lib/reports.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

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

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'post-1',
    type: 'post',
    kind: 'user',
    threadId: 'post-1',
    parentId: null,
    authorId: 'github:target',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: null,
    text: 'Root thread post',
    hashtags: ['evals'],
    mentions: [],
    media: [],
    counters: {
      likes: 12,
      dislikes: 0,
      emoji: 3,
      replies: 2,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    deletedAt: null,
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

function createReportRepository(
  overrides: Partial<MutableReportRepository> = {},
): MutableReportRepository {
  return {
    create: vi.fn(async (report) => report),
    getById: vi.fn(async () => null),
    upsert: vi.fn(async (report) => report),
    ...overrides,
  }
}

function createPostStore(
  getPostById: PostStore['getPostById'] = async () => createStoredPost(),
): PostStore {
  return {
    getPostById: vi.fn(getPostById),
  }
}

function createUserRepository(
  getById: UserRepository['getById'] = async () => null,
): UserRepository {
  return {
    create: vi.fn(),
    getById: vi.fn(getById),
    upsert: vi.fn(),
  }
}

describe('createReportHandler', () => {
  it('creates a report for a post target', async () => {
    const reportRepository = createReportRepository()
    const postStore = createPostStore(async () => createStoredPost())
    const userRepository = createUserRepository(async () =>
      createStoredUser({ id: 'github:target', handle: 'ada' }),
    )
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-1',
      now: () => new Date('2026-04-16T04:00:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => postStore,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-1',
        reasonCode: 'spam',
        details: 'Repeated promo links in multiple threads.',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(reportRepository.create).toHaveBeenCalledWith({
      id: 'report-1',
      type: 'report',
      status: 'open',
      reporterId: 'github:abc123',
      reporterHandle: 'nick',
      reporterDisplayName: 'Nick Beaugeard',
      targetType: 'post',
      targetId: 'post-1',
      targetPostId: 'post-1',
      targetAuthorId: 'github:target',
      targetAuthorHandle: 'ada',
      targetProfileHandle: 'ada',
      reasonCode: 'spam',
      details: 'Repeated promo links in multiple threads.',
      mediaUrl: null,
      createdAt: '2026-04-16T04:00:00.000Z',
      updatedAt: '2026-04-16T04:00:00.000Z',
    } satisfies ReportDocument)
    expect(response.jsonBody).toEqual({
      data: {
        report: {
          id: 'report-1',
          status: 'open',
          targetType: 'post',
          targetId: 'post-1',
          reasonCode: 'spam',
          createdAt: '2026-04-16T04:00:00.000Z',
        },
      },
      errors: [],
    })
  })

  it('creates a report for a reply target', async () => {
    const reportRepository = createReportRepository()
    const postStore = createPostStore(async () =>
      createStoredPost({
        id: 'reply-1',
        type: 'reply',
        threadId: 'post-1',
        parentId: 'post-1',
      }),
    )
    const userRepository = createUserRepository()
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-reply',
      now: () => new Date('2026-04-16T05:00:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => postStore,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest({
        targetType: 'reply',
        targetId: 'reply-1',
        reasonCode: 'harassment',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(reportRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'report-reply',
        targetType: 'reply',
        targetId: 'reply-1',
        targetPostId: 'reply-1',
        reasonCode: 'harassment',
      }),
    )
  })

  it('creates a report for a media target using the parent post context', async () => {
    const reportRepository = createReportRepository()
    const postStore = createPostStore(async () =>
      createStoredPost({
        id: 'post-media',
        media: [
          {
            id: null,
            kind: 'image',
            url: 'https://cdn.example.com/media/reportable.png',
            thumbUrl: 'https://cdn.example.com/media/reportable-thumb.png',
          },
        ],
      }),
    )
    const userRepository = createUserRepository()
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-media',
      now: () => new Date('2026-04-16T06:00:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => postStore,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest({
        targetType: 'media',
        targetId: 'https://cdn.example.com/media/reportable.png',
        targetPostId: 'post-media',
        mediaUrl: 'https://cdn.example.com/media/reportable.png',
        reasonCode: 'nsfw',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(postStore.getPostById).toHaveBeenCalledWith('post-media')
    expect(reportRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'report-media',
        targetType: 'media',
        targetId: 'https://cdn.example.com/media/reportable.png',
        targetPostId: 'post-media',
        mediaUrl: 'https://cdn.example.com/media/reportable.png',
        reasonCode: 'nsfw',
      }),
    )
  })

  it('creates a report for a user target', async () => {
    const reportRepository = createReportRepository()
    const postStore = createPostStore(async () => null)
    const userRepository = createUserRepository(async () =>
      createStoredUser({
        id: 'github:target-user',
        handle: 'grace',
        handleLower: 'grace',
        displayName: 'Grace Hopper',
      }),
    )
    const handler = buildCreateReportHandler({
      idFactory: () => 'report-user',
      now: () => new Date('2026-04-16T07:00:00.000Z'),
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => postStore,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest({
        targetType: 'user',
        targetId: 'github:target-user',
        targetProfileHandle: 'spoofed-handle',
        reasonCode: 'impersonation',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(userRepository.getById).toHaveBeenCalledWith('github:target-user')
    expect(reportRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'report-user',
        targetType: 'user',
        targetId: 'github:target-user',
        targetPostId: null,
        targetAuthorId: 'github:target-user',
        targetAuthorHandle: 'grace',
        targetProfileHandle: 'grace',
        reasonCode: 'impersonation',
      }),
    )
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () => createReportRepository(),
      postStoreFactory: () => createPostStore(async () => null),
      userRepositoryFactory: () => createUserRepository(async () => null),
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
      reportRepositoryFactory: () => createReportRepository(),
      postStoreFactory: () => createPostStore(async () => null),
      userRepositoryFactory: () => createUserRepository(async () => null),
    })

    const response = await handler(
      createRequest({
        targetType: 'thread',
        targetId: 'thread-1',
        reasonCode: 'spam',
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

  it('returns validation errors when media context is incomplete', async () => {
    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () => createReportRepository(),
      postStoreFactory: () => createPostStore(async () => null),
      userRepositoryFactory: () => createUserRepository(async () => null),
    })

    const response = await handler(
      createRequest({
        targetType: 'media',
        targetId: 'media-1',
        reasonCode: 'nsfw',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_report',
          message: 'Media reports must include the parent post id.',
          field: 'targetPostId',
        },
      ],
    })
  })

  it('returns 404 when the reported target does not exist', async () => {
    const reportRepository = createReportRepository()
    const postStore = createPostStore(async () => null)
    const userRepository = createUserRepository(async () => null)
    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => postStore,
      userRepositoryFactory: () => userRepository,
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'missing-post',
        reasonCode: 'spam',
      }),
      createContext(),
    )

    expect(response.status).toBe(404)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'report_target_not_found',
          message: 'The reported target could not be found.',
          field: 'targetId',
        },
      ],
    })
    expect(reportRepository.create).not.toHaveBeenCalled()
  })

  it('rejects users who do not have an active profile with a handle', async () => {
    const reportRepository = createReportRepository()
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () => reportRepository,
      postStoreFactory: () => createPostStore(async () => createStoredPost()),
      userRepositoryFactory: () => createUserRepository(async () => null),
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-1',
        reasonCode: 'spam',
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
            'The authenticated user must have an active profile before reporting content.',
        },
      ],
    })
    expect(reportRepository.create).not.toHaveBeenCalled()
  })

  it('returns 500 when the report flow repositories are not configured', async () => {
    const context = createContext()
    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-1',
        reasonCode: 'spam',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The report flow is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the report flow repositories.',
      {
        error: 'missing config',
      },
    )
  })

  it('returns 500 when report persistence fails', async () => {
    const context = createContext()
    const handler = buildCreateReportHandler({
      reportRepositoryFactory: () =>
        createReportRepository({
          create: async () => {
            throw new Error('Cosmos unavailable')
          },
        }),
      postStoreFactory: () => createPostStore(async () => createStoredPost()),
      userRepositoryFactory: () => createUserRepository(async () => null),
    })

    const response = await handler(
      createRequest({
        targetType: 'post',
        targetId: 'post-1',
        reasonCode: 'spam',
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
    expect(context.log).toHaveBeenCalledWith(
      'Failed to create a moderation report.',
      {
        error: 'Cosmos unavailable',
        reporterId: 'github:abc123',
        targetType: 'post',
        targetId: 'post-1',
      },
    )
  })
})
