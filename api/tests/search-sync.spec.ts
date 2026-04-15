import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackMetric } from '../src/lib/telemetry.js'
import type {
  SearchPostIndexDocument,
  SearchSyncStore,
  SearchUserIndexDocument,
} from '../src/lib/search-sync.js'
import { syncSearchPostsBatch, syncSearchUsersBatch } from '../src/lib/search-sync.js'
import type { StoredPostDocument } from '../src/lib/posts.js'
import type { UserDocument } from '../src/lib/users.js'

vi.mock('../src/lib/telemetry.js', () => ({
  trackMetric: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
  vi.mocked(trackMetric).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

class InMemorySearchSyncStore implements SearchSyncStore {
  public readonly upsertedPosts: SearchPostIndexDocument[] = []
  public readonly deletedPostIds: string[] = []
  public readonly upsertedUsers: SearchUserIndexDocument[] = []
  public readonly deletedUserIds: string[] = []

  async upsertPosts(documents: SearchPostIndexDocument[]): Promise<void> {
    this.upsertedPosts.push(...documents)
  }

  async deletePosts(ids: string[]): Promise<void> {
    this.deletedPostIds.push(...ids)
  }

  async upsertUsers(documents: SearchUserIndexDocument[]): Promise<void> {
    this.upsertedUsers.push(...documents)
  }

  async deleteUsers(ids: string[]): Promise<void> {
    this.deletedUserIds.push(...ids)
  }
}

function createPost(overrides: Partial<StoredPostDocument> = {}): StoredPostDocument {
  return {
    id: 'p_1',
    type: 'post',
    kind: 'user',
    threadId: 'p_1',
    parentId: null,
    authorId: 'u_ada',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    text: 'Exploring search sync',
    hashtags: ['ts', 'search'],
    mentions: ['alice'],
    counters: {
      likes: 10,
      dislikes: 0,
      emoji: 1,
      replies: 2,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'u_ada',
    handle: 'AdaLovelace',
    handleLower: 'adalovelace',
    type: 'user',
    identityProvider: 'email',
    identityProviderUserId: 'id-ada',
    displayName: 'Ada Lovelace',
    expertise: [],
    links: {},
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 0,
      followers: 0,
      following: 0,
    },
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    ...overrides,
  }
}

describe('syncSearchPostsBatch', () => {
  it('upserts non-deleted posts and deletes deleted posts', async () => {
    const store = new InMemorySearchSyncStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncSearchPostsBatch(
      [
        createPost({ id: 'p_keep' }),
        createPost({
          id: 'p_delete',
          moderationState: 'removed',
          deletedAt: '2026-04-15T11:00:00.000Z',
        }),
      ],
      store,
      logger,
    )

    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]).toMatchObject({
      id: 'p_keep',
      hashtags: ['ts', 'search'],
    })
    expect(store.deletedPostIds).toEqual(['p_delete'])
    expect(logger.info).toHaveBeenCalledWith(
      'Synced %d posts to Azure AI Search.',
      1,
    )
    expect(logger.info).toHaveBeenCalledWith(
      'Deleted %d posts from Azure AI Search.',
      1,
    )
    expect(trackMetric).toHaveBeenCalledWith(
      'search.sync.lag_seconds',
      0,
      {
        entityType: 'post',
      },
    )
  })

  it('uses the latest document per id when duplicates are present', async () => {
    const store = new InMemorySearchSyncStore()

    await syncSearchPostsBatch(
      [
        createPost({ id: 'p_dup', text: 'first', deletedAt: null }),
        createPost({
          id: 'p_dup',
          text: 'second',
          deletedAt: '2026-04-15T12:00:00.000Z',
        }),
      ],
      store,
    )

    expect(store.deletedPostIds).toEqual(['p_dup'])
    expect(store.upsertedPosts).toHaveLength(0)
  })

  it('warns and skips posts without ids', async () => {
    const store = new InMemorySearchSyncStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncSearchPostsBatch([{ ...createPost(), id: '' }], store, logger)

    expect(store.upsertedPosts).toEqual([])
    expect(store.deletedPostIds).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping post without a valid id for search sync.',
    )
  })
})

describe('syncSearchUsersBatch', () => {
  it('upserts users with valid handles and deletes users without handle', async () => {
    const store = new InMemorySearchSyncStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncSearchUsersBatch(
      [
        createUser(),
        createUser({ id: 'u_no_handle', handleLower: '', handle: '' }),
        createUser({ id: '' }),
      ],
      store,
      logger,
    )

    expect(store.upsertedUsers).toHaveLength(1)
    expect(store.upsertedUsers[0]).toMatchObject({
      id: 'u_ada',
      handleLower: 'adalovelace',
    })
    expect(store.deletedUserIds).toEqual(['u_no_handle'])
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping user without a valid id for search sync.',
    )
    expect(trackMetric).toHaveBeenCalledWith(
      'search.sync.lag_seconds',
      0,
      {
        entityType: 'user',
      },
    )
  })

  it('uses the latest user by id when duplicates are present', async () => {
    const store = new InMemorySearchSyncStore()

    await syncSearchUsersBatch(
      [
        createUser({ id: 'u_ada', handleLower: 'first' }),
        createUser({ id: 'u_ada', handleLower: 'second' }),
      ],
      store,
    )

    const [upsertedUser] = store.upsertedUsers
    expect(store.upsertedUsers).toHaveLength(1)
    expect(upsertedUser?.handleLower).toBe('second')
  })
})
