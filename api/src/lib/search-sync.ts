import type { StoredPostDocument } from './posts.js'
import { type UserDocument } from './users.js'
import { normalizeHandleLower } from './users-by-handle-mirror.js'

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const noop = (): void => undefined

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
  error: noop,
}

export const DEFAULT_SEARCH_POSTS_INDEX_NAME = 'posts-v1'
export const DEFAULT_SEARCH_USERS_INDEX_NAME = 'users-v1'

const nonDeletedPostStates = new Set<string>(['ok'])

export interface SearchPostIndexDocument {
  id: string
  authorId: string
  authorHandle: string
  text: string
  hashtags: string[]
  mediaKinds: string[]
  createdAt: string
  visibility: string
  moderationState: string
  likeCount: number
  replyCount: number
  kind: string
  githubEventType?: string
  githubRepo?: string
}

export interface SearchUserIndexDocument {
  id: string
  handle: string
  handleLower: string
  displayName: string
  bio: string
  expertise: string[]
  followerCount: number
  status: string
}

export interface SearchSyncStore {
  upsertPosts(documents: SearchPostIndexDocument[]): Promise<void>
  deletePosts(ids: string[]): Promise<void>
  upsertUsers(documents: SearchUserIndexDocument[]): Promise<void>
  deleteUsers(ids: string[]): Promise<void>
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.trunc(value)
}

function collapseById<T extends { id?: string | null }>(
  documents: readonly T[],
  logger: LoggerLike,
  resourceName: string,
): T[] {
  const latestById = new Map<string, T>()

  for (const document of documents) {
    if (typeof document.id !== 'string' || document.id.trim().length === 0) {
      logger.warn(`Skipping ${resourceName} without a valid id for search sync.`)
      continue
    }

    latestById.set(document.id, document)
  }

  return [...latestById.values()]
}

function extractMediaKinds(media: unknown): string[] {
  if (!Array.isArray(media)) {
    return []
  }

  const mediaKinds = new Set<string>()
  for (const item of media) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const rawKind = toNullableString((item as { kind?: unknown }).kind)
    if (rawKind === null) {
      continue
    }

    mediaKinds.add(rawKind)
  }

  return [...mediaKinds]
}

function extractUniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const uniqueValues = new Set<string>()
  for (const value of values) {
    const normalizedValue = toNullableString(value)
    if (normalizedValue === null) {
      continue
    }

    uniqueValues.add(normalizedValue)
  }

  return [...uniqueValues]
}

function shouldDeletePost(post: StoredPostDocument): boolean {
  if (toNullableString(post.deletedAt) !== null) {
    return true
  }

  const moderationState = toNullableString(post.moderationState)
  if (moderationState === null) {
    return false
  }

  return moderationState !== 'ok' && !nonDeletedPostStates.has(moderationState)
}

function buildGitHubRepo(owner: unknown, repo: unknown): string | null {
  const normalizedOwner = toNullableString(owner)
  const normalizedRepo = toNullableString(repo)

  if (normalizedOwner === null || normalizedRepo === null) {
    return null
  }

  return `${normalizedOwner}/${normalizedRepo}`
}

function buildSearchPostIndexDocument(
  post: StoredPostDocument,
): SearchPostIndexDocument {
  const kind = toNullableString(post.kind) ?? 'user'
  const githubEventType = toNullableString(post.github?.eventType)
  const githubRepo = buildGitHubRepo(post.github?.owner, post.github?.name)
  const authorId = toNullableString(post.authorId) ?? ''
  const authorHandle = toNullableString(post.authorHandle) ?? ''

  const document: SearchPostIndexDocument = {
    id: post.id,
    authorId,
    authorHandle,
    text: toNullableString(post.text) ?? '',
    hashtags: extractUniqueStrings(post.hashtags ?? []),
    mediaKinds: extractMediaKinds(post.media),
    createdAt: toNullableString(post.createdAt) ?? new Date().toISOString(),
    visibility: toNullableString(post.visibility) ?? 'public',
    moderationState: toNullableString(post.moderationState) ?? 'ok',
    likeCount: toNonNegativeInteger(post.counters?.likes),
    replyCount: toNonNegativeInteger(post.counters?.replies),
    kind,
  }

  if (kind === 'github') {
    if (githubEventType !== null) {
      document.githubEventType = githubEventType
    }

    if (githubRepo !== null) {
      document.githubRepo = githubRepo
    }
  }

  return document
}

function buildSearchUserIndexDocument(
  user: UserDocument,
): SearchUserIndexDocument | null {
  const handleLower = normalizeHandleLower(user)
  const id = toNullableString(user.id)
  if (id === null || handleLower === null) {
    return null
  }

  return {
    id,
    handle: handleLower,
    handleLower,
    displayName: toNullableString(user.displayName) ?? '',
    bio: toNullableString(user.bio) ?? '',
    expertise: extractUniqueStrings(user.expertise ?? []),
    followerCount: toNonNegativeInteger(user.counters?.followers),
    status: toNullableString(user.status) ?? 'active',
  }
}

export async function syncSearchPostsBatch(
  documents: readonly StoredPostDocument[],
  store: SearchSyncStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const collapsed = collapseById(documents, logger, 'post')
  const postsToDelete: string[] = []
  const postsToUpsert: SearchPostIndexDocument[] = []

  for (const document of collapsed) {
    if (shouldDeletePost(document)) {
      postsToDelete.push(document.id)
      continue
    }

    postsToUpsert.push(buildSearchPostIndexDocument(document))
  }

  if (postsToUpsert.length > 0) {
    await store.upsertPosts(postsToUpsert)
    logger.info('Synced %d posts to Azure AI Search.', postsToUpsert.length)
  }

  if (postsToDelete.length > 0) {
    await store.deletePosts(postsToDelete)
    logger.info('Deleted %d posts from Azure AI Search.', postsToDelete.length)
  }
}

export async function syncSearchUsersBatch(
  documents: readonly UserDocument[],
  store: SearchSyncStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const collapsed = collapseById(documents, logger, 'user')
  const usersToUpsert: SearchUserIndexDocument[] = []
  const usersToDelete: string[] = []

  for (const document of collapsed) {
    const searchUser = buildSearchUserIndexDocument(document)
    if (searchUser === null) {
      const userId = toNullableString(document.id)
      if (userId !== null) {
        usersToDelete.push(userId)
      }
      continue
    }

    usersToUpsert.push(searchUser)
  }

  if (usersToUpsert.length > 0) {
    await store.upsertUsers(usersToUpsert)
    logger.info('Synced %d users to Azure AI Search.', usersToUpsert.length)
  }

  if (usersToDelete.length > 0) {
    await store.deleteUsers(usersToDelete)
    logger.info('Deleted %d users from Azure AI Search.', usersToDelete.length)
  }
}
