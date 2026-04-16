import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildDeleteReactionHandler } from '../src/functions/delete-reaction.js'
import type { PostStore, StoredPostDocument } from '../src/lib/posts.js'
import type {
  ReactionDocument,
  ReactionRepository,
} from '../src/lib/reactions.js'
import type { UserDocument } from '../src/lib/users.js'

function createRequest(options?: { postId?: string; emoji?: string | null }) {
  const query = new URLSearchParams()

  if (options?.emoji !== undefined) {
    query.set('emoji', options.emoji ?? '')
  }

  return {
    params: {
      id: options?.postId ?? 'post-1',
    },
    query,
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
    deleteByPostAndUser: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('deleteReactionHandler', () => {
  it('deletes the caller reaction document when no emoji selector is provided', async () => {
    const postStore = {
      getPostById: vi.fn(async () => createStoredPost()),
      getReactionSummary: vi.fn(async () => ({
        likes: 1,
        dislikes: 0,
        emoji: 0,
      })),
      setReactionCounts: vi.fn(async () => undefined),
    }
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () =>
        createStoredReaction({
          sentiment: 'like',
          emojiValues: ['🎉'],
          gifValue: 'gif://party',
        }),
      ),
    })
    const handler = buildDeleteReactionHandler({
      now: () => new Date('2026-04-15T08:00:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })
    const context = createContext()

    const response = await handler(createRequest(), context)

    expect(reactionRepository.deleteByPostAndUser).toHaveBeenCalledWith(
      'post-1',
      'github:abc123',
    )
    expect(postStore.getReactionSummary).toHaveBeenCalledWith('post-1')
    expect(postStore.setReactionCounts).toHaveBeenCalledWith('post-1', 'post-1', {
      likes: 1,
      dislikes: 0,
      emoji: 0,
      replies: 4,
    })
    expect(reactionRepository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        unreact: {
          id: 'post-1:github:abc123',
          postId: 'post-1',
          userId: 'github:abc123',
          reactionExisted: true,
          deletedReaction: true,
          removedEmojiValue: null,
          emojiValueRemoved: false,
        },
        reaction: null,
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Processed reaction delete request.',
      {
        actorId: 'github:abc123',
        postId: 'post-1',
        reactionId: 'post-1:github:abc123',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: null,
        emojiValueRemoved: false,
      },
    )
  })

  it('treats repeated whole-reaction deletes as a successful no-op', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository()
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(createRequest(), createContext())

    expect(reactionRepository.deleteByPostAndUser).not.toHaveBeenCalled()
    expect(reactionRepository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        unreact: {
          id: 'post-1:github:abc123',
          postId: 'post-1',
          userId: 'github:abc123',
          reactionExisted: false,
          deletedReaction: false,
          removedEmojiValue: null,
          emojiValueRemoved: false,
        },
        reaction: null,
      },
      errors: [],
    })
  })

  it('removes a selected emoji while preserving the remaining reaction state', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () =>
        createStoredReaction({
          sentiment: 'like',
          emojiValues: ['🎉', '🔥'],
          gifValue: 'gif://party',
        }),
      ),
    })
    const handler = buildDeleteReactionHandler({
      now: () => new Date('2026-04-15T08:05:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({ emoji: '🎉' }),
      createContext(),
    )

    expect(reactionRepository.deleteByPostAndUser).not.toHaveBeenCalled()
    expect(reactionRepository.upsert).toHaveBeenCalledWith(
      createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🔥'],
        gifValue: 'gif://party',
        updatedAt: '2026-04-15T08:05:00.000Z',
      }),
    )
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        unreact: {
          id: 'post-1:github:abc123',
          postId: 'post-1',
          userId: 'github:abc123',
          reactionExisted: true,
          deletedReaction: false,
          removedEmojiValue: '🎉',
          emojiValueRemoved: true,
        },
        reaction: createStoredReaction({
          sentiment: 'like',
          emojiValues: ['🔥'],
          gifValue: 'gif://party',
          updatedAt: '2026-04-15T08:05:00.000Z',
        }),
      },
      errors: [],
    })
  })

  it('deletes the document when removing the final emoji leaves no reaction state', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () =>
        createStoredReaction({
          emojiValues: ['🎉'],
        }),
      ),
    })
    const handler = buildDeleteReactionHandler({
      now: () => new Date('2026-04-15T08:10:00.000Z'),
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({ emoji: '🎉' }),
      createContext(),
    )

    expect(reactionRepository.deleteByPostAndUser).toHaveBeenCalledWith(
      'post-1',
      'github:abc123',
    )
    expect(reactionRepository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        unreact: {
          id: 'post-1:github:abc123',
          postId: 'post-1',
          userId: 'github:abc123',
          reactionExisted: true,
          deletedReaction: true,
          removedEmojiValue: '🎉',
          emojiValueRemoved: true,
        },
        reaction: null,
      },
      errors: [],
    })
  })

  it('treats missing emoji values as a successful no-op against the existing reaction', async () => {
    const existingReaction = createStoredReaction({
      sentiment: 'like',
      emojiValues: ['🎉'],
      gifValue: 'gif://party',
    })
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () => existingReaction),
    })
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({ emoji: '🔥' }),
      createContext(),
    )

    expect(reactionRepository.deleteByPostAndUser).not.toHaveBeenCalled()
    expect(reactionRepository.upsert).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        unreact: {
          id: 'post-1:github:abc123',
          postId: 'post-1',
          userId: 'github:abc123',
          reactionExisted: true,
          deletedReaction: false,
          removedEmojiValue: '🔥',
          emojiValueRemoved: false,
        },
        reaction: existingReaction,
      },
      errors: [],
    })
  })

  it('rejects an empty emoji selector', async () => {
    const postStore: PostStore = {
      getPostById: vi.fn(async () => createStoredPost()),
    }
    const reactionRepository = createReactionRepository()
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => postStore,
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(
      createRequest({ emoji: '   ' }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_emoji_value',
          message: 'The emoji query parameter must be a non-empty string.',
          field: 'emoji',
        },
      ],
    })
    expect(postStore.getPostById).not.toHaveBeenCalled()
    expect(reactionRepository.getByPostAndUser).not.toHaveBeenCalled()
  })

  it('returns 404 when the post is missing or not publicly visible', async () => {
    const hiddenPost = createStoredPost({
      moderationState: 'hidden',
    })

    for (const post of [null, hiddenPost]) {
      const reactionRepository = createReactionRepository()
      const handler = buildDeleteReactionHandler({
        postStoreFactory: () => ({
          getPostById: async () => post,
        }),
        reactionRepositoryFactory: () => reactionRepository,
      })

      const response = await handler(createRequest(), createContext())

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
      expect(reactionRepository.getByPostAndUser).not.toHaveBeenCalled()
    }
  })

  it('rejects users without an active profile and handle', async () => {
    const reactionRepository = createReactionRepository()
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(createRequest(), createContext(pendingUser))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before removing reactions from posts.',
        },
      ],
    })
    expect(reactionRepository.getByPostAndUser).not.toHaveBeenCalled()
  })

  it('returns 500 when the reaction repository is not configured', async () => {
    const context = createContext()
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => {
        throw new Error('missing config')
      },
    })

    const response = await handler(createRequest(), context)

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

  it('returns 500 when the reaction delete fails', async () => {
    const context = createContext()
    const reactionRepository = createReactionRepository({
      getByPostAndUser: vi.fn(async () =>
        createStoredReaction({
          sentiment: 'like',
        }),
      ),
      deleteByPostAndUser: vi.fn(async () => {
        throw new Error('Cosmos unavailable')
      }),
    })
    const handler = buildDeleteReactionHandler({
      postStoreFactory: () => ({
        getPostById: async () => createStoredPost(),
      }),
      reactionRepositoryFactory: () => reactionRepository,
    })

    const response = await handler(createRequest(), context)

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.reaction_delete_failed',
          message: 'Unable to delete the requested reaction.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to delete the requested reaction.',
      {
        error: 'Cosmos unavailable',
        actorId: 'github:abc123',
        postId: 'post-1',
        removedEmojiValue: null,
      },
    )
  })
})
