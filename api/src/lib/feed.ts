import type { ApiEnvelope } from './api-envelope.js'
import type { FeedEntryDocument } from './feed-fanout.js'

export const DEFAULT_FEED_PAGE_SIZE = 20
const FEED_CURSOR_PREFIX = 'ac.feed.v1:'

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
  listPullOnReadFeedEntries?(
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

interface FeedCursorState {
  feedBuffer: StoredFeedDocument[]
  feedCursor?: string
  pullBuffer: StoredFeedDocument[]
  pullCursor?: string
}

interface FeedCursorPayload {
  feedBuffer?: unknown
  feedCursor?: unknown
  pullBuffer?: unknown
  pullCursor?: unknown
}

type FeedSourceName = 'feed' | 'pull'

interface FeedCandidate {
  document: StoredFeedDocument
  source: FeedSourceName
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

function normalizeStoredFeedBuffer(
  value: unknown,
): StoredFeedDocument[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (document): document is StoredFeedDocument =>
      typeof document === 'object' && document !== null,
  )
}

function parseFeedCursorState(cursor: string | undefined): FeedCursorState {
  if (cursor === undefined || !cursor.startsWith(FEED_CURSOR_PREFIX)) {
    return {
      feedBuffer: [],
      ...(cursor === undefined ? {} : { feedCursor: cursor }),
      pullBuffer: [],
    }
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        cursor.slice(FEED_CURSOR_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    ) as FeedCursorPayload

    return {
      feedBuffer: normalizeStoredFeedBuffer(payload.feedBuffer),
      ...(toNullableString(payload.feedCursor) === null
        ? {}
        : { feedCursor: toNullableString(payload.feedCursor)! }),
      pullBuffer: normalizeStoredFeedBuffer(payload.pullBuffer),
      ...(toNullableString(payload.pullCursor) === null
        ? {}
        : { pullCursor: toNullableString(payload.pullCursor)! }),
    }
  } catch {
    return {
      feedBuffer: [],
      feedCursor: cursor,
      pullBuffer: [],
    }
  }
}

function buildFeedCursor(
  state: FeedCursorState,
  allowLegacyFeedCursor: boolean,
): string | null {
  const hasFeedBuffer = state.feedBuffer.length > 0
  const hasPullBuffer = state.pullBuffer.length > 0
  const hasPullCursor = state.pullCursor !== undefined
  const hasFeedCursor = state.feedCursor !== undefined

  if (!hasFeedBuffer && !hasPullBuffer && !hasPullCursor) {
    if (!hasFeedCursor) {
      return null
    }

    return allowLegacyFeedCursor ? state.feedCursor ?? null : FEED_CURSOR_PREFIX + Buffer.from(
      JSON.stringify({
        feedCursor: state.feedCursor,
      }),
      'utf8',
    ).toString('base64url')
  }

  const payload: FeedCursorPayload = {
    ...(hasFeedBuffer ? { feedBuffer: state.feedBuffer } : {}),
    ...(hasFeedCursor ? { feedCursor: state.feedCursor } : {}),
    ...(hasPullBuffer ? { pullBuffer: state.pullBuffer } : {}),
    ...(hasPullCursor ? { pullCursor: state.pullCursor } : {}),
  }

  return (
    FEED_CURSOR_PREFIX +
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  )
}

function compareFeedDocuments(
  left: StoredFeedDocument,
  right: StoredFeedDocument,
): number {
  const leftCreatedAt = toNullableString(left.createdAt) ?? ''
  const rightCreatedAt = toNullableString(right.createdAt) ?? ''

  if (leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt.localeCompare(leftCreatedAt)
  }

  const leftId = toNullableString(left.id) ?? ''
  const rightId = toNullableString(right.id) ?? ''
  return rightId.localeCompare(leftId)
}

function resolveFeedCandidateKey(
  candidate: FeedCandidate,
  index: number,
): string {
  return (
    toNullableString(candidate.document.id) ??
    toNullableString(candidate.document.postId) ??
    `${candidate.source}:${index}`
  )
}

function mergeFeedCandidates(
  candidates: readonly FeedCandidate[],
): {
  entries: StoredFeedDocument[]
  nextFeedBuffer: StoredFeedDocument[]
  nextPullBuffer: StoredFeedDocument[]
} {
  const orderedCandidates = [...candidates].sort((left, right) =>
    compareFeedDocuments(left.document, right.document),
  )

  const entries: StoredFeedDocument[] = []
  const nextFeedBuffer: StoredFeedDocument[] = []
  const nextPullBuffer: StoredFeedDocument[] = []
  const seenKeys = new Set<string>()

  orderedCandidates.forEach((candidate, index) => {
    const candidateKey = resolveFeedCandidateKey(candidate, index)
    if (seenKeys.has(candidateKey)) {
      return
    }

    seenKeys.add(candidateKey)

    if (entries.length < DEFAULT_FEED_PAGE_SIZE) {
      entries.push(candidate.document)
      return
    }

    if (candidate.source === 'feed') {
      nextFeedBuffer.push(candidate.document)
      return
    }

    nextPullBuffer.push(candidate.document)
  })

  return {
    entries,
    nextFeedBuffer,
    nextPullBuffer,
  }
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

  const rawCursor = toNullableString(request.cursor) ?? undefined
  const cursorState = parseFeedCursorState(rawCursor)
  const pullOnReadSupported =
    typeof store.listPullOnReadFeedEntries === 'function'
  const feedBuffer = [...cursorState.feedBuffer]
  const pullBuffer = [...cursorState.pullBuffer]
  let feedCursor = cursorState.feedCursor
  let pullCursor = cursorState.pullCursor

  if (
    feedBuffer.length < DEFAULT_FEED_PAGE_SIZE &&
    (feedCursor !== undefined || feedBuffer.length === 0)
  ) {
    const page = await store.listFeedEntries(feedOwnerId, {
      limit: DEFAULT_FEED_PAGE_SIZE,
      ...(feedCursor === undefined ? {} : { cursor: feedCursor }),
    })

    feedBuffer.push(...page.entries)
    feedCursor = page.cursor
  }

  if (
    pullOnReadSupported &&
    pullBuffer.length < DEFAULT_FEED_PAGE_SIZE &&
    (pullCursor !== undefined || pullBuffer.length === 0)
  ) {
    const page = await store.listPullOnReadFeedEntries!(feedOwnerId, {
      limit: DEFAULT_FEED_PAGE_SIZE,
      ...(pullCursor === undefined ? {} : { cursor: pullCursor }),
    })

    pullBuffer.push(...page.entries)
    pullCursor = page.cursor
  }

  const mergedPage = mergeFeedCandidates([
    ...feedBuffer.map(
      (document): FeedCandidate => ({
        document,
        source: 'feed',
      }),
    ),
    ...pullBuffer.map(
      (document): FeedCandidate => ({
        document,
        source: 'pull',
      }),
    ),
  ])

  return {
    status: 200,
    body: {
      data: mergedPage.entries
        .map((entry) => buildFeedEntry(entry))
        .filter((entry): entry is FeedEntry => entry !== null),
      cursor:
        buildFeedCursor(
          {
            feedBuffer: mergedPage.nextFeedBuffer,
            ...(feedCursor === undefined ? {} : { feedCursor }),
            pullBuffer: mergedPage.nextPullBuffer,
            ...(pullCursor === undefined ? {} : { pullCursor }),
          },
          !pullOnReadSupported,
        ) ?? null,
      errors: [],
    },
  }
}
