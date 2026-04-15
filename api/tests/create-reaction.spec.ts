import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreateReactionHandler } from '../src/functions/create-reaction.js'
import type { PostStore, StoredPostDocument } from '../src/lib/posts.js'
import type {
  ReactionDocument,
  ReactionRepository,
} from '../src/lib/reactions.js'
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
      id: options?.postId ?? 'post-1',
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
    authorId: 'github:author',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Root post.',
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

function createStoredReaction(
  overrides: Partial<ReactionDocument> = {},
): ReactionDocument {
  return {
    id: 'post-1:github:abc123',
    type: 'reaction',
    postId: 'post-1',
    userId: 'github:abc123',
    sentiment: null,
    emojiValues: [],
    gifValue: null,
    createdAt: '2026-04-15T04:00:00.000Z',
    updatedAt: '2026-04-15T04:00:00.000Z',
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

function createReactionRepository(
  overrides: Partial<ReactionRepository> = {},
): ReactionRepository {
  return {
    getByPostAndUser: vi.fn(async () => null),
    create: vi.fn(async (reaction) => reaction),
    upsert: vi.fn(async (reaction) => reaction),
    ...overrides,
  }
}

describe('createReactionHandler', () => {
  it('creates a new like reaction document for a public post', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository()
    const handler = buildCreateReactionHandler({
      now: () => new Date('2026-04-15T04:00:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })
    const context = createContext()

    const response = await handler(
      createRequest({
        type: 'like',
      }),
      context,
    )

    expect(postStore.getPostById).toHaveBeenCalledWith('post-1')
    expect(reactionRepository.create).toHaveBeenCalledWith(
      createStoredReaction({
        sentiment: 'like',
      }),
    )
    expect(response.status).toBe(201)
    expect(response.jsonBody).toEqual({
      data: {
        reaction: createStoredReaction({
          sentiment: 'like',
        }),
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Recorded post reaction.', {
      actorId: 'github:abc123',
      postId: 'post-1',
      reactionId: 'post-1:github:abc123',
      reactionType: 'like',
      status: 201,
    })
  })

  it('switches from dislike to like without dropping existing additive values', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () =>
        createStoredReaction({
          sentiment: 'dislike',
          emojiValues: ['🎉'],
          gifValue: 'gif://party',
        }),
      ),
    })
    const handler = buildCreateReactionHandler({
      now: () => new Date('2026-04-15T05:00:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({
        type: 'like',
      }),
      createContext(),
    )

    expect(reactionRepository.create).not.toHaveBeenCalled()
    expect(reactionRepository.upsert).toHaveBeenCalledWith(
      createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
        updatedAt: '2026-04-15T05:00:00.000Z',
      }),
    )
    expect(response.status).toBe(200)
  })

  it('treats duplicate emoji reactions as idempotent', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const existingReaction = createStoredReaction({
      emojiValues: ['🎉'],
      updatedAt: '2026-04-15T04:30:00.000Z',
    })
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () => existingReaction),
    })
    const handler = buildCreateReactionHandler({
      now: () => new Date('2026-04-15T05:00:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({
        type: 'emoji',
        value: '🎉',
      }),
      createContext(),
    )

    expect(reactionRepository.create).not.toHaveBeenCalled()
    expect(reactionRepository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        reaction: existingReaction,
      },
      errors: [],
    })
  })

  it('recovers from a create conflict by re-reading and upserting the merged reaction', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const getByPostAndUser = vi
      .fn<ReactionRepository['getByPostAndUser']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        createStoredReaction({
          sentiment: 'like',
        }),
      )
    const reactionRepository = createReactionRepository({
      getByPostAndUser,
      create: vi.fn(async () => {
        const error = new Error('conflict') as Error & { statusCode: number }
        error.statusCode = 409
        throw error
      }),
    })
    const handler = buildCreateReactionHandler({
      now: () => new Date('2026-04-15T06:00:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({
        type: 'emoji',
        value: '🔥',
      }),
      createContext(),
    )

    expect(reactionRepository.upsert).toHaveBeenCalledWith(
      createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🔥'],
        updatedAt: '2026-04-15T06:00:00.000Z',
      }),
    )
    expect(response.status).toBe(200)
  })

  it('returns 400 when the post id path parameter is missing', async () => {
    const reactionRepository = createReactionRepository()
    const handler = buildCreateReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest(
        {
          type: 'like',
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
    expect(reactionRepository.getByPostAndUser).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildCreateReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => createReactionRepository(),
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

  it('returns validation errors when a gif reaction omits its value', async () => {
    const handler = buildCreateReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => createReactionRepository(),
    })

    const response = await handler(
      createRequest({
        type: 'gif',
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_reaction',
          message: 'GIF reactions require a value.',
          field: 'value',
        },
      ],
    })
  })

  it('returns 404 when the post is missing or not publicly visible', async () => {
    const hiddenPost = createStoredPost({
      moderationState: 'hidden',
    })

    for (const post of [null, hiddenPost]) {
      const handler = buildCreateReactionHandler({
        postStoreFactory: () => ({
          getPostById: async () => post,
        }),
        reactionRepositoryFactory: () => createReactionRepository(),
      })

      const response = await handler(
        createRequest({
          type: 'like',
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

  it('rejects users without an active profile and handle', async () => {
    const reactionRepository = createReactionRepository()
    const handler = buildCreateReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => reactionRepository,
    })
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const response = await handler(
      createRequest({
        type: 'like',
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
            'The authenticated user must have an active profile before reacting to posts.',
        },
      ],
    })
    expect(reactionRepository.getByPostAndUser).not.toHaveBeenCalled()
  })

  it('returns 500 when the reaction repository is not configured', async () => {
    const context = createContext()
    const handler = buildCreateReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(
      createRequest({
        type: 'like',
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The reaction store is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the reaction repository.',
      {
        error: 'missing config',
      },
    )
  })
})
