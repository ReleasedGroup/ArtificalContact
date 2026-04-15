import type { StoredPostDocument } from './posts.js'
import type { UserDocument } from './users.js'

export interface UserPostAuthorSyncStore {
  listPostsByAuthorId(authorId: string): Promise<StoredPostDocument[]>
  upsertPost(post: StoredPostDocument): Promise<StoredPostDocument>
}

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

const noop = (): void => undefined

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function collapseUsersToLatest(
  users: readonly UserDocument[],
  logger: LoggerLike,
): UserDocument[] {
  const latestById = new Map<string, UserDocument>()

  for (const user of users) {
    if (!isNonEmptyString(user.id)) {
      logger.warn(
        'Skipping post author denormalization sync for a user document without an id.',
      )
      continue
    }

    latestById.set(user.id, user)
  }

  return [...latestById.values()]
}

function resolveAuthorHandle(user: UserDocument): string | null {
  return toNullableString(user.handle) ?? toNullableString(user.handleLower)
}

function applyAuthorDenormalizations(
  post: StoredPostDocument,
  user: UserDocument,
): StoredPostDocument | null {
  const nextAuthorHandle = resolveAuthorHandle(user)
  const nextAuthorDisplayName = toNullableString(user.displayName)
  const nextAuthorAvatarUrl = toNullableString(user.avatarUrl)

  const currentAuthorHandle = toNullableString(post.authorHandle)
  const currentAuthorDisplayName = toNullableString(post.authorDisplayName)
  const currentAuthorAvatarUrl = toNullableString(post.authorAvatarUrl)

  if (
    currentAuthorHandle === nextAuthorHandle &&
    currentAuthorDisplayName === nextAuthorDisplayName &&
    currentAuthorAvatarUrl === nextAuthorAvatarUrl
  ) {
    return null
  }

  const nextPost: StoredPostDocument = {
    ...post,
    authorHandle: nextAuthorHandle,
    authorDisplayName: nextAuthorDisplayName,
  }

  if (nextAuthorAvatarUrl === null) {
    delete nextPost.authorAvatarUrl
  } else {
    nextPost.authorAvatarUrl = nextAuthorAvatarUrl
  }

  return nextPost
}

export async function syncUserPostAuthorDenormalizationsBatch(
  users: readonly UserDocument[],
  store: UserPostAuthorSyncStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const collapsedUsers = collapseUsersToLatest(users, logger)

  for (const user of collapsedUsers) {
    const posts = await store.listPostsByAuthorId(user.id)
    let updatedPostCount = 0

    for (const post of posts) {
      const updatedPost = applyAuthorDenormalizations(post, user)
      if (updatedPost === null) {
        continue
      }

      await store.upsertPost(updatedPost)
      updatedPostCount += 1
    }

    logger.info(
      "Refreshed author denormalizations on %d post(s) for user '%s'.",
      updatedPostCount,
      user.id,
    )
  }
}
