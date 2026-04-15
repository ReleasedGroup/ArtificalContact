import { describe, expect, it, vi } from 'vitest'
import {
  syncUserPostAuthorDenormalizationsBatch,
  nullLogger,
  type UserPostAuthorSyncStore,
} from '../src/lib/user-post-author-sync.js'
import type { StoredPostDocument } from '../src/lib/posts.js'
import type { UserDocument } from '../src/lib/users.js'

class InMemoryUserPostAuthorSyncStore implements UserPostAuthorSyncStore {
  public readonly upsertedPosts: StoredPostDocument[] = []

  constructor(private readonly posts: StoredPostDocument[] = []) {}

  async listPostsByAuthorId(authorId: string): Promise<StoredPostDocument[]> {
    return this.posts
      .filter(
        (post) =>
          post.authorId === authorId && (post.kind ?? 'user') === 'user',
      )
      .map((post) => ({ ...post }))
  }

  async upsertPost(post: StoredPostDocument): Promise<StoredPostDocument> {
    this.upsertedPosts.push(post)
    return post
  }
}

function createUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'u_ada',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'ada',
    email: 'ada@example.com',
    emailLower: 'ada@example.com',
    handle: 'ada',
    handleLower: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Building analytical engines.',
    avatarUrl: 'https://cdn.example.com/ada.png',
    expertise: ['math'],
    links: {},
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 2,
      followers: 10,
      following: 4,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'p_01',
    type: 'post',
    kind: 'user',
    threadId: 'p_01',
    parentId: null,
    authorId: 'u_ada',
    authorHandle: 'ada-old',
    authorDisplayName: 'Ada Old',
    authorAvatarUrl: 'https://cdn.example.com/ada-old.png',
    text: 'Original post',
    hashtags: [],
    mentions: [],
    counters: {
      likes: 0,
      dislikes: 0,
      emoji: 0,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T02:00:00.000Z',
    updatedAt: '2026-04-15T03:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('syncUserPostAuthorDenormalizationsBatch', () => {
  it('refreshes denormalized author fields across authored user posts', async () => {
    const store = new InMemoryUserPostAuthorSyncStore([
      createPost(),
      createPost({
        id: 'reply_01',
        type: 'reply',
        threadId: 'p_01',
        parentId: 'p_01',
      }),
      createPost({
        id: 'github_01',
        kind: 'github',
      }),
      createPost({
        id: 'other_01',
        authorId: 'u_grace',
      }),
    ])

    await syncUserPostAuthorDenormalizationsBatch(
      [createUser()],
      store,
      nullLogger,
    )

    expect(store.upsertedPosts).toEqual([
      createPost({
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
      }),
      createPost({
        id: 'reply_01',
        type: 'reply',
        threadId: 'p_01',
        parentId: 'p_01',
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
      }),
    ])
  })

  it('removes stale authorAvatarUrl values when the user clears their avatar', async () => {
    const store = new InMemoryUserPostAuthorSyncStore([createPost()])
    const user = createUser()
    delete user.avatarUrl

    await syncUserPostAuthorDenormalizationsBatch([user], store, nullLogger)

    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]).not.toHaveProperty('authorAvatarUrl')
    expect(store.upsertedPosts[0]).toMatchObject({
      id: 'p_01',
      authorHandle: 'ada',
      authorDisplayName: 'Ada Lovelace',
    })
  })

  it('skips upserts when the author denormalizations are already current', async () => {
    const store = new InMemoryUserPostAuthorSyncStore([
      createPost({
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
      }),
    ])

    await syncUserPostAuthorDenormalizationsBatch(
      [createUser()],
      store,
      nullLogger,
    )

    expect(store.upsertedPosts).toEqual([])
  })

  it('collapses duplicate change-feed images to the latest user document', async () => {
    const store = new InMemoryUserPostAuthorSyncStore([createPost()])
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    await syncUserPostAuthorDenormalizationsBatch(
      [
        createUser({
          displayName: 'Ada Earlier',
          avatarUrl: 'https://cdn.example.com/ada-earlier.png',
        }),
        createUser({
          displayName: 'Ada Latest',
          avatarUrl: 'https://cdn.example.com/ada-latest.png',
        }),
      ],
      store,
      logger,
    )

    expect(store.upsertedPosts).toEqual([
      createPost({
        authorHandle: 'ada',
        authorDisplayName: 'Ada Latest',
        authorAvatarUrl: 'https://cdn.example.com/ada-latest.png',
      }),
    ])
    expect(logger.info).toHaveBeenCalledWith(
      "Refreshed author denormalizations on %d post(s) for user '%s'.",
      1,
      'u_ada',
    )
  })

  it('warns and skips user documents without an id', async () => {
    const store = new InMemoryUserPostAuthorSyncStore([createPost()])
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    await syncUserPostAuthorDenormalizationsBatch(
      [
        {
          ...createUser(),
          id: '',
        },
      ],
      store,
      logger,
    )

    expect(store.upsertedPosts).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping post author denormalization sync for a user document without an id.',
    )
  })
})
