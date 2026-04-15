import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetFeedHandler } from '../src/functions/get-feed.js'
import {
  DEFAULT_FEED_PAGE_SIZE,
  lookupFeed,
  type FeedStore,
  type StoredFeedDocument,
} from '../src/lib/feed.js'
import type { UserDocument } from '../src/lib/users.js'

class InMemoryFeedStore implements FeedStore {
  constructor(
    private readonly pages: Record<
      string,
      {
        entries: StoredFeedDocument[]
        cursor?: string
      }
    >,
    private readonly pullPages?: Record<
      string,
      {
        entries: StoredFeedDocument[]
        cursor?: string
      }
    >,
  ) {}

  async listFeedEntries(
    feedOwnerId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    entries: StoredFeedDocument[]
    cursor?: string
  }> {
    void feedOwnerId
    return this.pages[options.cursor ?? '__start__'] ?? { entries: [] }
  }

  async listPullOnReadFeedEntries(
    feedOwnerId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    entries: StoredFeedDocument[]
    cursor?: string
  }> {
    void feedOwnerId
    return this.pullPages?.[options.cursor ?? '__start__'] ?? { entries: [] }
  }
}

function createStoredFeedEntry(
  overrides: Partial<StoredFeedDocument> = {},
): StoredFeedDocument {
  return {
    id: 'f_user-1_post-1',
    feedOwnerId: 'user-1',
    postId: 'post-1',
    authorId: 'user-2',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    excerpt: 'Trying out a new eval harness...',
    media: [
      {
        kind: 'image',
        thumbUrl: 'https://cdn.example.com/thumb.png',
      },
    ],
    counters: {
      likes: 4,
      replies: 3,
    },
    createdAt: '2026-04-15T09:00:00.000Z',
    ttl: 2592000,
    ...overrides,
  }
}

function createStore(result: {
  entries: StoredFeedDocument[]
  cursor?: string
}) {
  return new InMemoryFeedStore({
    __start__: result,
  })
}

function createMergedStore(options: {
  feedEntries: StoredFeedDocument[]
  feedCursor?: string
  pullEntries: StoredFeedDocument[]
  pullCursor?: string
}) {
  return new InMemoryFeedStore(
    {
      __start__: {
        entries: options.feedEntries,
        ...(options.feedCursor === undefined
          ? {}
          : { cursor: options.feedCursor }),
      },
    },
    {
      __start__: {
        entries: options.pullEntries,
        ...(options.pullCursor === undefined
          ? {}
          : { cursor: options.pullCursor }),
      },
    },
  )
}

function createPagedMergedStore(options: {
  feedPages: Record<
    string,
    {
      entries: StoredFeedDocument[]
      cursor?: string
    }
  >
  pullPages: Record<
    string,
    {
      entries: StoredFeedDocument[]
      cursor?: string
    }
  >
}) {
  return new InMemoryFeedStore(options.feedPages, options.pullPages)
}

