import type { StoredPostDocument, StoredPostMediaDocument } from './posts.js'

export const DEFAULT_FEEDS_CONTAINER_NAME = 'feeds'
export const MAX_FANOUT_FOLLOWERS = 5000
export const FEED_ENTRY_TTL_SECONDS = 60 * 60 * 24 * 30

export type FeedFanOutSourceDocument = StoredPostDocument

export interface FollowerFeedTarget {
  followerId: string
  followedId: string
}

export interface FeedEntryMediaDocument {
  kind: string | null
  thumbUrl: string | null
}

export interface FeedEntryDocument {
  id: string
  feedOwnerId: string
  postId: string
  authorId: string
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  excerpt: string
  media: FeedEntryMediaDocument[]
  counters: {
    likes: number
    replies: number
  }
  createdAt: string
  ttl: number
}

export interface FollowersFeedSourceStore {
  listFollowersByFollowedId(
    followedId: string,
    limit: number,
  ): Promise<FollowerFeedTarget[]>
}

export interface FeedStore {
  upsertFeedEntry(document: FeedEntryDocument): Promise<void>
}

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

interface FeedFanOutWorkItem {
  authorAvatarUrl: string | null
  authorDisplayName: string | null
  authorHandle: string | null
  authorId: string
  counters: {
    likes: number
    replies: number
  }
  createdAt: string
  excerpt: string
  media: FeedEntryMediaDocument[]
  postId: string
}

const noop = (): void => undefined

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullableString(value: unknown): string | null {
  return toNonEmptyString(value)
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0
}

function buildFeedMedia(
  media: StoredPostMediaDocument[] | null | undefined,
): FeedEntryMediaDocument[] {
  if (!Array.isArray(media)) {
    return []
  }

  return media
    .filter(
      (item): item is StoredPostMediaDocument =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      kind: toNullableString(item.kind),
      thumbUrl: toNullableString(item.thumbUrl) ?? toNullableString(item.url),
    }))
}

function buildFeedFanOutWorkItem(
  document: FeedFanOutSourceDocument,
): FeedFanOutWorkItem | null {
  const postId = toNonEmptyString(document.id)
  const type = toNullableString(document.type) ?? 'post'
  const kind = toNullableString(document.kind) ?? 'user'
  const threadId = toNonEmptyString(document.threadId)
  const authorId = toNonEmptyString(document.authorId)
  const createdAt = toNonEmptyString(document.createdAt)
  const parentId = toNullableString(document.parentId)
  const deletedAt = toNullableString(document.deletedAt)
  const visibility = toNullableString(document.visibility) ?? 'public'
  const moderationState = toNullableString(document.moderationState) ?? 'ok'

  if (
    postId === null ||
    type !== 'post' ||
    kind !== 'user' ||
    threadId !== postId ||
    authorId === null ||
    createdAt === null ||
    parentId !== null ||
    deletedAt !== null ||
    visibility !== 'public' ||
    moderationState === 'hidden' ||
    moderationState === 'removed'
  ) {
    return null
  }

  return {
    postId,
    authorId,
    authorHandle: toNullableString(document.authorHandle),
    authorDisplayName: toNullableString(document.authorDisplayName),
    authorAvatarUrl: toNullableString(document.authorAvatarUrl),
    excerpt: toNullableString(document.text) ?? '',
    media: buildFeedMedia(document.media),
    counters: {
      likes: toCount(document.counters?.likes),
      replies: toCount(document.counters?.replies),
    },
    createdAt,
  }
}

function collapsePostChangesToLatest(
  documents: readonly FeedFanOutSourceDocument[],
): FeedFanOutWorkItem[] {
  const latestById = new Map<string, FeedFanOutWorkItem | null>()

  for (const document of documents) {
    const postId = toNonEmptyString(document.id)
    if (postId === null) {
      continue
    }

    latestById.set(postId, buildFeedFanOutWorkItem(document))
  }

  return [...latestById.values()].filter(
    (workItem): workItem is FeedFanOutWorkItem => workItem !== null,
  )
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export function buildFeedEntryId(feedOwnerId: string, postId: string): string {
  return `${feedOwnerId}:${postId}`
}

export function buildFeedEntryDocument(
  feedOwnerId: string,
  workItem: FeedFanOutWorkItem,
): FeedEntryDocument {
  return {
    id: buildFeedEntryId(feedOwnerId, workItem.postId),
    feedOwnerId,
    postId: workItem.postId,
    authorId: workItem.authorId,
    authorHandle: workItem.authorHandle,
    authorDisplayName: workItem.authorDisplayName,
    authorAvatarUrl: workItem.authorAvatarUrl,
    excerpt: workItem.excerpt,
    media: workItem.media,
    counters: workItem.counters,
    createdAt: workItem.createdAt,
    ttl: FEED_ENTRY_TTL_SECONDS,
  }
}

export async function syncFeedFanOutBatch(
  documents: readonly FeedFanOutSourceDocument[],
  followersStore: FollowersFeedSourceStore,
  feedStore: FeedStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const workItems = collapsePostChangesToLatest(documents)

  for (const workItem of workItems) {
    const followerTargets = await followersStore.listFollowersByFollowedId(
      workItem.authorId,
      MAX_FANOUT_FOLLOWERS + 1,
    )
    const cappedFollowers = followerTargets.slice(0, MAX_FANOUT_FOLLOWERS)

    if (cappedFollowers.length === 0) {
      continue
    }

    for (const followerBatch of chunkArray(cappedFollowers, 100)) {
      await Promise.all(
        followerBatch.map((target) =>
          feedStore.upsertFeedEntry(
            buildFeedEntryDocument(target.followerId, workItem),
          ),
        ),
      )
    }

    logger.info(
      "Upserted %d feed entries for post '%s' authored by '%s'.",
      cappedFollowers.length,
      workItem.postId,
      workItem.authorId,
    )

    if (followerTargets.length > MAX_FANOUT_FOLLOWERS) {
      logger.warn(
        "Capped fan-out for post '%s' authored by '%s' at %d followers.",
        workItem.postId,
        workItem.authorId,
        MAX_FANOUT_FOLLOWERS,
      )
    }
  }
}
