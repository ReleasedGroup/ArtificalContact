import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetThreadHandler } from '../src/functions/get-thread.js'
import {
  DEFAULT_THREAD_PAGE_SIZE,
  lookupThread,
  type StoredPostDocument,
  type ThreadStore,
} from '../src/lib/thread.js'

function createStoredPost(overrides: Partial<StoredPostDocument> = {}): StoredPostDocument {
  return {
    id: 'thread-1',
    type: 'post',
    kind: 'user',
    threadId: 'thread-1',
    parentId: null,
    authorId: 'user-1',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Root post',
    hashtags: ['ai'],
    mentions: ['user-2'],
    media: [
      {
        id: 'media-1',
        kind: 'image',
        url: 'https://cdn.example.com/root.png',
        thumbUrl: 'https://cdn.example.com/root-thumb.png',
        width: 1280,
        height: 720,
      },
    ],
    counters: {
      likes: 2,
      dislikes: 0,
      emoji: 1,
      replies: 3,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createThreadStore(result: {
  posts: StoredPostDocument[]
  continuationToken?: string
}) {
  return {
    listThreadPosts: vi.fn(async () => result),
  } satisfies ThreadStore
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('lookupThread', () => {
  it('returns the normalized first page of a thread', async () => {
    const store = createThreadStore({
      posts: [
        createStoredPost(),
        createStoredPost({
          id: 'reply-1',
          type: 'reply',
          threadId: 'thread-1',
          parentId: 'thread-1',
          authorId: 'user-2',
          authorHandle: 'grace',
          authorDisplayName: 'Grace Hopper',
          authorAvatarUrl: 'https://cdn.example.com/grace.png',
          text: 'Reply post',
          hashtags: ['threading', ' ', null as never],
          mentions: ['user-1', '', null as never],
          media: [
            {
              id: 'media-2',
              kind: 'image',
              url: 'https://cdn.example.com/reply.png',
              thumbUrl: '',
              width: 640,
              height: 480,
            },
            {
              id: '',
              kind: 'image',
              url: 'https://cdn.example.com/ignored.png',
            },
          ],
          counters: {
            likes: 4,
            dislikes: -1,
            emoji: 2,
            replies: 0,
          },
          github: {
            repoId: 'repo-1',
            owner: 'ReleasedGroup',
            name: 'ArtificalContact',
            eventType: 'issue',
            eventId: '123',
            number: 41,
            tag: null,
            state: 'open',
            actorLogin: 'nickbeau',
            actorAvatarUrl: 'https://avatars.example.com/nick.png',
            url: 'https://github.com/ReleasedGroup/ArtificalContact/issues/41',
            bodyExcerpt: 'Thread work',
            labels: ['api', 'threads', '', null as never],
            githubCreatedAt: '2026-04-15T00:00:00.000Z',
            githubUpdatedAt: '2026-04-15T00:05:00.000Z',
          },
        }),
      ],
      continuationToken: 'next-page-token',
    })

    const result = await lookupThread(
      {
        threadId: ' thread-1 ',
        limit: '2',
      },
      store,
    )

    expect(store.listThreadPosts).toHaveBeenCalledWith('thread-1', {
      limit: 2,
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          threadId: 'thread-1',
          posts: [
            {
              id: 'thread-1',
              type: 'post',
              kind: 'user',
              threadId: 'thread-1',
              parentId: null,
              authorId: 'user-1',
              authorHandle: 'ada',
              authorDisplayName: 'Ada Lovelace',
              authorAvatarUrl: 'https://cdn.example.com/ada.png',
              text: 'Root post',
              hashtags: ['ai'],
              mentions: ['user-2'],
              media: [
                {
                  id: 'media-1',
                  kind: 'image',
                  url: 'https://cdn.example.com/root.png',
                  thumbUrl: 'https://cdn.example.com/root-thumb.png',
                  width: 1280,
                  height: 720,
                },
              ],
              counters: {
                likes: 2,
                dislikes: 0,
                emoji: 1,
                replies: 3,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
            },
            {
              id: 'reply-1',
              type: 'reply',
              kind: 'user',
              threadId: 'thread-1',
              parentId: 'thread-1',
              authorId: 'user-2',
              authorHandle: 'grace',
              authorDisplayName: 'Grace Hopper',
              authorAvatarUrl: 'https://cdn.example.com/grace.png',
              text: 'Reply post',
              hashtags: ['threading'],
              mentions: ['user-1'],
              media: [
                {
                  id: 'media-2',
                  kind: 'image',
                  url: 'https://cdn.example.com/reply.png',
                  thumbUrl: null,
                  width: 640,
                  height: 480,
                },
              ],
              counters: {
                likes: 4,
                dislikes: 0,
                emoji: 2,
                replies: 0,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
              github: {
                repoId: 'repo-1',
                owner: 'ReleasedGroup',
                name: 'ArtificalContact',
                eventType: 'issue',
                eventId: '123',
                number: 41,
                tag: null,
                state: 'open',
                actorLogin: 'nickbeau',
                actorAvatarUrl: 'https://avatars.example.com/nick.png',
                url: 'https://github.com/ReleasedGroup/ArtificalContact/issues/41',
                bodyExcerpt: 'Thread work',
                labels: ['api', 'threads'],
                githubCreatedAt: '2026-04-15T00:00:00.000Z',
                githubUpdatedAt: '2026-04-15T00:05:00.000Z',
              },
            },
          ],
          continuationToken: 'next-page-token',
        },
        errors: [],
      },
    })
  })

  it('uses the default page size and allows empty continuation pages', async () => {
    const store = createThreadStore({
      posts: [],
    })

    const result = await lookupThread(
      {
        threadId: 'thread-1',
        continuationToken: 'opaque-token',
      },
      store,
    )

    expect(store.listThreadPosts).toHaveBeenCalledWith('thread-1', {
      limit: DEFAULT_THREAD_PAGE_SIZE,
      continuationToken: 'opaque-token',
    })
    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          threadId: 'thread-1',
          posts: [],
          continuationToken: null,
        },
        errors: [],
      },
    })
  })

  it('returns a validation error when the thread id is missing', async () => {
    const result = await lookupThread(
      {
        threadId: '  ',
      },
      createThreadStore({
        posts: [],
      }),
    )

    expect(result).toEqual({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_thread_id',
            message: 'The threadId path parameter is required.',
            field: 'threadId',
          },
        ],
      },
    })
  })

  it('returns a validation error when the limit is invalid', async () => {
    const result = await lookupThread(
      {
        threadId: 'thread-1',
        limit: '500',
      },
      createThreadStore({
        posts: [],
      }),
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_limit',
          message: 'The limit query parameter must be an integer between 1 and 100.',
          field: 'limit',
        },
      ],
    })
  })

  it('returns not found when the first page has no root post', async () => {
    const result = await lookupThread(
      {
        threadId: 'thread-1',
      },
      createThreadStore({
        posts: [
          createStoredPost({
            id: 'reply-1',
            type: 'reply',
            threadId: 'thread-1',
            parentId: 'thread-1',
          }),
        ],
      }),
    )

    expect(result.status).toBe(404)
    expect(result.body).toEqual({
      data: null,
      errors: [
        {
          code: 'thread_not_found',
          message: 'No public thread exists for the requested thread id.',
          field: 'threadId',
        },
      ],
    })
  })
})

