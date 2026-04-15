import { describe, expect, it } from 'vitest'
import {
  MAX_FANOUT_FOLLOWERS,
  buildFeedEntryDocument,
  buildFeedEntrySource,
  syncFeedFanOutBatch,
  type FeedEntryDocument,
  type FeedFanOutSourceDocument,
  type FeedStore as FeedFanOutStore,
  type FollowerFeedTarget,
  type FollowersFeedSourceStore,
} from '../src/lib/feed-fanout.js'
import {
  lookupFeed,
  type FeedStore as FeedReadStore,
  type StoredFeedDocument,
} from '../src/lib/feed.js'

const SYNTHETIC_FOLLOWER_COUNT = 10_000
const FANOUT_WRITE_ESTIMATED_RU = 7
const GET_FEED_PAGE_ESTIMATED_RU = 6
const SYNTHETIC_FEED_LOOKUP_COUNT = 2

// Mirrors the RU estimates documented in docs/technical.md §6.4 for the
// capped write path plus the two feed lookups exercised below. Each lookup
// reads both the materialized feed partition and the pull-on-read source.
const SYNTHETIC_LOAD_RU_BUDGET =
  MAX_FANOUT_FOLLOWERS * FANOUT_WRITE_ESTIMATED_RU +
  SYNTHETIC_FEED_LOOKUP_COUNT * 2 * GET_FEED_PAGE_ESTIMATED_RU

class SyntheticFollowersStore implements FollowersFeedSourceStore {
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

class SyntheticFeedStore implements FeedFanOutStore, FeedReadStore {
  public readonly upsertOperations: FeedEntryDocument[] = []
  public feedReadCount = 0
  public pullOnReadCount = 0

  private readonly materializedByFeedOwnerId = new Map<string, FeedEntryDocument[]>()

  constructor(
    private readonly celebrityPostsByAuthorId = new Map<
      string,
      FeedFanOutSourceDocument[]
    >(),
    private readonly followedIdsByFeedOwnerId = new Map<string, string[]>(),
    private readonly followerCountsByAuthorId = new Map<string, number>(),
  ) {}

  async upsertFeedEntry(document: FeedEntryDocument): Promise<void> {
    const materializedEntries =
      this.materializedByFeedOwnerId.get(document.feedOwnerId) ?? []
    const nextEntries = materializedEntries.filter(
      (entry) => entry.id !== document.id,
    )

    nextEntries.push(document)
    nextEntries.sort(compareFeedDocuments)

    this.materializedByFeedOwnerId.set(document.feedOwnerId, nextEntries)
    this.upsertOperations.push(document)
  }

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
    void options.cursor
    this.feedReadCount += 1

    return {
      entries: this.snapshotMaterializedEntries(feedOwnerId).slice(
        0,
        options.limit,
      ),
    }
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
    void options.cursor
    this.pullOnReadCount += 1

    const celebrityFolloweeIds = (
      this.followedIdsByFeedOwnerId.get(feedOwnerId) ?? []
    ).filter(
      (followedId) =>
        (this.followerCountsByAuthorId.get(followedId) ?? 0) >
        MAX_FANOUT_FOLLOWERS,
    )

    const entries = celebrityFolloweeIds
      .flatMap((followedId) => this.celebrityPostsByAuthorId.get(followedId) ?? [])
      .map((post) => {
        const source = buildFeedEntrySource(post)
        return source === null ? null : buildFeedEntryDocument(feedOwnerId, source)
      })
      .filter((entry): entry is FeedEntryDocument => entry !== null)
      .sort(compareFeedDocuments)

    return {
      entries: entries.slice(0, options.limit),
    }
  }

  snapshotMaterializedEntries(feedOwnerId: string): FeedEntryDocument[] {
    return [...(this.materializedByFeedOwnerId.get(feedOwnerId) ?? [])]
  }
}

function compareFeedDocuments(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt)
  }

  return right.id.localeCompare(left.id)
}

function createFollowers(
  followedId: string,
  followerCount: number,
): FollowerFeedTarget[] {
  return Array.from({ length: followerCount }, (_, index) => ({
    followerId: `u_follower_${index + 1}`,
    followedId,
  }))
}

