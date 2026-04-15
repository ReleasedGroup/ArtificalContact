import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildFollowCounterFn } from '../src/functions/counter.js'
import {
  syncFollowCountersBatch,
  type FollowCounterSourceDocument,
  type FollowCounterStore,
} from '../src/lib/follow-counter.js'
import type { StoredUserDocument } from '../src/lib/user-profile.js'

class InMemoryFollowCounterStore implements FollowCounterStore {
  public readonly followCountUpdates: Array<{
    followers: number
    following: number
    posts: number
    userId: string
  }> = []

  constructor(
    private readonly users: Map<string, StoredUserDocument> = new Map(),
    private readonly follows: Map<
      string,
      {
        followerId: string
        followedId: string
        deletedAt?: string | null
      }
    > = new Map(),
  ) {}

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    return this.users.get(userId) ?? null
  }

  async countActiveFollowers(userId: string): Promise<number> {
    return [...this.follows.values()].filter((follow) => {
      return follow.followedId === userId && follow.deletedAt == null
    }).length
  }

  async countActiveFollowing(userId: string): Promise<number> {
    return [...this.follows.values()].filter((follow) => {
      return follow.followerId === userId && follow.deletedAt == null
    }).length
  }

  async setFollowCounts(
    userId: string,
    counts: {
      followers: number
      following: number
      posts: number
    },
  ): Promise<void> {
    const user = this.users.get(userId)
    if (user === undefined) {
      throw new Error(`Cannot update missing user '${userId}'.`)
    }

    this.users.set(userId, {
      ...user,
      counters: {
        posts: counts.posts,
        followers: counts.followers,
        following: counts.following,
      },
    })
    this.followCountUpdates.push({
      userId,
      ...counts,
    })
  }

  snapshotUser(userId: string): StoredUserDocument | null {
    return this.users.get(userId) ?? null
  }
}

function createStoredUser(
  overrides: Partial<StoredUserDocument> & { id: string },
): StoredUserDocument {
  const { id, handle, handleLower, status, counters, ...rest } = overrides

  return {
    ...rest,
    id,
    handle: handle ?? id,
    handleLower: handleLower ?? id.toLowerCase(),
    status: status ?? 'active',
    counters: {
      posts: counters?.posts ?? 0,
      followers: counters?.followers ?? 0,
      following: counters?.following ?? 0,
    },
  }
}

function createFollowChange(
  overrides: Partial<FollowCounterSourceDocument> = {},
): FollowCounterSourceDocument {
  return {
    id: 'u_follower:u_followed',
    type: 'follow',
    followerId: 'u_follower',
    followedId: 'u_followed',
    ...overrides,
  }
}

