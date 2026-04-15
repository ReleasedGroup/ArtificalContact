import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreateReplyHandler } from '../src/functions/create-reply.js'
import type {
  ReadablePostRepository,
  StoredPostDocument,
  UserPostDocument,
} from '../src/lib/posts.js'
import type { UserDocument } from '../src/lib/users.js'

function createRequest(
  body: unknown,
  options?: {
    invalidJson?: boolean
    postId?: string
  },
) {
  return {
    json: async () => {
      if (options?.invalidJson) {
        throw new Error('Invalid JSON')
      }

      return body
    },
    params: {
      id: options?.postId ?? 'reply-parent',
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
    id: 'reply-parent',
    type: 'reply',
    kind: 'user',
    threadId: 'thread-root',
    parentId: 'thread-root',
    authorId: 'github:parent',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Root thread context.',
    hashtags: ['root'],
    mentions: [],
    counters: {
      likes: 2,
      dislikes: 0,
      emoji: 1,
      replies: 4,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T02:00:00.000Z',
    updatedAt: '2026-04-15T03:00:00.000Z',
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

describe('createReplyHandler', () => {
  it('creates a nested reply that inherits the root thread id', async () => {
    const parentPost = createStoredPost()
    const repository: ReadablePostRepository = {
      getPostById: vi.fn(async () => parentPost),
      create: vi.fn(async (post) => post),
    }
    const handler = buildCreateReplyHandler({
      idFactory: () => 'reply-2',
      maxTextLength: 280,
      now: () => new Date('2026-04-15T04:00:00.000Z'),
      repositoryFactory: () => repository,
    })
    const context = createContext()

    const response = await handler(
      createRequest({
        text: '  Following up with #Azure and @Grace before the demo.  ',
      }),
      context,
    )

    expect(repository.getPostById).toHaveBeenCalledWith('reply-parent')
    expect(repository.create).toHaveBeenCalledWith({
      id: 'reply-2',
      type: 'reply',
      kind: 'user',
      threadId: 'thread-root',
      parentId: 'reply-parent',
      authorId: 'github:abc123',
      authorHandle: 'nick',
      authorDisplayName: 'Nick Beaugeard',
      authorAvatarUrl: 'https://cdn.example.com/nick.png',
      text: 'Following up with #Azure and @Grace before the demo.',
      hashtags: ['azure'],
      mentions: ['grace'],
      counters: {
        likes: 0,
        dislikes: 0,
        emoji: 0,
        replies: 0,
      },
      visibility: 'public',
      moderationState: 'ok',
      createdAt: '2026-04-15T04:00:00.000Z',
      updatedAt: '2026-04-15T04:00:00.000Z',
      deletedAt: null,
    } satisfies UserPostDocument)
    expect(response.status).toBe(201)
    expect(response.jsonBody).toEqual({
      data: {
        post: {
          id: 'reply-2',
          type: 'reply',
          kind: 'user',
          threadId: 'thread-root',
          parentId: 'reply-parent',
          authorId: 'github:abc123',
          authorHandle: 'nick',
          authorDisplayName: 'Nick Beaugeard',
          authorAvatarUrl: 'https://cdn.example.com/nick.png',
          text: 'Following up with #Azure and @Grace before the demo.',
          hashtags: ['azure'],
          mentions: ['grace'],
          counters: {
            likes: 0,
            dislikes: 0,
            emoji: 0,
            replies: 0,
          },
          visibility: 'public',
          moderationState: 'ok',
          createdAt: '2026-04-15T04:00:00.000Z',
          updatedAt: '2026-04-15T04:00:00.000Z',
          deletedAt: null,
        },
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Created reply post.', {
      authorId: 'github:abc123',
      parentId: 'reply-parent',
      replyId: 'reply-2',
      threadId: 'thread-root',
    })
  })

  it('returns 400 when the post id path parameter is missing', async () => {
    const repository: ReadablePostRepository = {
      getPostById: vi.fn(async () => null),
      create: vi.fn(async (post) => post),
    }
    const handler = buildCreateReplyHandler({
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest(
        {
          text: 'hello world',
        },
        { postId: '   ' },
      ),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_post_id',
          message: 'The post id path parameter is required.',
          field: 'id',
        },
      ],
    })
    expect(repository.getPostById).not.toHaveBeenCalled()
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildCreateReplyHandler({
      repositoryFactory: () => ({
        getPostById: async () => createStoredPost(),
        create: async (post) => post,
      }),
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

  it('returns validation errors when the reply text is too long', async () => {
    const handler = buildCreateReplyHandler({
      maxTextLength: 5,
      repositoryFactory: () => ({
        getPostById: async () => createStoredPost(),
        create: async (post) => post,
      }),
    })

    const response = await handler(
      createRequest({
        text: 'abcdef',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_post',
          message: 'Too big: expected string to have <=5 characters',
          field: 'text',
        },
      ],
    })
  })

  it('returns 500 when the reply validation configuration is invalid', async () => {
    const originalMaxLength = process.env.POST_MAX_LENGTH
    process.env.POST_MAX_LENGTH = 'invalid'

    try {
      const context = createContext()
      const handler = buildCreateReplyHandler({
        repositoryFactory: () => ({
          getPostById: async () => createStoredPost(),
          create: async (post) => post,
        }),
      })

      const response = await handler(
        createRequest({
          text: 'hello world',
        }),
        context,
      )

      expect(response.status).toBe(500)
      expect(response.jsonBody).toEqual({
        data: null,
        errors: [
          {
            code: 'server.configuration_error',
            message: 'The reply validation configuration is invalid.',
          },
        ],
      })
      expect(context.log).toHaveBeenCalledWith(
        'Failed to configure the reply validation rules.',
        {
          error: 'POST_MAX_LENGTH must be a positive integer.',
        },
      )
    } finally {
      if (originalMaxLength === undefined) {
        delete process.env.POST_MAX_LENGTH
      } else {
        process.env.POST_MAX_LENGTH = originalMaxLength
      }
    }
  })

  it('returns 404 when the parent post is missing or not publicly visible', async () => {
    const hiddenParent = createStoredPost({
      moderationState: 'hidden',
    })

    for (const parentPost of [null, hiddenParent]) {
      const handler = buildCreateReplyHandler({
        repositoryFactory: () => ({
          getPostById: async () => parentPost,
          create: async (post) => post,
        }),
      })

      const response = await handler(
        createRequest({
          text: 'hello world',
        }),
        createContext(),
      )

      expect(response.status).toBe(404)
      expect(response.jsonBody).toEqual({
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No public post exists for the requested id.',
            field: 'id',
          },
        ],
      })
    }
  })

  it('rejects users who do not have an active profile with a handle', async () => {
    const repository: ReadablePostRepository = {
      getPostById: vi.fn(async () => createStoredPost()),
      create: vi.fn(async (post) => post),
    }
    const handler = buildCreateReplyHandler({
      repositoryFactory: () => repository,
    })
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const response = await handler(
      createRequest({
        text: 'hello world',
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
            'The authenticated user must have an active profile before creating replies.',
        },
      ],
    })
    expect(repository.getPostById).not.toHaveBeenCalled()
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('returns 500 when the post repository is not configured', async () => {
    const context = createContext()
    const handler = buildCreateReplyHandler({
      repositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createRequest({
        text: 'hello world',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The post store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the post repository.',
      {
        error: 'missing config',
      },
    )
  })

  it('returns 500 when the reply write fails', async () => {
    const context = createContext()
    const handler = buildCreateReplyHandler({
      repositoryFactory: () => ({
        getPostById: async () => createStoredPost(),
        create: async () => {
          throw new Error('Cosmos unavailable')
        },
      }),
    })

    const response = await handler(
      createRequest({
        text: 'hello world',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.reply_create_failed',
          message: 'Unable to create the reply.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith('Failed to create the reply.', {
      error: 'Cosmos unavailable',
      authorId: 'github:abc123',
      parentId: 'reply-parent',
    })
  })
})