function createRequest(query = ''): HttpRequest {
  return {
    query: new URLSearchParams(query),
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

describe('lookupFeed', () => {
  it('returns a normalized feed page with a cursor token', async () => {
    const store = {
      listFeedEntries: vi.fn(async () => ({
        entries: [
          createStoredFeedEntry({
            authorHandle: ' ada ',
            excerpt: '  Trying out a new eval harness...  ',
            media: [
              {
                kind: 'image',
                thumbUrl: 'https://cdn.example.com/thumb.png',
              },
              null,
              'invalid-media-entry',
              {
                kind: '',
                thumbUrl: 'https://cdn.example.com/ignored.png',
              },
            ] as unknown as StoredFeedDocument['media'],
            counters: {
              likes: 4,
              replies: Number.NaN,
            },
          }),
          createStoredFeedEntry({
            id: '',
            postId: 'post-2',
          }),
        ],
        cursor: 'next-page-token',
      })),
    } satisfies FeedStore

    const result = await lookupFeed(
      {
        feedOwnerId: ' user-1 ',
        cursor: ' opaque-token ',
      },
      store,
    )

    expect(store.listFeedEntries).toHaveBeenCalledWith('user-1', {
      limit: DEFAULT_FEED_PAGE_SIZE,
      cursor: 'opaque-token',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: [
          {
            id: 'f_user-1_post-1',
            postId: 'post-1',
            authorId: 'user-2',
            authorHandle: 'ada',
            authorDisplayName: 'Ada Lovelace',
            authorAvatarUrl: 'https://cdn.example.com/ada.png',
            excerpt: 'Trying out a new eval harness...',
            media: [
              {
                kind: 'image',
                thumbUrl: 'https://cdn.example.com/thumb.png',
              },
              {
                kind: null,
                thumbUrl: 'https://cdn.example.com/ignored.png',
              },
            ],
            counters: {
              likes: 4,
              replies: 0,
            },
            createdAt: '2026-04-15T09:00:00.000Z',
          },
        ],
        cursor: 'next-page-token',
        errors: [],
      },
    })
  })

  it('returns a validation error when the authenticated user id is missing', async () => {
    const result = await lookupFeed(
      {
        feedOwnerId: '   ',
      },
      createStore({
        entries: [],
      }),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        cursor: null,
        errors: [
          {
            code: 'invalid_feed_owner_id',
            message: 'The authenticated user id is required to load a feed.',
            field: 'feedOwnerId',
          },
        ],
      },
    })
  })

  it('skips malformed media collections without failing the feed lookup', async () => {
    const result = await lookupFeed(
      {
        feedOwnerId: 'user-1',
      },
      createStore({
        entries: [
          createStoredFeedEntry({
            media: 'not-an-array' as unknown as StoredFeedDocument['media'],
          }),
        ],
      }),
    )

    expect(result).toEqual({
      status: 200,
      body: {
        data: [
          {
            id: 'f_user-1_post-1',
            postId: 'post-1',
            authorId: 'user-2',
            authorHandle: 'ada',
            authorDisplayName: 'Ada Lovelace',
            authorAvatarUrl: 'https://cdn.example.com/ada.png',
            excerpt: 'Trying out a new eval harness...',
            media: [],
            counters: {
              likes: 4,
              replies: 3,
            },
            createdAt: '2026-04-15T09:00:00.000Z',
          },
        ],
        cursor: null,
        errors: [],
      },
    })
  })

  it('merges pull-on-read celebrity entries with the materialized feed and drops duplicates', async () => {
    const result = await lookupFeed(
      {
        feedOwnerId: 'user-1',
      },
      createMergedStore({
        feedEntries: [
          createStoredFeedEntry({
            id: 'user-1:post-2',
            postId: 'post-2',
            createdAt: '2026-04-15T10:00:00.000Z',
            excerpt: 'Materialized celebrity post',
          }),
          createStoredFeedEntry({
            id: 'user-1:post-1',
            postId: 'post-1',
            createdAt: '2026-04-15T09:00:00.000Z',
            excerpt: 'Materialized non-celebrity post',
          }),
        ],
        pullEntries: [
          createStoredFeedEntry({
            id: 'user-1:post-3',
            postId: 'post-3',
            createdAt: '2026-04-15T11:00:00.000Z',
            excerpt: 'Pull-on-read celebrity post',
          }),
          createStoredFeedEntry({
            id: 'user-1:post-2',
            postId: 'post-2',
            createdAt: '2026-04-15T10:00:00.000Z',
            excerpt: 'Duplicate celebrity post',
          }),
        ],
      }),
    )

    expect(result).toEqual({
      status: 200,
      body: {
        data: [
          expect.objectContaining({
            id: 'user-1:post-3',
            postId: 'post-3',
            excerpt: 'Pull-on-read celebrity post',
            createdAt: '2026-04-15T11:00:00.000Z',
          }),
          expect.objectContaining({
            id: 'user-1:post-2',
            postId: 'post-2',
            excerpt: 'Materialized celebrity post',
            createdAt: '2026-04-15T10:00:00.000Z',
          }),
          expect.objectContaining({
            id: 'user-1:post-1',
            postId: 'post-1',
            excerpt: 'Materialized non-celebrity post',
            createdAt: '2026-04-15T09:00:00.000Z',
          }),
        ],
        cursor: null,
        errors: [],
      },
    })
  })

  it('uses an opaque cursor to page merged materialized and pull-on-read results', async () => {
    const combinedEntries = Array.from({ length: 24 }, (_, index) =>
      createStoredFeedEntry({
        id: `user-1:post-${index + 1}`,
        postId: `post-${index + 1}`,
        excerpt: `Post ${index + 1}`,
        createdAt: `2026-04-15T${String(23 - index).padStart(2, '0')}:00:00.000Z`,
      }),
    )
    const feedEntries = combinedEntries.filter((_, index) => index % 2 === 0)
    const pullEntries = combinedEntries.filter((_, index) => index % 2 === 1)
    const store = createPagedMergedStore({
      feedPages: {
        __start__: {
          entries: feedEntries,
        },
      },
      pullPages: {
        __start__: {
          entries: pullEntries,
        },
      },
    })

    const firstPage = await lookupFeed(
      {
        feedOwnerId: 'user-1',
      },
      store,
    )

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.data).not.toBeNull()
    expect(firstPage.body.data ?? []).toHaveLength(DEFAULT_FEED_PAGE_SIZE)
    expect((firstPage.body.data ?? []).map((entry) => entry.postId)).toEqual(
      combinedEntries
        .slice(0, DEFAULT_FEED_PAGE_SIZE)
        .map((entry) => entry.postId),
    )
    expect(firstPage.body.cursor).toMatch(/^ac\.feed\.v1:/)

    const secondPage = await lookupFeed(
      {
        feedOwnerId: 'user-1',
        cursor: firstPage.body.cursor ?? undefined,
      },
      store,
    )

    expect(secondPage).toEqual({
      status: 200,
      body: {
        data: combinedEntries.slice(DEFAULT_FEED_PAGE_SIZE).map((entry) => ({
          id: entry.id,
          postId: entry.postId,
          authorId: entry.authorId,
          authorHandle: entry.authorHandle,
          authorDisplayName: entry.authorDisplayName,
          authorAvatarUrl: entry.authorAvatarUrl,
          excerpt: entry.excerpt,
          media: [
            {
              kind: 'image',
              thumbUrl: 'https://cdn.example.com/thumb.png',
            },
          ],
          counters: {
            likes: 4,
            replies: 3,
          },
          createdAt: entry.createdAt,
        })),
        cursor: null,
        errors: [],
      },
    })
  })
})