function createStoredFollowRecord(
  followerId: string,
  followedId: string,
  deletedAt?: string,
) {
  return {
    followerId,
    followedId,
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

function createContext(): InvocationContext {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('syncFollowCountersBatch', () => {
  it('recomputes both user counters when a new follow is inserted', async () => {
    const store = new InMemoryFollowCounterStore(
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            counters: { posts: 3, followers: 2, following: 0 },
          }),
        ],
        [
          'u_followed',
          createStoredUser({
            id: 'u_followed',
            counters: { posts: 5, followers: 0, following: 7 },
          }),
        ],
      ]),
      new Map([
        [
          'u_other_1:u_follower',
          createStoredFollowRecord('u_other_1', 'u_follower'),
        ],
        [
          'u_other_2:u_follower',
          createStoredFollowRecord('u_other_2', 'u_follower'),
        ],
        ['u_followed:u_other_1', createStoredFollowRecord('u_followed', 'u_other_1')],
        ['u_followed:u_other_2', createStoredFollowRecord('u_followed', 'u_other_2')],
        ['u_followed:u_other_3', createStoredFollowRecord('u_followed', 'u_other_3')],
        ['u_followed:u_other_4', createStoredFollowRecord('u_followed', 'u_other_4')],
        ['u_followed:u_other_5', createStoredFollowRecord('u_followed', 'u_other_5')],
        ['u_followed:u_other_6', createStoredFollowRecord('u_followed', 'u_other_6')],
        ['u_followed:u_other_7', createStoredFollowRecord('u_followed', 'u_other_7')],
        [
          'u_follower:u_followed',
          createStoredFollowRecord('u_follower', 'u_followed'),
        ],
      ]),
    )
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncFollowCountersBatch([createFollowChange()], store, logger)

    expect(store.followCountUpdates).toEqual([
      {
        userId: 'u_follower',
        posts: 3,
        followers: 2,
        following: 1,
      },
      {
        userId: 'u_followed',
        posts: 5,
        followers: 1,
        following: 7,
      },
    ])
    expect(logger.info).toHaveBeenCalledWith(
      "Updated follow counters for user '%s' from followers=%d/following=%d to followers=%d/following=%d.",
      'u_follower',
      2,
      0,
      2,
      1,
    )
    expect(logger.info).toHaveBeenCalledWith(
      "Updated follow counters for user '%s' from followers=%d/following=%d to followers=%d/following=%d.",
      'u_followed',
      0,
      7,
      1,
      7,
    )
  })

  it('decrements both user counters when a follow is soft-deleted', async () => {
    const store = new InMemoryFollowCounterStore(
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            counters: { posts: 3, followers: 2, following: 1 },
          }),
        ],
        [
          'u_followed',
          createStoredUser({
            id: 'u_followed',
            counters: { posts: 5, followers: 1, following: 7 },
          }),
        ],
      ]),
      new Map([
        [
          'u_other_1:u_follower',
          createStoredFollowRecord('u_other_1', 'u_follower'),
        ],
        [
          'u_other_2:u_follower',
          createStoredFollowRecord('u_other_2', 'u_follower'),
        ],
        ['u_followed:u_other_1', createStoredFollowRecord('u_followed', 'u_other_1')],
        ['u_followed:u_other_2', createStoredFollowRecord('u_followed', 'u_other_2')],
        ['u_followed:u_other_3', createStoredFollowRecord('u_followed', 'u_other_3')],
        ['u_followed:u_other_4', createStoredFollowRecord('u_followed', 'u_other_4')],
        ['u_followed:u_other_5', createStoredFollowRecord('u_followed', 'u_other_5')],
        ['u_followed:u_other_6', createStoredFollowRecord('u_followed', 'u_other_6')],
        ['u_followed:u_other_7', createStoredFollowRecord('u_followed', 'u_other_7')],
        [
          'u_follower:u_followed',
          createStoredFollowRecord(
            'u_follower',
            'u_followed',
            '2026-04-15T06:00:00.000Z',
          ),
        ],
      ]),
    )

    await syncFollowCountersBatch(
      [
        createFollowChange({
          deletedAt: '2026-04-15T06:00:00.000Z',
        }),
      ],
      store,
    )

    expect(store.followCountUpdates).toEqual([
      {
        userId: 'u_follower',
        posts: 3,
        followers: 2,
        following: 0,
      },
      {
        userId: 'u_followed',
        posts: 5,
        followers: 0,
        following: 7,
      },
    ])
    expect(store.snapshotUser('u_follower')?.counters).toEqual({
      posts: 3,
      followers: 2,
      following: 0,
    })
    expect(store.snapshotUser('u_followed')?.counters).toEqual({
      posts: 5,
      followers: 0,
      following: 7,
    })
  })

  it('collapses duplicate change-feed deliveries and becomes a no-op once synchronized', async () => {
    const store = new InMemoryFollowCounterStore(
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            counters: { posts: 3, followers: 0, following: 0 },
          }),
        ],
        [
          'u_followed',
          createStoredUser({
            id: 'u_followed',
            counters: { posts: 5, followers: 0, following: 0 },
          }),
        ],
      ]),
      new Map([
        [
          'u_other_1:u_follower',
          createStoredFollowRecord('u_other_1', 'u_follower'),
        ],
        [
          'u_other_2:u_follower',
          createStoredFollowRecord('u_other_2', 'u_follower'),
        ],
        ['u_followed:u_other_1', createStoredFollowRecord('u_followed', 'u_other_1')],
        ['u_followed:u_other_2', createStoredFollowRecord('u_followed', 'u_other_2')],
        ['u_followed:u_other_3', createStoredFollowRecord('u_followed', 'u_other_3')],
        ['u_followed:u_other_4', createStoredFollowRecord('u_followed', 'u_other_4')],
        ['u_followed:u_other_5', createStoredFollowRecord('u_followed', 'u_other_5')],
        ['u_followed:u_other_6', createStoredFollowRecord('u_followed', 'u_other_6')],
        ['u_followed:u_other_7', createStoredFollowRecord('u_followed', 'u_other_7')],
        [
          'u_follower:u_followed',
          createStoredFollowRecord('u_follower', 'u_followed'),
        ],
      ]),
    )

    await syncFollowCountersBatch(
      [createFollowChange(), createFollowChange({ id: 'duplicate-id' })],
      store,
    )
    await syncFollowCountersBatch([createFollowChange()], store)

    expect(store.followCountUpdates).toHaveLength(2)
    expect(store.followCountUpdates[0]?.userId).toBe('u_follower')
    expect(store.followCountUpdates[1]?.userId).toBe('u_followed')
  })

  it('warns when a follow references a user that cannot be loaded', async () => {
    const store = new InMemoryFollowCounterStore(
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            counters: { posts: 3, followers: 0, following: 0 },
          }),
        ],
      ]),
      new Map([
        [
          'u_other_1:u_follower',
          createStoredFollowRecord('u_other_1', 'u_follower'),
        ],
        [
          'u_other_2:u_follower',
          createStoredFollowRecord('u_other_2', 'u_follower'),
        ],
        ['u_followed:u_other_1', createStoredFollowRecord('u_followed', 'u_other_1')],
        ['u_followed:u_other_2', createStoredFollowRecord('u_followed', 'u_other_2')],
        ['u_followed:u_other_3', createStoredFollowRecord('u_followed', 'u_other_3')],
        ['u_followed:u_other_4', createStoredFollowRecord('u_followed', 'u_other_4')],
        ['u_followed:u_other_5', createStoredFollowRecord('u_followed', 'u_other_5')],
        ['u_followed:u_other_6', createStoredFollowRecord('u_followed', 'u_other_6')],
        ['u_followed:u_other_7', createStoredFollowRecord('u_followed', 'u_other_7')],
        [
          'u_follower:u_followed',
          createStoredFollowRecord('u_follower', 'u_followed'),
        ],
      ]),
    )
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncFollowCountersBatch([createFollowChange()], store, logger)

    expect(store.followCountUpdates).toEqual([
      {
        userId: 'u_follower',
        posts: 3,
        followers: 2,
        following: 1,
      },
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping follow counter sync because user '%s' was not found.",
      'u_followed',
    )
  })

  it('ignores malformed change-feed documents safely', async () => {
    const store = new InMemoryFollowCounterStore()

    await syncFollowCountersBatch(
      [
        {
          id: 'bad',
          type: 'reaction',
          followerId: 'u_follower',
          followedId: 'u_followed',
        },
        {
          id: 'missing-followed',
          type: 'follow',
          followerId: 'u_follower',
        },
      ],
      store,
    )

    expect(store.followCountUpdates).toEqual([])
  })
})

