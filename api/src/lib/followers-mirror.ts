import { buildFollowDocumentId, type FollowDocument } from './follows.js'

export { DEFAULT_FOLLOWERS_CONTAINER_NAME } from './follows.js'

export interface FollowersMirrorSourceDocument {
  id?: string | null
  type?: string | null
  followerId?: string | null
  followedId?: string | null
  createdAt?: string | null
  deletedAt?: string | null
}

export type FollowersMirrorDocument = FollowDocument

export type ExistingFollowersMirrorRecord = FollowersMirrorDocument

export interface FollowersMirrorStore {
  getByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<ExistingFollowersMirrorRecord | null>
  upsertMirror(document: FollowersMirrorDocument): Promise<void>
  deleteMirror(followerId: string, followedId: string): Promise<void>
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

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type FollowersMirrorWorkItem =
  | {
      action: 'upsert'
      document: FollowersMirrorDocument
      followerId: string
      followedId: string
      id: string
    }
  | {
      action: 'delete'
      followerId: string
      followedId: string
      id: string
    }

export function buildFollowersMirrorDocument(
  document: FollowersMirrorSourceDocument,
): FollowersMirrorDocument | null {
  const type = toNonEmptyString(document.type)
  if (type !== null && type !== 'follow') {
    return null
  }

  const followerId = toNonEmptyString(document.followerId)
  const followedId = toNonEmptyString(document.followedId)
  const createdAt = toNonEmptyString(document.createdAt)

  if (followerId === null || followedId === null || createdAt === null) {
    return null
  }

  return {
    id: buildFollowDocumentId(followerId, followedId),
    type: 'follow',
    followerId,
    followedId,
    createdAt,
  }
}

function collapseFollowChangesToLatest(
  documents: readonly FollowersMirrorSourceDocument[],
  logger: LoggerLike,
): FollowersMirrorWorkItem[] {
  const latestById = new Map<string, FollowersMirrorWorkItem>()

  for (const document of documents) {
    const type = toNonEmptyString(document.type)
    if (type !== null && type !== 'follow') {
      logger.warn('Skipping followers mirror sync for an invalid follow document.')
      continue
    }

    const followerId = toNonEmptyString(document.followerId)
    const followedId = toNonEmptyString(document.followedId)
    if (followerId === null || followedId === null) {
      logger.warn('Skipping followers mirror sync for an invalid follow document.')
      continue
    }

    const id = buildFollowDocumentId(followerId, followedId)
    if (toNonEmptyString(document.deletedAt) !== null) {
      latestById.set(id, {
        action: 'delete',
        followerId,
        followedId,
        id,
      })
      continue
    }

    const mirrorDocument = buildFollowersMirrorDocument(document)
    if (mirrorDocument === null) {
      logger.warn('Skipping followers mirror sync for an invalid follow document.')
      continue
    }

    latestById.set(id, {
      action: 'upsert',
      document: mirrorDocument,
      followerId,
      followedId,
      id,
    })
  }

  return [...latestById.values()]
}

function isMirrorSynchronized(
  existing: ExistingFollowersMirrorRecord | null,
  nextDocument: FollowersMirrorDocument,
): boolean {
  return (
    existing?.id === nextDocument.id &&
    existing.type === nextDocument.type &&
    existing.followerId === nextDocument.followerId &&
    existing.followedId === nextDocument.followedId &&
    existing.createdAt === nextDocument.createdAt
  )
}

export async function syncFollowersMirrorBatch(
  documents: readonly FollowersMirrorSourceDocument[],
  store: FollowersMirrorStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const collapsedDocuments = collapseFollowChangesToLatest(documents, logger)

  for (const workItem of collapsedDocuments) {
    const existingMirror = await store.getByFollowerAndFollowed(
      workItem.followerId,
      workItem.followedId,
    )

    if (workItem.action === 'delete') {
      if (existingMirror === null) {
        continue
      }

      await store.deleteMirror(workItem.followerId, workItem.followedId)
      logger.info(
        "Deleted followers mirror '%s' for follower '%s' under followed user '%s'.",
        workItem.id,
        workItem.followerId,
        workItem.followedId,
      )
      continue
    }

    if (isMirrorSynchronized(existingMirror, workItem.document)) {
      continue
    }

    await store.upsertMirror(workItem.document)
    logger.info(
      "Upserted followers mirror '%s' for follower '%s' under followed user '%s'.",
      workItem.document.id,
      workItem.document.followerId,
      workItem.document.followedId,
    )
  }
}