describe('getThreadHandler', () => {
  it('returns an HTTP response with the thread envelope and headers', async () => {
    const store = createThreadStore({
      posts: [createStoredPost()],
      continuationToken: 'next-page-token',
    })
    const handler = buildGetThreadHandler(() => store)
    const context = createContext()

    const response = await handler(
      {
        params: { threadId: 'thread-1' },
        query: new URLSearchParams('limit=10&continuationToken=opaque-token'),
      } as unknown as HttpRequest,
      context,
    )

    expect(store.listThreadPosts).toHaveBeenCalledWith('thread-1', {
      limit: 10,
      continuationToken: 'opaque-token',
    })
    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        threadId: 'thread-1',
        posts: [
          {
            id: 'thread-1',
            type: 'post',
            kind: 'user',
            threadId: 'thread-1',
            parentId: null,
            authorId: 'user-1',
            authorHandle: 'ada',
            authorDisplayName: 'Ada Lovelace',
            authorAvatarUrl: 'https://cdn.example.com/ada.png',
            text: 'Root post',
            hashtags: ['ai'],
            mentions: ['user-2'],
            media: [
              {
                id: 'media-1',
                kind: 'image',
                url: 'https://cdn.example.com/root.png',
                thumbUrl: 'https://cdn.example.com/root-thumb.png',
                width: 1280,
                height: 720,
              },
            ],
            counters: {
              likes: 2,
              dislikes: 0,
              emoji: 1,
              replies: 3,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T01:00:00.000Z',
          },
        ],
        continuationToken: 'next-page-token',
      },
      errors: [],
    })
  })

  it('returns a predictable 500 response when the store is not configured', async () => {
    const handler = buildGetThreadHandler(() => {
      throw new Error('Missing Cosmos configuration')
    })

    const response = await handler(
      {
        params: { threadId: 'thread-1' },
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
          message: 'The thread store is not configured.',
        },
      ],
    })
  })
})
