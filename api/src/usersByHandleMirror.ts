export interface UserDocument {
  id?: string | null;
  handle?: string | null;
  handleLower?: string | null;
  displayName?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}

export interface UsersByHandleMirrorDocument {
  id: string;
  type: "usersByHandle";
  handle: string;
  userId: string;
  displayName: string | null;
  status: string | null;
  sourceUpdatedAt: string | null;
}

export interface ExistingMirrorRecord {
  id: string;
  handle: string;
  userId: string;
}

export interface UsersByHandleMirrorStore {
  getByHandle(handle: string): Promise<ExistingMirrorRecord | null>;
  listByUserId(userId: string): Promise<ExistingMirrorRecord[]>;
  upsert(document: UsersByHandleMirrorDocument): Promise<void>;
  delete(handle: string): Promise<void>;
}

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const noop = (): void => undefined;

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
  error: noop
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeHandleLower(user: UserDocument): string | null {
  const rawHandle = isNonEmptyString(user.handleLower)
    ? user.handleLower
    : isNonEmptyString(user.handle)
      ? user.handle
      : null;

  if (rawHandle === null) {
    return null;
  }

  const normalized = rawHandle.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function collapseUsersToLatest(users: readonly UserDocument[]): UserDocument[] {
  const latestById = new Map<string, UserDocument>();

  for (const user of users) {
    if (!isNonEmptyString(user.id)) {
      continue;
    }

    latestById.set(user.id, user);
  }

  return [...latestById.values()];
}

export function buildMirrorDocument(user: UserDocument): UsersByHandleMirrorDocument | null {
  if (!isNonEmptyString(user.id)) {
    return null;
  }

  const handleLower = normalizeHandleLower(user);
  if (handleLower === null) {
    return null;
  }

  return {
    id: handleLower,
    type: "usersByHandle",
    handle: handleLower,
    userId: user.id,
    displayName: isNonEmptyString(user.displayName) ? user.displayName.trim() : null,
    status: isNonEmptyString(user.status) ? user.status.trim() : null,
    sourceUpdatedAt: isNonEmptyString(user.updatedAt) ? user.updatedAt : null
  };
}

export async function syncUsersByHandleBatch(
  users: readonly UserDocument[],
  store: UsersByHandleMirrorStore,
  logger: LoggerLike = nullLogger
): Promise<void> {
  const collapsedUsers = collapseUsersToLatest(users);

  for (const user of collapsedUsers) {
    if (!isNonEmptyString(user.id)) {
      logger.warn("Skipping usersByHandle sync for a document without an id.");
      continue;
    }

    const currentHandle = normalizeHandleLower(user);
    const existingMirrors = await store.listByUserId(user.id);

    for (const staleMirror of existingMirrors) {
      if (staleMirror.handle !== currentHandle) {
        await store.delete(staleMirror.handle);
        logger.info(
          "Deleted stale usersByHandle mirror '%s' for user '%s'.",
          staleMirror.handle,
          user.id
        );
      }
    }

    if (currentHandle === null) {
      logger.warn("Skipping usersByHandle upsert for user '%s' because no handle is set.", user.id);
      continue;
    }

    const existingHandle = await store.getByHandle(currentHandle);
    if (existingHandle !== null && existingHandle.userId !== user.id) {
      logger.error(
        "Handle collision detected for '%s': '%s' already belongs to '%s'.",
        currentHandle,
        user.id,
        existingHandle.userId
      );

      throw new Error(
        `Handle '${currentHandle}' is already mirrored for user '${existingHandle.userId}'.`
      );
    }

    const mirrorDocument = buildMirrorDocument(user);
    if (mirrorDocument === null) {
      logger.warn("Skipping usersByHandle upsert for invalid user '%s'.", user.id);
      continue;
    }

    await store.upsert(mirrorDocument);
    logger.info(
      "Upserted usersByHandle mirror '%s' for user '%s'.",
      mirrorDocument.handle,
      mirrorDocument.userId
    );
  }
}
