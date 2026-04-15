import { buildFollowDocumentId } from './follows.js'
import type { StoredUserDocument } from './user-profile.js'

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface FollowCounterStore {
  getUserById(userId: string): Promise<StoredUserDocument | null>
  countActiveFollowers(userId: string): Promise<number>
  countActiveFollowing(userId: string): Promise<number>
  setFollowCounts(
    userId: string,
    counts: {
      followers: number
      following: number
      posts: number
    },
  ): Promise<void>
}

export interface FollowCounterSourceDocument {
  id?: string | null
  type?: string | null
  followerId?: string | null
  followedId?: string | null
  deletedAt?: string | null
}

interface FollowCounterWorkItem {
  followerId: string
  followedId: string
  id: string
}

const noop = (): void => undefined

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
  error: noop,
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0
}

function buildFollowCounterWorkItem(
  document: FollowCounterSourceDocument,
): FollowCounterWorkItem | null {
  const type = toNonEmptyString(document.type)
  const followerId = toNonEmptyString(document.followerId)
  const followedId = toNonEmptyString(document.followedId)

  if (type !== 'follow' || followerId === null || followedId === null) {
    return null
  }

  return {
    followerId,
    followedId,
    id: buildFollowDocumentId(followerId, followedId),
  }
}

function collapseFollowChangesToLatest(
  documents: readonly FollowCounterSourceDocument[],
): FollowCounterWorkItem[] {
  const latestById = new Map<string, FollowCounterWorkItem>()

  for (const document of documents) {
    const workItem = buildFollowCounterWorkItem(document)

    if (workItem === null) {
      continue
    }

    latestById.set(workItem.id, workItem)
  }

  return [...latestById.values()]
}

export async function syncFollowCountersBatch(
  documents: readonly FollowCounterSourceDocument[],
  store: FollowCounterStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const impactedUserIds = new Set<string>()

  for (const workItem of collapseFollowChangesToLatest(documents)) {
    impactedUserIds.add(workItem.followerId)
    impactedUserIds.add(workItem.followedId)
  }

  for (const userId of impactedUserIds) {
    const user = await store.getUserById(userId)

    if (user === null) {
      logger.warn(
        "Skipping follow counter sync because user '%s' was not found.",
        userId,
      )
      continue
    }

    const followers = await store.countActiveFollowers(userId)
    const following = await store.countActiveFollowing(userId)
    const currentFollowers = toNonNegativeInteger(user.counters?.followers)
    const currentFollowing = toNonNegativeInteger(user.counters?.following)

    if (currentFollowers === followers && currentFollowing === following) {
      continue
    }

    await store.setFollowCounts(userId, {
      followers,
      following,
      posts: toNonNegativeInteger(user.counters?.posts),
    })

    logger.info(
      "Updated follow counters for user '%s' from followers=%d/following=%d to followers=%d/following=%d.",
      userId,
      currentFollowers,
      currentFollowing,
      followers,
      following,
    )
  }
}
