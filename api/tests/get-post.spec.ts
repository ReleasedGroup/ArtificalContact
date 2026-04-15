import type { Container } from '@azure/cosmos'
import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildGetPostHandler } from '../src/functions/get-post.js'
import { CosmosPostStore } from '../src/lib/cosmos-post-store.js'
import {
  lookupPublicPost,
  type PostStore,
  type StoredPostDocument,
} from '../src/lib/posts.js'

class InMemoryPostStore implements PostStore {
  constructor(private readonly posts = new Map<string, StoredPostDocument>()) {}

  async getPostById(postId: string): Promise<StoredPostDocument | null> {
    return this.posts.get(postId) ?? null
  }
}

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'p_01HXYZ',
    type: 'post',
    kind: 'user',
    threadId: 'p_01HXYZ',
    parentId: null,
    authorId: 'u_01HXYZ',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Trying out a new eval harness...',
    hashtags: ['evals', 'llm'],
    mentions: ['u_grace'],
    media: [
      {
        id: 'm_01',
        kind: 'image',
        url: 'https://cdn.example.com/post.png',
        thumbUrl: 'https://cdn.example.com/post-thumb.png',
        width: 1280,
        height: 720,
      },
    ],
    counters: {
      likes: 4,
      dislikes: 1,
      emoji: 2,
      replies: 3,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createStore(posts: StoredPostDocument[] = []) {
  return new InMemoryPostStore(new Map(posts.map((post) => [post.id, post])))
}

function createContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createNotFoundError() {
  const error = new Error('Not found') as Error & { statusCode: number }
  error.statusCode = 404
  return error
}

describe('lookupPublicPost', () => {
  it('returns a public post with normalized defaults', async () => {
    const result = await lookupPublicPost(
      '  p_01HXYZ  ',
      createStore([
        createStoredPost({
          hashtags: [' evals ', ''],
          mentions: [' u_grace ', ''],
          counters: {
            likes: 4,
            dislikes: null,
            emoji: Number.NaN,
            replies: 3,
          },
          github: null,
        }),
      ]),
    )

    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          id: 'p_01HXYZ',
          type: 'post',
          kind: 'user',
          threadId: 'p_01HXYZ',
          parentId: null,
          authorId: 'u_01HXYZ',
          authorHandle: 'ada',
          authorDisplayName: 'Ada Lovelace',
          authorAvatarUrl: 'https://cdn.example.com/ada.png',
          text: 'Trying out a new eval harness...',
          hashtags: ['evals'],
          mentions: ['u_grace'],
          media: [
            {
              id: 'm_01',
              kind: 'image',
              url: 'https://cdn.example.com/post.png',
              thumbUrl: 'https://cdn.example.com/post-thumb.png',
              width: 1280,
              height: 720,
            },
          ],
          counters: {
            likes: 4,
            dislikes: 0,
            emoji: 0,
            replies: 3,
          },
          visibility: 'public',
          createdAt: '2026-04-15T09:00:00.000Z',
          updatedAt: '2026-04-15T10:00:00.000Z',
          github: null,
        },
        errors: [],
      },
    })
  })

  it('returns github metadata for a github-sourced post', async () => {
    const result = await lookupPublicPost(
      'gh_repo_issue_42',
      createStore([
        createStoredPost({
          id: 'gh_repo_issue_42',
          kind: 'github',
          authorId: 'sys_github_repo',
          authorHandle: 'github/openai-cookbook',
          github: {
            repoId: 'r_01',
            owner: 'openai',
            name: 'openai-cookbook',
            eventType: 'issue',
            eventId: 2293847562,
            number: '42',
            state: 'open',
            labels: ['enhancement', ' good first issue '],
            url: 'https://github.com/openai/openai-cookbook/issues/42',
          },
        }),
      ]),
    )

    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({
      id: 'gh_repo_issue_42',
      kind: 'github',
      github: {
        repoId: 'r_01',
        owner: 'openai',
        name: 'openai-cookbook',
        eventType: 'issue',
        eventId: '2293847562',
        number: 42,
        state: 'open',
        labels: ['enhancement', 'good first issue'],
        url: 'https://github.com/openai/openai-cookbook/issues/42',
      },
    })
  })

  it('returns not found for hidden, non-public, or deleted posts', async () => {
    const hiddenResult = await lookupPublicPost(
      'hidden-post',
      createStore([
        createStoredPost({
          id: 'hidden-post',
          moderationState: 'hidden',
        }),
      ]),
    )
    const privateResult = await lookupPublicPost(
      'private-post',
      createStore([
        createStoredPost({
          id: 'private-post',
          visibility: 'followers',
        }),
      ]),
    )
    const deletedResult = await lookupPublicPost(
      'deleted-post',
      createStore([
        createStoredPost({
          id: 'deleted-post',
          deletedAt: '2026-04-15T11:00:00.000Z',
        }),
      ]),
    )

    for (const result of [hiddenResult, privateResult, deletedResult]) {
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
    }
  })

  it('returns a validation error when the route parameter is missing', async () => {
    const result = await lookupPublicPost(undefined, createStore())

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
})

