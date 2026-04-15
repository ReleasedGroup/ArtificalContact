import type { StoredPostDocument } from './posts.js'

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface ReactionCounterSummary {
  likes: number
  dislikes: number
  emoji: number
}

export interface ReactionCounterStore {
  getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null>
  getReactionSummary(postId: string): Promise<ReactionCounterSummary>
  setReactionCounts(
    postId: string,
    threadId: string,
    counts: ReactionCounterSummary & {
      replies: number
    },
  ): Promise<void>
}

export interface ReactionCounterSourceDocument {
  id?: string | null
  type?: string | null
  postId?: string | null
}

export interface ReactionCounterWorkItem {
  postId: string
  reactionId: string
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

function collapseReactionChangesToLatest(
  documents: readonly ReactionCounterSourceDocument[],
): ReactionCounterSourceDocument[] {
  const latestById = new Map<string, ReactionCounterSourceDocument>()

  for (const document of documents) {
    const reactionId = toNonEmptyString(document.id)
    if (reactionId === null) {
      continue
    }

    latestById.set(reactionId, document)
  }

  return [...latestById.values()]
}

function buildReactionCounterWorkItem(
  document: ReactionCounterSourceDocument,
): ReactionCounterWorkItem | null {
  const reactionId = toNonEmptyString(document.id)
  const type = toNonEmptyString(document.type)
  const postId = toNonEmptyString(document.postId)

  if (reactionId === null || type !== 'reaction' || postId === null) {
    return null
  }

  return {
    postId,
    reactionId,
  }
}

export async function syncReactionCountersBatch(
  documents: readonly ReactionCounterSourceDocument[],
  store: ReactionCounterStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const impactedPosts = new Map<string, ReactionCounterWorkItem>()

  for (const document of collapseReactionChangesToLatest(documents)) {
    const workItem = buildReactionCounterWorkItem(document)

    if (workItem === null) {
      continue
    }

    impactedPosts.set(workItem.postId, workItem)
  }

  for (const workItem of impactedPosts.values()) {
    const post = await store.getPostById(workItem.postId)

    if (post === null) {
      logger.warn(
        "Skipping reaction counter sync for reaction '%s' because post '%s' was not found.",
        workItem.reactionId,
        workItem.postId,
      )
      continue
    }

    const nextCounts = await store.getReactionSummary(workItem.postId)
    const currentLikes = toNonNegativeInteger(post.counters?.likes)
    const currentDislikes = toNonNegativeInteger(post.counters?.dislikes)
    const currentEmoji = toNonNegativeInteger(post.counters?.emoji)

    if (
      currentLikes === nextCounts.likes &&
      currentDislikes === nextCounts.dislikes &&
      currentEmoji === nextCounts.emoji
    ) {
      continue
    }

    await store.setReactionCounts(
      post.id,
      toNonEmptyString(post.threadId) ?? post.id,
      {
        ...nextCounts,
        replies: toNonNegativeInteger(post.counters?.replies),
      },
    )

    logger.info(
      "Updated reaction counters for post '%s' from likes=%d/dislikes=%d/emoji=%d to likes=%d/dislikes=%d/emoji=%d.",
      post.id,
      currentLikes,
      currentDislikes,
      currentEmoji,
      nextCounts.likes,
      nextCounts.dislikes,
      nextCounts.emoji,
    )
  }
}
