import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildDeletePostHandler } from '../src/functions/delete-post.js'
import { CLIENT_PRINCIPAL_HEADER } from '../src/lib/auth.js'
import {
  softDeletePost,
  type MutablePostStore,
  type StoredPostDocument,
} from '../src/lib/posts.js'
import type {
  RateLimitConsumeResult,
  RateLimitRepository,
} from '../src/lib/rate-limit.js'
import type { UserDocument, UserRepository } from '../src/lib/users.js'

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

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'p_01HXYZ',
    type: 'post',
    kind: 'user',
    threadId: 'p_01HXYZ',
    parentId: null,
    authorId: 'github:abc123',
    authorHandle: 'nick',
    authorDisplayName: 'Nick Beaugeard',
    authorAvatarUrl: 'https://cdn.example.com/nick.png',
    text: 'Trying out a new eval harness...',
    hashtags: ['evals', 'llm'],
    mentions: ['github:def456'],
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

function createAuthenticatedPrincipal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identityProvider: 'github',
    userId: 'abc123',
    userDetails: 'nickbeau',
    userRoles: ['authenticated', 'user'],
    claims: [],
    ...overrides,
  }
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
    links: {},
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

function createRepository(user: UserDocument | null): UserRepository {
  return {
    create: async (createdUser) => createdUser,
    getById: vi.fn(async () => user),
    upsert: async (updatedUser) => updatedUser,
  }
}

function createPermissiveRateLimitRepository(): RateLimitRepository {
  return {
    consumeToken: vi.fn(async (): Promise<RateLimitConsumeResult> => ({
      allowed: true,
      remainingTokens: 5,
      retryAfterSeconds: 0,
    })),
  }
}

function createRequest(
  postId: string | undefined,
  principal?: Record<string, unknown>,
): HttpRequest {
  const encodedPrincipal = principal
    ? Buffer.from(JSON.stringify(principal)).toString('base64')
    : null

  return {
    params: postId === undefined ? {} : { id: postId },
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

describe('softDeletePost', () => {
  it('soft-deletes an author-owned post and clears the stored body fields', async () => {
    const store = new InMemoryMutablePostStore(
      new Map([
        [
          'p_01HXYZ',
          createStoredPost({
            github: {
              repoId: 'r_01',
              bodyExcerpt: 'Original issue body',
            },
          }),
        ],
      ]),
    )

    const result = await softDeletePost(
      'p_01HXYZ',
      {
        userId: 'github:abc123',
        roles: ['user'],
      },
      store,
      () => new Date('2026-04-15T11:30:00.000Z'),
    )

    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          id: 'p_01HXYZ',
          threadId: 'p_01HXYZ',
          deletedAt: '2026-04-15T11:30:00.000Z',
          alreadyDeleted: false,
        },
        errors: [],
      },
    })
    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]).toMatchObject({
      id: 'p_01HXYZ',
      text: null,
      updatedAt: '2026-04-15T11:30:00.000Z',
      deletedAt: '2026-04-15T11:30:00.000Z',
      github: {
        repoId: 'r_01',
        bodyExcerpt: null,
      },
    })
  })

  it('allows a moderator to delete another users post', async () => {
    const store = new InMemoryMutablePostStore(
      new Map([
        [
          'p_01HXYZ',
          createStoredPost({
            authorId: 'github:someone-else',
          }),
        ],
      ]),
    )

    const result = await softDeletePost(
      'p_01HXYZ',
      {
        userId: 'github:abc123',
        roles: ['USER', ' moderator '],
      },
      store,
      () => new Date('2026-04-15T11:30:00.000Z'),
    )

    expect(result.status).toBe(200)
    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]!.deletedAt).toBe('2026-04-15T11:30:00.000Z')
  })

  it('returns forbidden when a non-author non-moderator attempts a delete', async () => {
    const store = new InMemoryMutablePostStore(
      new Map([
        [
          'p_01HXYZ',
          createStoredPost({
            authorId: 'github:someone-else',
          }),
        ],
      ]),
    )

    const result = await softDeletePost(
      'p_01HXYZ',
      {
        userId: 'github:abc123',
        roles: ['user'],
      },
      store,
    )

    expect(result).toEqual({
      status: 403,
      body: {
        data: null,
        errors: [
          {
            code: 'post_delete_forbidden',
            message: 'Only the author or a moderator can delete this post.',
          },
        ],
      },
    })
    expect(store.upsertedPosts).toHaveLength(0)
  })

  it('returns validation and not-found errors before mutating storage', async () => {
    const store = new InMemoryMutablePostStore()

    const invalidResult = await softDeletePost(
      undefined,
      {
        userId: 'github:abc123',
        roles: ['user'],
      },
      store,
    )
    const notFoundResult = await softDeletePost(
      'missing-post',
      {
        userId: 'github:abc123',
        roles: ['user'],
      },
      store,
    )

    expect(invalidResult).toEqual({
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
    expect(notFoundResult).toEqual({
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No post exists for the requested id.',
            field: 'id',
          },
        ],
      },
    })
    expect(store.upsertedPosts).toHaveLength(0)
  })

  it('treats repeated deletes as a successful no-op', async () => {
    const store = new InMemoryMutablePostStore(
      new Map([
        [
          'p_01HXYZ',
          createStoredPost({
            deletedAt: '2026-04-15T11:30:00.000Z',
            text: null,
          }),
        ],
      ]),
    )

    const result = await softDeletePost(
      'p_01HXYZ',
      {
        userId: 'github:abc123',
        roles: ['user'],
      },
      store,
      () => new Date('2026-04-15T12:00:00.000Z'),
    )

    expect(result).toEqual({
      status: 200,
      body: {
        data: {
          id: 'p_01HXYZ',
          threadId: 'p_01HXYZ',
          deletedAt: '2026-04-15T11:30:00.000Z',
          alreadyDeleted: true,
        },
        errors: [],
      },
    })
    expect(store.upsertedPosts).toHaveLength(0)
  })
})