describe('getFeedHandler', () => {
  it('reads the authenticated feed and returns the JSON envelope', async () => {
    const store = {
      listFeedEntries: vi.fn(async () => ({
        entries: [createStoredFeedEntry()],
        cursor: 'next-page-token',
      })),
    } satisfies FeedStore
    const handler = buildGetFeedHandler({
      storeFactory: () => store,
    })

    const response = await handler(
      createRequest('cursor=opaque-token'),
      createContext(),
    )

    expect(store.listFeedEntries).toHaveBeenCalledWith('github:abc123', {
      limit: DEFAULT_FEED_PAGE_SIZE,
      cursor: 'opaque-token',
    })
    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: [
        {
          id: 'f_user-1_post-1',
          postId: 'post-1',
          authorId: 'user-2',
          authorHandle: 'ada',
          authorDisplayName: 'Ada Lovelace',
          authorAvatarUrl: 'https://cdn.example.com/ada.png',
          excerpt: 'Trying out a new eval harness...',
          media: [
            {
              kind: 'image',
              thumbUrl: 'https://cdn.example.com/thumb.png',
            },
          ],
          counters: {
            likes: 4,
            replies: 3,
          },
          createdAt: '2026-04-15T09:00:00.000Z',
        },
      ],
      cursor: 'next-page-token',
      errors: [],
    })
  })

  it('rejects requests without an authenticated profile in context', async () => {
    const handler = buildGetFeedHandler({
      storeFactory: () =>
        createStore({
          entries: [],
        }),
    })

    const response = await handler(createRequest(), createContext(null))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have a provisioned profile before reading a feed.',
        },
      ],
    })
  })

  it('returns a configuration error when the feed store cannot be created', async () => {
    const handler = buildGetFeedHandler({
      storeFactory: () => {
        throw new Error('Missing feed store configuration')
      },
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The feed store is not configured.',
        },
      ],
    })
  })

  it('returns a server error when the lookup fails', async () => {
    const handler = buildGetFeedHandler({
      storeFactory: () => ({
        listFeedEntries: async () => {
          throw new Error('Cosmos unavailable')
        },
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      cursor: null,
      errors: [
        {
          code: 'server.feed_lookup_failed',
          message: "Unable to load the authenticated user's feed.",
        },
      ],
    })
  })
})
