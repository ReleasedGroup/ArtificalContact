import type { ApiEnvelope } from './api-envelope.js'

export const DEFAULT_THREAD_PAGE_SIZE = 50
export const MAX_THREAD_PAGE_SIZE = 100

export interface StoredPostMediaDocument {
  id?: string | null
  kind?: string | null
  url?: string | null
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
}

export interface StoredGitHubPostDocument {
  repoId?: string | null
  owner?: string | null
  name?: string | null
  eventType?: string | null
  eventId?: string | null
  number?: number | null
  tag?: string | null
  state?: string | null
  actorLogin?: string | null
  actorAvatarUrl?: string | null
  url?: string | null
  bodyExcerpt?: string | null
  labels?: string[] | null
  githubCreatedAt?: string | null
  githubUpdatedAt?: string | null
}

export interface StoredPostDocument {
  id?: string | null
  type?: string | null
  kind?: string | null
  threadId?: string | null
  parentId?: string | null
  authorId?: string | null
  authorHandle?: string | null
  authorDisplayName?: string | null
  authorAvatarUrl?: string | null
  text?: string | null
  hashtags?: string[] | null
  mentions?: string[] | null
  media?: StoredPostMediaDocument[] | null
  counters?: {
    likes?: number | null
    dislikes?: number | null
    emoji?: number | null
    replies?: number | null
  } | null
  createdAt?: string | null
  updatedAt?: string | null
  github?: StoredGitHubPostDocument | null
}

export interface ThreadPostMedia {
  id: string
  kind: string
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
}

export interface ThreadGitHubPost {
  repoId: string | null
  owner: string | null
  name: string | null
  eventType: string | null
  eventId: string | null
  number: number | null
  tag: string | null
  state: string | null
  actorLogin: string | null
  actorAvatarUrl: string | null
  url: string | null
  bodyExcerpt: string | null
  labels: string[]
  githubCreatedAt: string | null
  githubUpdatedAt: string | null
}

export interface ThreadPost {
  id: string
  type: 'post' | 'reply'
  kind: 'user' | 'github'
  threadId: string
  parentId: string | null
  authorId: string | null
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  text: string | null
  hashtags: string[]
  mentions: string[]
  media: ThreadPostMedia[]
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  createdAt: string | null
  updatedAt: string | null
  github?: ThreadGitHubPost
}

export interface ThreadPage {
  threadId: string
  posts: ThreadPost[]
  continuationToken: string | null
}

export interface ThreadPageRequest {
  threadId: string | undefined
  limit?: string | undefined
  continuationToken?: string | undefined
}

export interface ThreadStore {
  listThreadPosts(
    threadId: string,
    options: {
      limit: number
      continuationToken?: string
    },
  ): Promise<{
    posts: StoredPostDocument[]
    continuationToken?: string
  }>
}

export interface ThreadLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<ThreadPage | null>
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => toNullableString(item))
    .filter((item): item is string => item !== null)
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeThreadPageLimit(limit: string | undefined): number | null {
  const normalizedLimit = toNullableString(limit)
  if (normalizedLimit === null) {
    return DEFAULT_THREAD_PAGE_SIZE
  }

  if (!/^\d+$/.test(normalizedLimit)) {
    return null
  }

  const parsedLimit = Number.parseInt(normalizedLimit, 10)
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_THREAD_PAGE_SIZE
  ) {
    return null
  }

  return parsedLimit
}

function buildThreadPostMedia(
  media: StoredPostMediaDocument,
): ThreadPostMedia | null {
  const id = toNullableString(media.id)
  const kind = toNullableString(media.kind)
  const url = toNullableString(media.url)

  if (id === null || kind === null || url === null) {
    return null
  }

  return {
    id,
    kind,
    url,
    thumbUrl: toNullableString(media.thumbUrl),
    width: toNullableNumber(media.width),
    height: toNullableNumber(media.height),
  }
}

