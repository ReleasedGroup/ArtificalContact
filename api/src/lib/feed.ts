import type { ApiEnvelope } from './api-envelope.js'
import type { FeedEntryDocument } from './feed-fanout.js'

export const DEFAULT_FEED_PAGE_SIZE = 20

export type StoredFeedDocument = FeedEntryDocument

export interface FeedMedia {
  kind: string | null
  thumbUrl: string | null
}

export interface FeedEntry {
  id: string
  postId: string
  authorId: string | null
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  excerpt: string | null
  media: FeedMedia[]
  counters: {
    likes: number
    replies: number
  }
  createdAt: string | null
}

export interface FeedPageRequest {
  feedOwnerId: string | undefined
  cursor?: string | undefined
}

export interface FeedStore {
  listFeedEntries(
    feedOwnerId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    entries: StoredFeedDocument[]
    cursor?: string
  }>
}

export interface FeedLookupResult {
  status: 200 | 400
  body: ApiEnvelope<FeedEntry[]> & {
    cursor: string | null
  }
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function buildFeedMedia(media: unknown): FeedMedia | null {
  if (typeof media !== 'object' || media === null) {
    return null
  }

  const candidate = media as Partial<FeedEntryDocument['media'][number]>
  const kind = toNullableString(candidate.kind)
  const thumbUrl = toNullableString(candidate.thumbUrl)

  if (kind === null && thumbUrl === null) {
    return null
  }

  return {
    kind,
    thumbUrl,
  }
}

export function buildFeedEntry(document: StoredFeedDocument): FeedEntry | null {
  const id = toNullableString(document.id)
  const postId = toNullableString(document.postId)

  if (id === null || postId === null) {
    return null
  }

  return {
    id,
    postId,
    authorId: toNullableString(document.authorId),
    authorHandle: toNullableString(document.authorHandle),
    authorDisplayName: toNullableString(document.authorDisplayName),
    authorAvatarUrl: toNullableString(document.authorAvatarUrl),
    excerpt: toNullableString(document.excerpt),
    media: (Array.isArray(document.media) ? document.media : [])
      .map((media) => buildFeedMedia(media))
      .filter((media): media is FeedMedia => media !== null),
    counters: {
      likes: toNonNegativeNumber(document.counters?.likes),
      replies: toNonNegativeNumber(document.counters?.replies),
    },
    createdAt: toNullableString(document.createdAt),
  }
}

export async function lookupFeed(
  request: FeedPageRequest,
  store: FeedStore,
): Promise<FeedLookupResult> {
  const feedOwnerId = toNullableString(request.feedOwnerId)

  if (feedOwnerId === null) {
    return {
      status: 400,
      body: {
        data: null,
        cursor: null,
        errors: [
          {
            code: 'invalid_feed_owner_id',
            message: 'The authenticated user id is required to load a feed.',
            field: 'feedOwnerId',
          },
        ],
      },
    }
  }

  const cursor = toNullableString(request.cursor) ?? undefined
  const page = await store.listFeedEntries(feedOwnerId, {
    limit: DEFAULT_FEED_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return {
    status: 200,
    body: {
      data: page.entries
        .map((entry) => buildFeedEntry(entry))
        .filter((entry): entry is FeedEntry => entry !== null),
      cursor: page.cursor ?? null,
      errors: [],
    },
  }
}
