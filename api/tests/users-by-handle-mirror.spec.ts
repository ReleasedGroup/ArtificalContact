import { describe, expect, it, vi } from 'vitest'
import {
  buildUserHandleStateId,
  nullLogger,
  syncUsersByHandleBatch,
  type ExistingMirrorRecord,
  type ExistingUserHandleState,
  type UserDocument,
  type UsersByHandleMirrorDocument,
  type UsersByHandleMirrorStateDocument,
  type UsersByHandleMirrorStore,
} from '../src/lib/users-by-handle-mirror.js'

class InMemoryUsersByHandleMirrorStore implements UsersByHandleMirrorStore {
  public readonly deletedHandles: string[] = []
  public readonly deletedStateUserIds: string[] = []
  public readonly upsertedMirrors: UsersByHandleMirrorDocument[] = []
  public readonly upsertedStates: UsersByHandleMirrorStateDocument[] = []

  constructor(
    private readonly mirrors = new Map<string, ExistingMirrorRecord>(),
    private readonly states = new Map<string, ExistingUserHandleState>(),
  ) {}

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.mirrors.get(handle) ?? null
  }

  async getStateByUserId(userId: string): Promise<ExistingUserHandleState | null> {
    return this.states.get(buildUserHandleStateId(userId)) ?? null
  }

  async upsertMirror(document: UsersByHandleMirrorDocument): Promise<void> {
    this.mirrors.set(document.handle, {
      id: document.id,
      handle: document.handle,
      userId: document.userId,
    })
    this.upsertedMirrors.push(document)
  }

  async upsertState(document: UsersByHandleMirrorStateDocument): Promise<void> {
    this.states.set(document.id, {
      id: document.id,
      handle: document.handle,
      userId: document.userId,
      currentHandle: document.currentHandle,
    })
    this.upsertedStates.push(document)
  }

  async deleteByHandle(handle: string): Promise<void> {
    this.mirrors.delete(handle)
    this.deletedHandles.push(handle)
  }

  async deleteStateByUserId(userId: string): Promise<void> {
    this.states.delete(buildUserHandleStateId(userId))
    this.deletedStateUserIds.push(userId)
  }

  snapshotMirrors(): ExistingMirrorRecord[] {
    return [...this.mirrors.values()].sort((left, right) =>
      left.handle.localeCompare(right.handle),
    )
  }

  snapshotStates(): ExistingUserHandleState[] {
    return [...this.states.values()].sort((left, right) =>
      left.userId.localeCompare(right.userId),
    )
  }
}

function createStore(options?: {
  mirrors?: ExistingMirrorRecord[]
  states?: ExistingUserHandleState[]
}) {
  return new InMemoryUsersByHandleMirrorStore(
    new Map((options?.mirrors ?? []).map((record) => [record.handle, record])),
    new Map((options?.states ?? []).map((record) => [record.id, record])),
  )
}

describe('syncUsersByHandleBatch', () => {
  it('upserts a deterministic mirror and state for a claimed handle', async () => {
    const store = createStore()

    await syncUsersByHandleBatch([{ id: 'u1', handle: 'Ada' }], store, nullLogger)

    expect(store.upsertedMirrors).toEqual([
      {
        id: 'ada',
        type: 'usersByHandle',
        handle: 'ada',
        userId: 'u1',
      },
    ])
    expect(store.upsertedStates).toEqual([
      {
        id: buildUserHandleStateId('u1'),
        type: 'usersByHandleState',
        handle: buildUserHandleStateId('u1'),
        userId: 'u1',
        currentHandle: 'ada',
      },
    ])
    expect(store.snapshotMirrors()).toEqual([
      { id: 'ada', handle: 'ada', userId: 'u1' },
    ])
  })

  it('renames a handle by deleting the stale mirror and updating state', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada-old', handle: 'ada-old', userId: 'u1' }],
      states: [
        {
          id: buildUserHandleStateId('u1'),
          handle: buildUserHandleStateId('u1'),
          userId: 'u1',
          currentHandle: 'ada-old',
        },
      ],
    })

    await syncUsersByHandleBatch(
      [{ id: 'u1', handleLower: 'ada' }],
      store,
      nullLogger,
    )

    expect(store.deletedHandles).toEqual(['ada-old'])
    expect(store.deletedStateUserIds).toEqual([])
    expect(store.snapshotMirrors()).toEqual([
      { id: 'ada', handle: 'ada', userId: 'u1' },
    ])
    expect(store.snapshotStates()).toEqual([
      {
        id: buildUserHandleStateId('u1'),
        handle: buildUserHandleStateId('u1'),
        userId: 'u1',
        currentHandle: 'ada',
      },
    ])
  })

  it('deletes the mirror and state when a user no longer has a handle', async () => {
    const store = createStore({
      mirrors: [{ id: 'ada', handle: 'ada', userId: 'u1' }],
      states: [
        {
          id: buildUserHandleStateId('u1'),
          handle: buildUserHandleStateId('u1'),
          userId: 'u1',
          currentHandle: 'ada',
        },
      ],
    })

    await syncUsersByHandleBatch([{ id: 'u1', handleLower: null }], store, nullLogger)

    expect(store.deletedHandles).toEqual(['ada'])
    expect(store.deletedStateUserIds).toEqual(['u1'])
    expect(store.snapshotMirrors()).toEqual([])
    expect(store.snapshotStates()).toEqual([])
  })

  it('logs collisions and continues without throwing or scanning across partitions', async () => {
    const store = createStore({
      mirrors: [
        { id: 'ada-old', handle: 'ada-old', userId: 'u1' },
        { id: 'ada', handle: 'ada', userId: 'u2' },
      ],
      states: [
        {
          id: buildUserHandleStateId('u1'),
          handle: buildUserHandleStateId('u1'),
          userId: 'u1',
          currentHandle: 'ada-old',
        },
      ],
    })
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await expect(
      syncUsersByHandleBatch([{ id: 'u1', handleLower: 'ada' }], store, logger),
    ).resolves.toBeUndefined()

    expect(store.deletedHandles).toEqual(['ada-old'])
    expect(store.deletedStateUserIds).toEqual(['u1'])
    expect(store.upsertedMirrors).toEqual([])
    expect(store.snapshotMirrors()).toEqual([
      { id: 'ada', handle: 'ada', userId: 'u2' },
    ])
    expect(logger.error).toHaveBeenCalledWith(
      "Handle collision detected for '%s': it already belongs to user '%s'. Skipping usersByHandle sync for user '%s'.",
      'ada',
      'u2',
      'u1',
    )
  })

  it('collapses duplicate change-feed images to the latest user document', async () => {
    const store = createStore()
    const documents: UserDocument[] = [
      { id: 'u1', handleLower: 'ada-old' },
      { id: 'u1', handleLower: 'ada' },
    ]

    await syncUsersByHandleBatch(documents, store, nullLogger)

    expect(store.upsertedMirrors).toEqual([
      {
        id: 'ada',
        type: 'usersByHandle',
        handle: 'ada',
        userId: 'u1',
      },
    ])
    expect(store.snapshotMirrors()).toEqual([
      { id: 'ada', handle: 'ada', userId: 'u1' },
    ])
  })
})