describe('deletePostHandler', () => {
  it('returns the JSON envelope for an authenticated delete request', async () => {
    const store = new InMemoryMutablePostStore(
      new Map([['p_01HXYZ', createStoredPost()]]),
    )
    const context = createContext()
    const handler = buildDeletePostHandler({
      now: () => new Date('2026-04-15T11:30:00.000Z'),
      rateLimitRepositoryFactory: () => createPermissiveRateLimitRepository(),
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => store,
    })

    const response = await handler(
      createRequest('p_01HXYZ', createAuthenticatedPrincipal()),
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.jsonBody).toEqual({
      data: {
        id: 'p_01HXYZ',
        threadId: 'p_01HXYZ',
        deletedAt: '2026-04-15T11:30:00.000Z',
        alreadyDeleted: false,
      },
      errors: [],
    })
    expect(context.log).toHaveBeenCalledWith('Delete post request completed.', {
      actorUserId: 'github:abc123',
      alreadyDeleted: false,
      postId: 'p_01HXYZ',
      status: 200,
    })
  })

  it('returns a store configuration error before attempting authz work', async () => {
    const context = createContext()
    const handler = buildDeletePostHandler({
      rateLimitRepositoryFactory: () => createPermissiveRateLimitRepository(),
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () => {
        throw new Error('Missing Cosmos config')
      },
    })

    const response = await handler(
      createRequest('p_01HXYZ', createAuthenticatedPrincipal()),
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

  it('requires authentication before deleting a post', async () => {
    const handler = buildDeletePostHandler({
      rateLimitRepositoryFactory: () => createPermissiveRateLimitRepository(),
      repositoryFactory: () => createRepository(createStoredUser()),
      storeFactory: () =>
        new InMemoryMutablePostStore(new Map([['p_01HXYZ', createStoredPost()]])),
    })

    const response = await handler(createRequest('p_01HXYZ'), createContext())

    expect(response.status).toBe(401)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.missing_principal',
          message: 'Authentication is required.',
        },
      ],
    })
  })
})
