export const DEFAULT_COSMOS_DATABASE_NAME = 'acn'
export const DEFAULT_USERS_CONTAINER_NAME = 'users'
export const DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME = 'usersByHandle'
export const DEFAULT_COSMOS_LEASE_CONTAINER_NAME = 'leases'

const userHandleStatePrefix = '__usersByHandleState__:'

export interface UserDocument {
  id?: string | null
  handle?: string | null
  handleLower?: string | null
}

export interface UsersByHandleMirrorDocument {
  id: string
  type: 'usersByHandle'
  handle: string
  userId: string
}

export interface UsersByHandleMirrorStateDocument {
  id: string
  type: 'usersByHandleState'
  handle: string
  userId: string
  currentHandle: string | null
}

export interface ExistingMirrorRecord {
  id: string
  handle: string
  userId: string
}

export interface ExistingUserHandleState {
  id: string
  handle: string
  userId: string
  currentHandle: string | null
}

export interface UsersByHandleMirrorStore {
  getByHandle(handle: string): Promise<ExistingMirrorRecord | null>
  getStateByUserId(userId: string): Promise<ExistingUserHandleState | null>
  upsertMirror(document: UsersByHandleMirrorDocument): Promise<void>
  upsertState(document: UsersByHandleMirrorStateDocument): Promise<void>
  deleteByHandle(handle: string): Promise<void>
  deleteStateByUserId(userId: string): Promise<void>
}

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

export function buildUserHandleStateId(userId: string): string {
  return `${userHandleStatePrefix}${userId}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeHandleLower(user: UserDocument): string | null {
  const rawHandle = isNonEmptyString(user.handleLower)
    ? user.handleLower
    : isNonEmptyString(user.handle)
      ? user.handle
      : null

  if (rawHandle === null) {
    return null
  }

  const normalized = rawHandle.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

export function collapseUsersToLatest(users: readonly UserDocument[]): UserDocument[] {
  const latestById = new Map<string, UserDocument>()

  for (const user of users) {
    if (!isNonEmptyString(user.id)) {
      continue
    }

    latestById.set(user.id, user)
  }

  return [...latestById.values()]
}

export function buildMirrorDocument(
  user: UserDocument,
): UsersByHandleMirrorDocument | null {
  if (!isNonEmptyString(user.id)) {
    return null
  }

  const handleLower = normalizeHandleLower(user)
  if (handleLower === null) {
    return null
  }

  return {
    id: handleLower,
    type: 'usersByHandle',
    handle: handleLower,
    userId: user.id,
  }
}

function buildUserHandleStateDocument(
  userId: string,
  currentHandle: string,
): UsersByHandleMirrorStateDocument {
  const stateId = buildUserHandleStateId(userId)

  return {
    id: stateId,
    type: 'usersByHandleState',
    handle: stateId,
    userId,
    currentHandle,
  }
}

export async function syncUsersByHandleBatch(
  users: readonly UserDocument[],
  store: UsersByHandleMirrorStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const collapsedUsers = collapseUsersToLatest(users)

  for (const user of collapsedUsers) {
    if (!isNonEmptyString(user.id)) {
      logger.warn('Skipping usersByHandle sync for a document without an id.')
      continue
    }

    const userId = user.id
    const currentHandle = normalizeHandleLower(user)
    const existingState = await store.getStateByUserId(userId)
    const previousHandle = existingState?.currentHandle ?? null

    if (currentHandle === null) {
      if (previousHandle !== null) {
        await store.deleteByHandle(previousHandle)
        await store.deleteStateByUserId(userId)
        logger.info(
          "Deleted usersByHandle mirror '%s' for user '%s' because the source handle is no longer set.",
          previousHandle,
          userId,
        )
      }

      logger.warn(
        "Skipping usersByHandle upsert for user '%s' because no handle is set.",
        userId,
      )
      continue
    }

    const existingHandle = await store.getByHandle(currentHandle)
    if (existingHandle !== null && existingHandle.userId !== userId) {
      if (previousHandle !== null) {
        if (previousHandle !== currentHandle) {
          await store.deleteByHandle(previousHandle)
          logger.warn(
            "Deleted stale usersByHandle mirror '%s' for user '%s' after a handle collision prevented claiming '%s'.",
            previousHandle,
            userId,
            currentHandle,
          )
        }

        await store.deleteStateByUserId(userId)
      }

      logger.error(
        "Handle collision detected for '%s': it already belongs to user '%s'. Skipping usersByHandle sync for user '%s'.",
        currentHandle,
        existingHandle.userId,
        userId,
      )
      continue
    }

    const mirrorDocument = buildMirrorDocument(user)
    if (mirrorDocument === null) {
      logger.warn("Skipping usersByHandle upsert for invalid user '%s'.", userId)
      continue
    }

    const shouldWriteMirror =
      existingHandle === null ||
      existingHandle.userId !== mirrorDocument.userId ||
      previousHandle !== currentHandle

    if (shouldWriteMirror) {
      await store.upsertMirror(mirrorDocument)
      logger.info(
        "Upserted usersByHandle mirror '%s' for user '%s'.",
        mirrorDocument.handle,
        mirrorDocument.userId,
      )
    }

    if (previousHandle !== null && previousHandle !== currentHandle) {
      await store.deleteByHandle(previousHandle)
      logger.info(
        "Deleted stale usersByHandle mirror '%s' for user '%s'.",
        previousHandle,
        userId,
      )
    }

    if (existingState === null || previousHandle !== currentHandle) {
      await store.upsertState(buildUserHandleStateDocument(userId, currentHandle))
    }
  }
}
