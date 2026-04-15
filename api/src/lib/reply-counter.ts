import type { StoredPostDocument } from './posts.js'

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface ReplyCounterStore {
  getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null>
  countActiveReplies(threadId: string, parentId: string): Promise<number>
  setReplyCount(
    postId: string,
    threadId: string,
    replyCount: number,
  ): Promise<void>
}

export interface ReplyCounterSourceDocument {
  id?: string | null
  type?: string | null
  threadId?: string | null
  parentId?: string | null
  deletedAt?: string | null
}

export interface ReplyCounterWorkItem {
  parentId: string
  replyId: string
  threadId: string
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

function collapseReplyChangesToLatest(
  documents: readonly ReplyCounterSourceDocument[],
): ReplyCounterSourceDocument[] {
  const latestById = new Map<string, ReplyCounterSourceDocument>()

  for (const document of documents) {
    const replyId = toNonEmptyString(document.id)
    if (replyId === null) {
      continue
    }

    latestById.set(replyId, document)
  }

  return [...latestById.values()]
}

function buildReplyCounterWorkItem(
  document: ReplyCounterSourceDocument,
): ReplyCounterWorkItem | null {
  const replyId = toNonEmptyString(document.id)
  const type = toNonEmptyString(document.type)
  const threadId = toNonEmptyString(document.threadId)
  const parentId = toNonEmptyString(document.parentId)

  if (
    replyId === null ||
    type !== 'reply' ||
    threadId === null ||
    parentId === null
  ) {
    return null
  }

  return {
    parentId,
    replyId,
    threadId,
  }
}

function buildParentKey(workItem: ReplyCounterWorkItem): string {
  return `${workItem.threadId}:${workItem.parentId}`
}

export async function syncReplyCountersBatch(
  documents: readonly ReplyCounterSourceDocument[],
  store: ReplyCounterStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const impactedParents = new Map<string, ReplyCounterWorkItem>()

  for (const document of collapseReplyChangesToLatest(documents)) {
    const workItem = buildReplyCounterWorkItem(document)

    if (workItem === null) {
      continue
    }

    impactedParents.set(buildParentKey(workItem), workItem)
  }

  for (const workItem of impactedParents.values()) {
    const parentPost = await store.getPostById(
      workItem.parentId,
      workItem.threadId,
    )

    if (parentPost === null) {
      logger.warn(
        "Skipping reply counter sync for reply '%s' because parent '%s' was not found in thread '%s'.",
        workItem.replyId,
        workItem.parentId,
        workItem.threadId,
      )
      continue
    }

    const activeReplyCount = await store.countActiveReplies(
      workItem.threadId,
      workItem.parentId,
    )
    const currentReplyCount = toNonNegativeInteger(parentPost.counters?.replies)

    if (currentReplyCount === activeReplyCount) {
      continue
    }

    await store.setReplyCount(
      parentPost.id,
      workItem.threadId,
      activeReplyCount,
    )

    logger.info(
      "Updated replies counter for parent '%s' in thread '%s' from %d to %d.",
      workItem.parentId,
      workItem.threadId,
      currentReplyCount,
      activeReplyCount,
    )
  }
}