function buildThreadGitHubPost(
  githubPost: StoredGitHubPostDocument | null | undefined,
): ThreadGitHubPost | undefined {
  if (githubPost === null || githubPost === undefined) {
    return undefined
  }

  return {
    repoId: toNullableString(githubPost.repoId),
    owner: toNullableString(githubPost.owner),
    name: toNullableString(githubPost.name),
    eventType: toNullableString(githubPost.eventType),
    eventId: toNullableString(githubPost.eventId),
    number:
      typeof githubPost.number === 'number' &&
      Number.isFinite(githubPost.number) &&
      Number.isInteger(githubPost.number)
        ? githubPost.number
        : null,
    tag: toNullableString(githubPost.tag),
    state: toNullableString(githubPost.state),
    actorLogin: toNullableString(githubPost.actorLogin),
    actorAvatarUrl: toNullableString(githubPost.actorAvatarUrl),
    url: toNullableString(githubPost.url),
    bodyExcerpt: toNullableString(githubPost.bodyExcerpt),
    labels: toStringArray(githubPost.labels),
    githubCreatedAt: toNullableString(githubPost.githubCreatedAt),
    githubUpdatedAt: toNullableString(githubPost.githubUpdatedAt),
  }
}

export function buildThreadPost(post: StoredPostDocument): ThreadPost | null {
  const id = toNullableString(post.id)
  const threadId = toNullableString(post.threadId)

  if (id === null || threadId === null) {
    return null
  }

  const github = buildThreadGitHubPost(post.github)

  return {
    id,
    type: toNullableString(post.type) === 'reply' ? 'reply' : 'post',
    kind: toNullableString(post.kind) === 'github' ? 'github' : 'user',
    threadId,
    parentId: toNullableString(post.parentId),
    authorId: toNullableString(post.authorId),
    authorHandle: toNullableString(post.authorHandle),
    authorDisplayName: toNullableString(post.authorDisplayName),
    authorAvatarUrl: toNullableString(post.authorAvatarUrl),
    text: toNullableString(post.text),
    hashtags: toStringArray(post.hashtags),
    mentions: toStringArray(post.mentions),
    media: (post.media ?? [])
      .map((media) => buildThreadPostMedia(media))
      .filter((media): media is ThreadPostMedia => media !== null),
    counters: {
      likes: toNonNegativeNumber(post.counters?.likes),
      dislikes: toNonNegativeNumber(post.counters?.dislikes),
      emoji: toNonNegativeNumber(post.counters?.emoji),
      replies: toNonNegativeNumber(post.counters?.replies),
    },
    createdAt: toNullableString(post.createdAt),
    updatedAt: toNullableString(post.updatedAt),
    ...(github === undefined ? {} : { github }),
  }
}

export async function lookupThread(
  request: ThreadPageRequest,
  store: ThreadStore,
): Promise<ThreadLookupResult> {
  const threadId = toNullableString(request.threadId)
  if (threadId === null) {
    return {
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_thread_id',
            message: 'The threadId path parameter is required.',
            field: 'threadId',
          },
        ],
      },
    }
  }

  const limit = normalizeThreadPageLimit(request.limit)
  if (limit === null) {
    return {
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_limit',
            message: `The limit query parameter must be an integer between 1 and ${MAX_THREAD_PAGE_SIZE}.`,
            field: 'limit',
          },
        ],
      },
    }
  }

  const continuationToken = toNullableString(request.continuationToken) ?? undefined
  const page = await store.listThreadPosts(threadId, {
    limit,
    ...(continuationToken === undefined ? {} : { continuationToken }),
  })
  const posts = page.posts
    .map((post) => buildThreadPost(post))
    .filter((post): post is ThreadPost => post !== null)

  if (continuationToken === undefined) {
    const hasRootPost = posts.some(
      (post) => post.id === threadId && post.parentId === null,
    )

    if (posts.length === 0 || !hasRootPost) {
      return {
        status: 404,
        body: {
          data: null,
          errors: [
            {
              code: 'thread_not_found',
              message: 'No public thread exists for the requested thread id.',
              field: 'threadId',
            },
          ],
        },
      }
    }
  }

  return {
    status: 200,
    body: {
      data: {
        threadId,
        posts,
        continuationToken: page.continuationToken ?? null,
      },
      errors: [],
    },
  }
}
