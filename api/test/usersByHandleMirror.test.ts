import assert from "node:assert/strict";
import test from "node:test";

import {
  nullLogger,
  syncUsersByHandleBatch,
  type ExistingMirrorRecord,
  type UserDocument,
  type UsersByHandleMirrorDocument,
  type UsersByHandleMirrorStore
} from "../src/usersByHandleMirror";

class InMemoryUsersByHandleMirrorStore implements UsersByHandleMirrorStore {
  public readonly deletedHandles: string[] = [];
  public readonly upsertedDocuments: UsersByHandleMirrorDocument[] = [];

  constructor(private readonly documents = new Map<string, ExistingMirrorRecord>()) {}

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.documents.get(handle) ?? null;
  }

  async listByUserId(userId: string): Promise<ExistingMirrorRecord[]> {
    return [...this.documents.values()].filter((document) => document.userId === userId);
  }

  async upsert(document: UsersByHandleMirrorDocument): Promise<void> {
    this.documents.set(document.handle, {
      id: document.id,
      handle: document.handle,
      userId: document.userId
    });
    this.upsertedDocuments.push(document);
  }

  async delete(handle: string): Promise<void> {
    this.documents.delete(handle);
    this.deletedHandles.push(handle);
  }

  snapshot(): ExistingMirrorRecord[] {
    return [...this.documents.values()].sort((left, right) => left.handle.localeCompare(right.handle));
  }
}

function createStore(records: ExistingMirrorRecord[] = []): InMemoryUsersByHandleMirrorStore {
  return new InMemoryUsersByHandleMirrorStore(
    new Map(records.map((record) => [record.handle, record]))
  );
}

test("syncUsersByHandleBatch upserts a deterministic mirror and removes stale handles", async () => {
  const store = createStore([
    { id: "old-ada", handle: "old-ada", userId: "u1" },
    { id: "grace", handle: "grace", userId: "u2" }
  ]);

  const documents: UserDocument[] = [
    {
      id: "u1",
      handle: "Ada",
      handleLower: "ada",
      displayName: "Ada Lovelace",
      status: "active",
      updatedAt: "2026-04-15T00:20:00Z"
    }
  ];

  await syncUsersByHandleBatch(documents, store, nullLogger);

  assert.deepEqual(store.deletedHandles, ["old-ada"]);
  assert.deepEqual(store.upsertedDocuments, [
    {
      id: "ada",
      type: "usersByHandle",
      handle: "ada",
      userId: "u1",
      displayName: "Ada Lovelace",
      status: "active",
      sourceUpdatedAt: "2026-04-15T00:20:00Z"
    }
  ]);
  assert.deepEqual(store.snapshot(), [
    { id: "ada", handle: "ada", userId: "u1" },
    { id: "grace", handle: "grace", userId: "u2" }
  ]);
});

test("syncUsersByHandleBatch removes stale mirrors when a user no longer has a handle", async () => {
  const store = createStore([{ id: "ada", handle: "ada", userId: "u1" }]);

  await syncUsersByHandleBatch([{ id: "u1", handleLower: null }], store, nullLogger);

  assert.deepEqual(store.deletedHandles, ["ada"]);
  assert.equal(store.upsertedDocuments.length, 0);
  assert.deepEqual(store.snapshot(), []);
});

test("syncUsersByHandleBatch rejects handle collisions instead of overwriting another user", async () => {
  const store = createStore([{ id: "ada", handle: "ada", userId: "u2" }]);

  await assert.rejects(
    syncUsersByHandleBatch([{ id: "u1", handleLower: "ada" }], store, nullLogger),
    /Handle 'ada' is already mirrored for user 'u2'/
  );

  assert.equal(store.upsertedDocuments.length, 0);
  assert.deepEqual(store.snapshot(), [{ id: "ada", handle: "ada", userId: "u2" }]);
});

test("syncUsersByHandleBatch collapses multiple updates for the same user to the latest change-feed image", async () => {
  const store = createStore();

  await syncUsersByHandleBatch(
    [
      { id: "u1", handleLower: "ada-old", displayName: "Ada (old)" },
      { id: "u1", handleLower: "ada", displayName: "Ada Lovelace" }
    ],
    store,
    nullLogger
  );

  assert.equal(store.upsertedDocuments.length, 1);
  assert.deepEqual(store.upsertedDocuments[0], {
    id: "ada",
    type: "usersByHandle",
    handle: "ada",
    userId: "u1",
    displayName: "Ada Lovelace",
    status: null,
    sourceUpdatedAt: null
  });
});
