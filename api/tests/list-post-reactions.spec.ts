import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildListPostReactionsHandler } from '../src/functions/list-post-reactions.js'
import {
  DEFAULT_REACTION_SUMMARY_PAGE_SIZE,
  lookupReactionSummaryPage,
} from '../src/lib/reaction-summary.js'
import type { PostStore, StoredPostDocument } from '../src/lib/posts.js'
import type {
  ReactionDocument,
  ReactionListRepository,
} from '../src/lib/reactions.js'
import type {
  StoredUserDocument,
  UserProfileStore,
} from '../src/lib/user-profile.js'

class InMemoryPostStore implements PostStore {
  constructor(private readonly posts = new Map<string, StoredPostDocument>()) {}

  async getPostById(postId: string): Promise<StoredPostDocument | null> {
    return this.posts.get(postId) ?? null
  }
}

class InMemoryUserProfileStore implements UserProfileStore {
  constructor(private readonly users = new Map<string, StoredUserDocument>()) {}

  async getByHandle(): Promise<null> {
    return null
  }

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    return this.users.get(userId) ?? null
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
    authorId: 'user-1',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Root post.',
    hashtags: [],
    mentions: [],
    media: [],
    counters: {
      likes: 12,
      dislikes: 2,
      emoji: 5,
      replies: 1,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createPostStore(posts: StoredPostDocument[] = []) {
  return new InMemoryPostStore(new Map(posts.map((post) => [post.id, post])))
}

function createStoredUser(
  id: string,
  overrides: Partial<StoredUserDocument> = {},
): StoredUserDocument {
  return {
    id,
    handle: `user-${id}`,
    handleLower: `user-${id}`,
    displayName: `User ${id}`,
    bio: `Bio for ${id}`,
    avatarUrl: `https://cdn.example.com/${id}.png`,
    bannerUrl: `https://cdn.example.com/${id}-banner.png`,
    expertise: ['agents'],
    counters: {
      posts: 3,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    status: 'active',
    ...overrides,
  }
}

function createProfileStore(users: StoredUserDocument[] = []) {
  return new InMemoryUserProfileStore(
    new Map(users.map((user) => [user.id, user])),
  )
}

function createReactionDocument(
  userId: string,
  overrides: Partial<ReactionDocument> = {},
): ReactionDocument {
  return {
    id: `post-1:${userId}`,
    type: 'reaction',
    postId: 'post-1',
    userId,
    sentiment: 'like',
    emojiValues: [],
    gifValue: null,
    createdAt: '2026-04-15T02:00:00.000Z',
    updatedAt: '2026-04-15T03:00:00.000Z',
    ...overrides,
  }
}

function createReactionStore(
  result:
    | {
        reactions: ReactionDocument[]
        continuationToken?: string
      }
    | Array<{
        reactions: ReactionDocument[]
        continuationToken?: string
      }>,
) {
  const results = Array.isArray(result) ? [...result] : [result]

  return {
    listByPostId: vi.fn(async () => results.shift() ?? { reactions: [] }),
  } satisfies ReactionListRepository
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('lookupReactionSummaryPage', () => {
  it('returns a filtered public page of reactions for the requested type', async () => {
    const reactionStore = createReactionStore([
      {
        reactions: [
          createReactionDocument('user-2', {
            emojiValues: ['🎉', '🔥'],
          } as Partial<ReactionDocument>),
          createReactionDocument('user-3'),
          createReactionDocument('user-4'),
        ],
        continuationToken: 'next-token',
      },
      {
        reactions: [],
      },
    ])

    const result = await lookupReactionSummaryPage(
      {
        postId: ' post-1 ',
        limit: '2',
        continuationToken: ' opaque-token ',
        type: 'emoji',
      },
      createPostStore([createStoredPost()]),
      reactionStore,
      createProfileStore([
        createStoredUser('user-2', {
          handle: 'Grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
        }),
        createStoredUser('user-3', {
          handle: 'Hidden',
          handleLower: 'hidden',
          status: 'suspended',
        }),
        createStoredUser('user-4', {
          handle: null,
          handleLower: null,
        }),
      ]),
    )

    expect(reactionStore.listByPostId).toHaveBeenNthCalledWith(1, 'post-1', {
      limit: 2,
      continuationToken: 'opaque-token',
      type: 'emoji',
    })
    expect(reactionStore.listByPostId).toHaveBeenNthCalledWith(2, 'post-1', {
      limit: 1,
      continuationToken: 'next-token',
      type: 'emoji',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          reactions: [
            {
              actor: {
                id: 'user-2',
                handle: 'Grace',
                displayName: 'Grace Hopper',
                avatarUrl: 'https://cdn.example.com/user-2.png',
              },
              sentiment: 'like',
              emojiValues: ['🎉', '🔥'],
              gifValue: null,
              reactedAt: '2026-04-15T03:00:00.000Z',
            },
          ],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('keeps paging until it fills the requested public reaction page', async () => {
    const reactionStore = {
      listByPostId: vi
        .fn()
        .mockResolvedValueOnce({
          reactions: [createReactionDocument('user-3')],
          continuationToken: 'next-token',
        })
        .mockResolvedValueOnce({
          reactions: [createReactionDocument('user-2')],
        }),
    } satisfies ReactionListRepository

    const result = await lookupReactionSummaryPage(
      {
        postId: 'post-1',
        limit: '1',
        type: 'like',
      },
      createPostStore([createStoredPost()]),
      reactionStore,
      createProfileStore([
        createStoredUser('user-2', {
          handle: 'Grace',
          handleLower: 'grace',
          displayName: 'Grace Hopper',
        }),
        createStoredUser('user-3', {
          handle: 'Hidden',
          handleLower: 'hidden',
          status: 'suspended',
        }),
      ]),
    )

    expect(reactionStore.listByPostId).toHaveBeenNthCalledWith(1, 'post-1', {
      limit: 1,
      type: 'like',
    })
    expect(reactionStore.listByPostId).toHaveBeenNthCalledWith(2, 'post-1', {
      limit: 1,
      continuationToken: 'next-token',
      type: 'like',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          reactions: [
            {
              actor: {
                id: 'user-2',
                handle: 'Grace',
                displayName: 'Grace Hopper',
                avatarUrl: 'https://cdn.example.com/user-2.png',
              },
              sentiment: 'like',
              emojiValues: [],
              gifValue: null,
              reactedAt: '2026-04-15T03:00:00.000Z',
            },
          ],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('uses the default page size and accepts all reactions when no type is provided', async () => {
    const reactionStore = createReactionStore({
      reactions: [],
    })

    const result = await lookupReactionSummaryPage(
      {
        postId: 'post-1',
      },
      createPostStore([createStoredPost()]),
      reactionStore,
      createProfileStore(),
    )

    expect(reactionStore.listByPostId).toHaveBeenCalledWith('post-1', {
      limit: DEFAULT_REACTION_SUMMARY_PAGE_SIZE,
      type: 'all',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          reactions: [],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('returns a validation error when the post id is missing', async () => {
    const result = await lookupReactionSummaryPage(
      {
        postId: '  ',
      },
      createPostStore(),
      createReactionStore({
        reactions: [],
      }),
      createProfileStore(),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_post_id',
            message: 'The post id path parameter is required.',
            field: 'id',
          },
        ],
      },
    })
  })

  it('returns a validation error when the limit is invalid', async () => {
    const reactionStore = createReactionStore({
      reactions: [],
    })

    const result = await lookupReactionSummaryPage(
      {
        postId: 'post-1',
        limit: '250',
      },
      createPostStore([createStoredPost()]),
      reactionStore,
      createProfileStore(),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_limit',
            message:
              'The limit query parameter must be an integer between 1 and 100.',
            field: 'limit',
          },
        ],
      },
    })
    expect(reactionStore.listByPostId).not.toHaveBeenCalled()
  })

  it('returns a validation error when the type is invalid', async () => {
    const reactionStore = createReactionStore({
      reactions: [],
    })

    const result = await lookupReactionSummaryPage(
      {
        postId: 'post-1',
        type: 'party',
      },
      createPostStore([createStoredPost()]),
      reactionStore,
      createProfileStore(),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_reaction_type',
            message:
              'The type query parameter must be one of all, like, dislike, emoji, or gif.',
            field: 'type',
          },
        ],
      },
    })
    expect(reactionStore.listByPostId).not.toHaveBeenCalled()
  })

  it('returns not found when the target post is not public', async () => {
    const result = await lookupReactionSummaryPage(
      {
        postId: 'post-1',
      },
      createPostStore([
        createStoredPost({
          visibility: 'followers',
        }),
      ]),
      createReactionStore({
        reactions: [],
      }),
      createProfileStore(),
    )

    expect(result).toEqual({
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No public post exists for the requested id.',
            field: 'id',
          },
        ],
      },
    })
  })
})

describe('listPostReactionsHandler', () => {
  it('returns an HTTP response with the reaction summary envelope and headers', async () => {
    const postStore = createPostStore([createStoredPost()])
    const reactionStore = createReactionStore([
      {
        reactions: [
          createReactionDocument('user-2', {
            sentiment: 'dislike',
          }),
        ],
        continuationToken: 'next-token',
      },
      {
        reactions: [],
      },
    ])
    const profileStore = createProfileStore([
      createStoredUser('user-2', {
        handle: 'Grace',
        handleLower: 'grace',
        displayName: 'Grace Hopper',
      }),
    ])
    const handler = buildListPostReactionsHandler({
      postStoreFactory: () => postStore,
      reactionStoreFactory: () => reactionStore,
      profileStoreFactory: () => profileStore,
    })
    const context = createContext()

    const response = await handler(
      {
        params: { id: 'post-1' },
        query: new URLSearchParams(
          'limit=10&continuationToken=opaque-token&type=dislike',
        ),
      } as unknown as HttpRequest,
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        reactions: [
          {
            actor: {
              id: 'user-2',
              handle: 'Grace',
              displayName: 'Grace Hopper',
              avatarUrl: 'https://cdn.example.com/user-2.png',
            },
            sentiment: 'dislike',
            emojiValues: [],
            gifValue: null,
            reactedAt: '2026-04-15T03:00:00.000Z',
          },
        ],
        continuationToken: null,
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Post reactions lookup completed.',
      {
        continuationTokenPresent: false,
        postId: 'post-1',
        status: 200,
        type: 'dislike',
      },
    )
  })

  it('returns a predictable 500 response when the reaction store is not configured', async () => {
    const handler = buildListPostReactionsHandler({
      postStoreFactory: () => createPostStore(),
      reactionStoreFactory: () => {
        throw new Error('Missing reactions container')
      },
      profileStoreFactory: () => createProfileStore(),
    })

    const response = await handler(
      {
        params: { id: 'post-1' },
        query: new URLSearchParams(),
      } as unknown as HttpRequest,
      createContext(),
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
  })

  it('returns 500 when the reaction summary lookup fails', async () => {
    const handler = buildListPostReactionsHandler({
      postStoreFactory: () => createPostStore([createStoredPost()]),
      reactionStoreFactory: () => ({
        listByPostId: vi.fn(async () => {
          throw new Error('Cosmos unavailable')
        }),
      }),
      profileStoreFactory: () => createProfileStore(),
    })

    const response = await handler(
      {
        params: { id: 'post-1' },
        query: new URLSearchParams('type=like'),
      } as unknown as HttpRequest,
      createContext(),
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.post_reactions_lookup_failed',
          message: 'Unable to load the requested post reactions.',
        },
      ],
    })
  })
})