describe('getPostHandler', () => {
  it('returns the JSON envelope and default headers', async () => {
    const handler = buildGetPostHandler(() => createStore([createStoredPost()]))
    const context = createContext()

    const response = await handler(
      {
        params: { id: 'p_01HXYZ' },
      } as unknown as HttpRequest,
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toMatchObject({
      data: {
        id: 'p_01HXYZ',
        kind: 'user',
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Public post lookup completed.', {
      postId: 'p_01HXYZ',
      status: 200,
    })
  })

  it('returns a server error when the store configuration fails', async () => {
    const context = createContext()
    const handler = buildGetPostHandler(() => {
      throw new Error('Missing Cosmos config')
    })

    const response = await handler(
      {
        params: { id: 'p_01HXYZ' },
      } as unknown as HttpRequest,
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
      'Failed to configure the post store.',
      {
        error: 'Missing Cosmos config',
      },
    )
  })
})

describe('CosmosPostStore', () => {
  it('uses a point read when the thread id is known', async () => {
    const read = vi.fn(async () => ({
      resource: createStoredPost(),
    }))
    const query = vi.fn()
    const container = {
      item: vi.fn(() => ({
        read,
      })),
      items: {
        query,
      },
    } as unknown as Container
    const store = new CosmosPostStore(container)

    const result = await store.getPostById('p_01HXYZ', 'p_01HXYZ')

    expect(result?.id).toBe('p_01HXYZ')
    expect(container.item).toHaveBeenCalledWith('p_01HXYZ', 'p_01HXYZ')
    expect(query).not.toHaveBeenCalled()
  })

  it('falls back to a cross-partition query when a point read misses', async () => {
    const read = vi.fn(async () => {
      throw createNotFoundError()
    })
    const fetchAll = vi.fn(async () => ({
      resources: [
        createStoredPost({
          id: 'reply_01',
          threadId: 'thread_01',
          parentId: 'p_01HXYZ',
          type: 'reply',
        }),
      ],
    }))
    const query = vi.fn(
      () =>
        ({
          fetchAll,
        }) as { fetchAll: typeof fetchAll },
    )
    const container = {
      item: vi.fn(() => ({
        read,
      })),
      items: {
        query,
      },
    } as unknown as Container
    const store = new CosmosPostStore(container)

    const result = await store.getPostById('reply_01', 'wrong_thread')

    expect(result?.id).toBe('reply_01')
    expect(query).toHaveBeenCalledWith(
      {
        query: 'SELECT TOP 1 * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: 'reply_01' }],
      },
      {
        maxItemCount: 1,
      },
    )
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  it('queries authored user posts by author id for denormalization refreshes', async () => {
    const fetchAll = vi.fn(async () => ({
      resources: [
        createStoredPost({
          id: 'p_02',
          authorId: 'u_author',
        }),
      ],
    }))
    const query = vi.fn(
      () =>
        ({
          fetchAll,
        }) as { fetchAll: typeof fetchAll },
    )
    const container = {
      item: vi.fn(),
      items: {
        query,
      },
    } as unknown as Container
    const store = new CosmosPostStore(container)

    const result = await store.listPostsByAuthorId('u_author')

    expect(result).toEqual([
      createStoredPost({
        id: 'p_02',
        authorId: 'u_author',
      }),
    ])
    expect(query).toHaveBeenCalledWith({
      query:
        'SELECT * FROM c WHERE c.authorId = @authorId AND c.kind = @kind ORDER BY c.createdAt ASC',
      parameters: [
        { name: '@authorId', value: 'u_author' },
        { name: '@kind', value: 'user' },
      ],
    })
    expect(fetchAll).toHaveBeenCalledOnce()
  })
})