describe('followCounterFn', () => {
  it('uses the injected store to synchronize follow counters for change-feed batches', async () => {
    const store = new InMemoryFollowCounterStore(
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            counters: { posts: 3, followers: 2, following: 0 },
          }),
        ],
        [
          'u_followed',
          createStoredUser({
            id: 'u_followed',
            counters: { posts: 5, followers: 0, following: 7 },
          }),
        ],
      ]),
      new Map([
        [
          'u_other_1:u_follower',
          createStoredFollowRecord('u_other_1', 'u_follower'),
        ],
        [
          'u_other_2:u_follower',
          createStoredFollowRecord('u_other_2', 'u_follower'),
        ],
        ['u_followed:u_other_1', createStoredFollowRecord('u_followed', 'u_other_1')],
        ['u_followed:u_other_2', createStoredFollowRecord('u_followed', 'u_other_2')],
        ['u_followed:u_other_3', createStoredFollowRecord('u_followed', 'u_other_3')],
        ['u_followed:u_other_4', createStoredFollowRecord('u_followed', 'u_other_4')],
        ['u_followed:u_other_5', createStoredFollowRecord('u_followed', 'u_other_5')],
        ['u_followed:u_other_6', createStoredFollowRecord('u_followed', 'u_other_6')],
        ['u_followed:u_other_7', createStoredFollowRecord('u_followed', 'u_other_7')],
        [
          'u_follower:u_followed',
          createStoredFollowRecord('u_follower', 'u_followed'),
        ],
      ]),
    )
    const handler = buildFollowCounterFn({
      followStoreFactory: () => store,
    })
    const context = createContext()

    await handler([createFollowChange()], context)

    expect(store.followCountUpdates).toHaveLength(2)
    expect(context.info).toHaveBeenCalledWith(
      "Updated follow counters for user '%s' from followers=%d/following=%d to followers=%d/following=%d.",
      'u_follower',
      2,
      0,
      2,
      1,
    )
  })
})
