import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildFeedFanOutFn } from '../src/functions/feed-fanout.js'
import {
  MAX_FANOUT_FOLLOWERS,
  buildFeedEntryDocument,
  buildFeedEntryId,
  syncFeedFanOutBatch,
  type FeedEntryDocument,
  type FeedFanOutSourceDocument,
  type FeedStore,
  type FollowerFeedTarget,
  type FollowersFeedSourceStore,
} from '../src/lib/feed-fanout.js'

class InMemoryFollowersFeedSourceStore implements FollowersFeedSourceStore {
  constructor(
    private readonly followerTargets = new Map<string, FollowerFeedTarget[]>(),
  ) {}

  async listFollowersByFollowedId(
    followedId: string,
    limit: number,
  ): Promise<FollowerFeedTarget[]> {
    return (this.followerTargets.get(followedId) ?? []).slice(0, limit)
  }
}

class InMemoryFeedStore implements FeedStore {
  public readonly upsertedEntries: FeedEntryDocument[] = []

  private readonly entries = new Map<string, FeedEntryDocument>()

  async upsertFeedEntry(document: FeedEntryDocument): Promise<void> {
    this.entries.set(document.id, document)
    this.upsertedEntries.push(document)
  }

  snapshotEntries(): FeedEntryDocument[] {
    return [...this.entries.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }
}

function createFollowersStore(options?: {
  followedUserId?: string
  followerCount?: number
}) {
  const followedUserId = options?.followedUserId ?? 'u_author'
  const followerCount = options?.followerCount ?? 2
  const followers = Array.from({ length: followerCount }, (_, index) => ({
    followerId: `u_follower_${index + 1}`,
    followedId: followedUserId,
  }))

  return new InMemoryFollowersFeedSourceStore(
    new Map([[followedUserId, followers]]),
  )
}

function createPostChange(
  overrides: Partial<FeedFanOutSourceDocument> = {},
): FeedFanOutSourceDocument {
  return {
    id: 'p_01',
    type: 'post',
    kind: 'user',
    threadId: 'p_01',
    parentId: null,
    authorId: 'u_author',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: 'https://cdn.example.com/ada.png',
    text: 'Trying out a new eval harness...',
    media: [
      {
        id: 'm_01',
        kind: 'image',
        url: 'https://cdn.example.com/full.png',
        thumbUrl: 'https://cdn.example.com/thumb.png',
      },
    ],
    counters: {
      likes: 7,
      replies: 2,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
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

describe('feed entry helpers', () => {
  it('builds deterministic feed entry ids using the feed owner and post id', () => {
    expect(buildFeedEntryId('u_follower_1', 'p_01')).toBe('u_follower_1:p_01')
  })

  it('maps root user posts into denormalized feed entries', () => {
    expect(
      buildFeedEntryDocument('u_follower_1', {
        postId: 'p_01',
        authorId: 'u_author',
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
        excerpt: 'Trying out a new eval harness...',
        media: [{ kind: 'image', thumbUrl: 'https://cdn.example.com/thumb.png' }],
        counters: { likes: 7, replies: 2 },
        createdAt: '2026-04-15T09:00:00.000Z',
      }),
    ).toEqual({
      id: 'u_follower_1:p_01',
      feedOwnerId: 'u_follower_1',
      postId: 'p_01',
      authorId: 'u_author',
      authorHandle: 'ada',
      authorDisplayName: 'Ada Lovelace',
      authorAvatarUrl: 'https://cdn.example.com/ada.png',
      excerpt: 'Trying out a new eval harness...',
      media: [{ kind: 'image', thumbUrl: 'https://cdn.example.com/thumb.png' }],
      counters: { likes: 7, replies: 2 },
      createdAt: '2026-04-15T09:00:00.000Z',
      ttl: 2592000,
    })
  })
})

describe('syncFeedFanOutBatch', () => {
  it('fans a root user post out to follower feed partitions', async () => {
    const followersStore = createFollowersStore()
    const feedStore = new InMemoryFeedStore()

    await syncFeedFanOutBatch([createPostChange()], followersStore, feedStore)

    expect(feedStore.snapshotEntries()).toEqual([
      {
        id: 'u_follower_1:p_01',
        feedOwnerId: 'u_follower_1',
        postId: 'p_01',
        authorId: 'u_author',
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
        excerpt: 'Trying out a new eval harness...',
        media: [{ kind: 'image', thumbUrl: 'https://cdn.example.com/thumb.png' }],
        counters: { likes: 7, replies: 2 },
        createdAt: '2026-04-15T09:00:00.000Z',
        ttl: 2592000,
      },
      {
        id: 'u_follower_2:p_01',
        feedOwnerId: 'u_follower_2',
        postId: 'p_01',
        authorId: 'u_author',
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
        excerpt: 'Trying out a new eval harness...',
        media: [{ kind: 'image', thumbUrl: 'https://cdn.example.com/thumb.png' }],
        counters: { likes: 7, replies: 2 },
        createdAt: '2026-04-15T09:00:00.000Z',
        ttl: 2592000,
      },
    ])
  })

  it('collapses duplicate change-feed deliveries to the latest post image', async () => {
    const followersStore = createFollowersStore({ followerCount: 1 })
    const feedStore = new InMemoryFeedStore()

    await syncFeedFanOutBatch(
      [
        createPostChange({
          text: 'Earlier body',
          counters: { likes: 1, replies: 0 },
        }),
        createPostChange({
          text: 'Latest body',
          counters: { likes: 3, replies: 1 },
          media: [
            {
              kind: 'image',
              thumbUrl: null,
              url: 'https://cdn.example.com/fallback-thumb.png',
            },
          ],
        }),
      ],
      followersStore,
      feedStore,
    )

    expect(feedStore.snapshotEntries()).toEqual([
      {
        id: 'u_follower_1:p_01',
        feedOwnerId: 'u_follower_1',
        postId: 'p_01',
        authorId: 'u_author',
        authorHandle: 'ada',
        authorDisplayName: 'Ada Lovelace',
        authorAvatarUrl: 'https://cdn.example.com/ada.png',
        excerpt: 'Latest body',
        media: [
          {
            kind: 'image',
            thumbUrl: 'https://cdn.example.com/fallback-thumb.png',
          },
        ],
        counters: { likes: 3, replies: 1 },
        createdAt: '2026-04-15T09:00:00.000Z',
        ttl: 2592000,
      },
    ])
  })

  it('caps fan-out at the configured follower ceiling and warns when truncating', async () => {
    const followersStore = createFollowersStore({
      followerCount: MAX_FANOUT_FOLLOWERS + 2,
    })
    const feedStore = new InMemoryFeedStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    await syncFeedFanOutBatch(
      [createPostChange()],
      followersStore,
      feedStore,
      logger,
    )

    expect(feedStore.snapshotEntries()).toHaveLength(MAX_FANOUT_FOLLOWERS)
    expect(feedStore.snapshotEntries()[0]?.id).toBe('u_follower_1:p_01')
    expect(
      feedStore.snapshotEntries().some(
        (entry) => entry.id === `u_follower_${MAX_FANOUT_FOLLOWERS}:p_01`,
      ),
    ).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      "Capped fan-out for post '%s' authored by '%s' at %d followers.",
      'p_01',
      'u_author',
      MAX_FANOUT_FOLLOWERS,
    )
  })

  it('skips replies, github posts, and soft-deleted posts safely', async () => {
    const followersStore = createFollowersStore()
    const feedStore = new InMemoryFeedStore()

    await syncFeedFanOutBatch(
      [
        createPostChange({
          id: 'reply_01',
          type: 'reply',
          threadId: 'p_01',
          parentId: 'p_01',
        }),
        createPostChange({
          id: 'gh_01',
          kind: 'github',
          authorId: 'sys_github_repo',
          threadId: 'gh_01',
        }),
        createPostChange({
          id: 'deleted_01',
          threadId: 'deleted_01',
          deletedAt: '2026-04-15T10:00:00.000Z',
          text: null,
        }),
      ],
      followersStore,
      feedStore,
    )

    expect(feedStore.snapshotEntries()).toEqual([])
  })
})

describe('feedFanOutFn', () => {
  it('uses the injected stores to synchronize follower feeds for change-feed batches', async () => {
    const followersStore = createFollowersStore({ followerCount: 1 })
    const feedStore = new InMemoryFeedStore()
    const handler = buildFeedFanOutFn({
      followersStoreFactory: () => followersStore,
      feedStoreFactory: () => feedStore,
    })
    const context = createContext()

    await handler([createPostChange()], context)

    expect(feedStore.snapshotEntries()).toHaveLength(1)
    expect(context.info).toHaveBeenCalledWith(
      "Upserted %d feed entries for post '%s' authored by '%s'.",
      1,
      'p_01',
      'u_author',
    )
  })
})
