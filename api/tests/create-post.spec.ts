import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCreatePostHandler } from '../src/functions/create-post.js'
import {
  DEFAULT_POST_MAX_LENGTH,
  resolvePostMaxLength,
  type PostDocument,
  type PostRepository,
} from '../src/lib/posts.js'
import type { UserDocument } from '../src/lib/users.js'

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

describe('resolvePostMaxLength', () => {
  it('uses the sprint default when the environment is unset', () => {
    expect(resolvePostMaxLength({})).toBe(DEFAULT_POST_MAX_LENGTH)
  })

  it('accepts a configured positive integer', () => {
    expect(resolvePostMaxLength({ POST_MAX_LENGTH: '500' })).toBe(500)
  })

  it('rejects a non-positive configured value', () => {
    expect(() => resolvePostMaxLength({ POST_MAX_LENGTH: '0' })).toThrowError(
      'POST_MAX_LENGTH must be a positive integer.',
    )
  })
})

describe('createPostHandler', () => {
  it('creates a root post with denormalized author fields and parsed tags', async () => {
    const repository: PostRepository = {
      create: vi.fn(async (post) => post),
    }
    const handler = buildCreatePostHandler({
      idFactory: () => 'p_test',
      maxTextLength: 280,
      now: () => new Date('2026-04-15T04:00:00.000Z'),
      repositoryFactory: () => repository,
    })

    const response = await handler(
      createRequest({
        text: '  Shipping #Azure with @Ada today. Contact ada@example.com and revisit #azure.  ',
      }),
      createContext(),
    )

    expect(response.status).toBe(201)
    expect(repository.create).toHaveBeenCalledWith({
      id: 'p_test',
      type: 'post',
      kind: 'user',
      threadId: 'p_test',
      parentId: null,
      authorId: 'github:abc123',
      authorHandle: 'nick',
      authorDisplayName: 'Nick Beaugeard',
      authorAvatarUrl: 'https://cdn.example.com/nick.png',
      text: 'Shipping #Azure with @Ada today. Contact ada@example.com and revisit #azure.',
      hashtags: ['azure'],
      mentions: ['ada'],
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
    } satisfies PostDocument)
    expect(response.jsonBody).toEqual({
      data: {
        post: {
          id: 'p_test',
          type: 'post',
          kind: 'user',
          threadId: 'p_test',
          parentId: null,
          authorId: 'github:abc123',
          authorHandle: 'nick',
          authorDisplayName: 'Nick Beaugeard',
          authorAvatarUrl: 'https://cdn.example.com/nick.png',
          text: 'Shipping #Azure with @Ada today. Contact ada@example.com and revisit #azure.',
          hashtags: ['azure'],
          mentions: ['ada'],
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
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const handler = buildCreatePostHandler({
      repositoryFactory: () => ({
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

  it('returns validation errors when the post text is too long', async () => {
    const handler = buildCreatePostHandler({
      maxTextLength: 5,
      repositoryFactory: () => ({
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

  it('rejects users who do not have an active profile with a handle', async () => {
    const repository: PostRepository = {
      create: vi.fn(async (post) => post),
    }
    const handler = buildCreatePostHandler({
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
            'The authenticated user must have an active profile before creating posts.',
        },
      ],
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('returns 500 when the post repository is not configured', async () => {
    const context = createContext()
    const handler = buildCreatePostHandler({
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

  it('returns 500 when the post write fails', async () => {
    const context = createContext()
    const handler = buildCreatePostHandler({
      repositoryFactory: () => ({
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
          code: 'server.post_create_failed',
          message: 'Unable to create the post.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith('Failed to create the root post.', {
      error: 'Cosmos unavailable',
      authorId: 'github:abc123',
    })
  })
})