function createPostChange(
  overrides: Partial<FeedFanOutSourceDocument> = {},
): FeedFanOutSourceDocument {
  return {
    id: 'p_synthetic_01',
    type: 'post',
    kind: 'user',
    threadId: 'p_synthetic_01',
    parentId: null,
    authorId: 'u_celebrity',
    authorHandle: 'celeb',
    authorDisplayName: 'Celebrity Author',
    authorAvatarUrl: 'https://cdn.example.com/celebrity.png',
    text: 'Testing the Sprint 4 fan-out cap.',
    media: [],
    counters: {
      likes: 0,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T12:00:00.000Z',
    updatedAt: '2026-04-15T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('Sprint 4 synthetic fan-out load', () => {
  it('caps a 10k-follower fan-out within the RU budget and serves overflow followers via pull-on-read', async () => {
    const authorId = 'u_celebrity'
    const cappedFollowerId = 'u_follower_1'
    const overflowFollowerId = `u_follower_${MAX_FANOUT_FOLLOWERS + 1}`
    const postChange = createPostChange({
      authorId,
    })
    const followerTargets = createFollowers(authorId, SYNTHETIC_FOLLOWER_COUNT)
    const followersStore = new SyntheticFollowersStore(
      new Map([[authorId, followerTargets]]),
    )
    const followedIdsByFeedOwnerId = new Map(
      followerTargets.map((target) => [target.followerId, [authorId]]),
    )
    const feedStore = new SyntheticFeedStore(
      new Map([[authorId, [postChange]]]),
      followedIdsByFeedOwnerId,
      new Map([[authorId, SYNTHETIC_FOLLOWER_COUNT]]),
    )

    await syncFeedFanOutBatch([postChange], followersStore, feedStore)

    expect(feedStore.upsertOperations).toHaveLength(MAX_FANOUT_FOLLOWERS)
    expect(feedStore.snapshotMaterializedEntries(cappedFollowerId)).toHaveLength(1)
    expect(feedStore.snapshotMaterializedEntries(overflowFollowerId)).toEqual([])

    const cappedFollowerFeed = await lookupFeed(
      {
        feedOwnerId: cappedFollowerId,
      },
      feedStore,
    )
    const overflowFollowerFeed = await lookupFeed(
      {
        feedOwnerId: overflowFollowerId,
      },
      feedStore,
    )

    expect(cappedFollowerFeed.status).toBe(200)
    expect(cappedFollowerFeed.body.data).toEqual([
      expect.objectContaining({
        id: `${cappedFollowerId}:p_synthetic_01`,
        postId: 'p_synthetic_01',
      }),
    ])
    expect(overflowFollowerFeed.status).toBe(200)
    expect(overflowFollowerFeed.body.data).toEqual([
      expect.objectContaining({
        id: `${overflowFollowerId}:p_synthetic_01`,
        postId: 'p_synthetic_01',
      }),
    ])
    expect(feedStore.feedReadCount).toBe(SYNTHETIC_FEED_LOOKUP_COUNT)
    expect(feedStore.pullOnReadCount).toBe(SYNTHETIC_FEED_LOOKUP_COUNT)

    const syntheticLoadRu =
      feedStore.upsertOperations.length * FANOUT_WRITE_ESTIMATED_RU +
      (feedStore.feedReadCount + feedStore.pullOnReadCount) *
        GET_FEED_PAGE_ESTIMATED_RU
    const uncappedSyntheticLoadRu =
      SYNTHETIC_FOLLOWER_COUNT * FANOUT_WRITE_ESTIMATED_RU +
      (feedStore.feedReadCount + feedStore.pullOnReadCount) *
        GET_FEED_PAGE_ESTIMATED_RU

    expect(syntheticLoadRu).toBeLessThanOrEqual(SYNTHETIC_LOAD_RU_BUDGET)
    expect(uncappedSyntheticLoadRu).toBeGreaterThan(SYNTHETIC_LOAD_RU_BUDGET)
  })
})
