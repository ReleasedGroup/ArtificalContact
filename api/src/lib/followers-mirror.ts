import { buildFollowDocumentId, type FollowDocument } from './follows.js'

export { DEFAULT_FOLLOWERS_CONTAINER_NAME } from './follows.js'

export interface FollowersMirrorSourceDocument {
  id?: string | null
  type?: string | null
  followerId?: string | null
  followedId?: string | null
  createdAt?: string | null
}

export type FollowersMirrorDocument = FollowDocument

export type ExistingFollowersMirrorRecord = FollowersMirrorDocument

export interface FollowersMirrorStore {
  getByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<ExistingFollowersMirrorRecord | null>
  upsertMirror(document: FollowersMirrorDocument): Promise<void>
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
): FollowersMirrorDocument[] {
  const latestById = new Map<string, FollowersMirrorDocument>()

  for (const document of documents) {
    const mirrorDocument = buildFollowersMirrorDocument(document)

    if (mirrorDocument === null) {
      logger.warn('Skipping followers mirror sync for an invalid follow document.')
      continue
    }

    latestById.set(mirrorDocument.id, mirrorDocument)
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

  for (const mirrorDocument of collapsedDocuments) {
    const existingMirror = await store.getByFollowerAndFollowed(
      mirrorDocument.followerId,
      mirrorDocument.followedId,
    )

    if (isMirrorSynchronized(existingMirror, mirrorDocument)) {
      continue
    }

    await store.upsertMirror(mirrorDocument)
    logger.info(
      "Upserted followers mirror '%s' for follower '%s' under followed user '%s'.",
      mirrorDocument.id,
      mirrorDocument.followerId,
      mirrorDocument.followedId,
    )
  }
}
