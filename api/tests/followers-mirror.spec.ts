import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildFollowersMirrorFn } from '../src/functions/followers-mirror.js'
import {
  buildFollowersMirrorDocument,
  syncFollowersMirrorBatch,
  type ExistingFollowersMirrorRecord,
  type FollowersMirrorDocument,
  type FollowersMirrorSourceDocument,
  type FollowersMirrorStore,
} from '../src/lib/followers-mirror.js'
import { buildFollowDocumentId } from '../src/lib/follows.js'

class InMemoryFollowersMirrorStore implements FollowersMirrorStore {
  public readonly deletedMirrors: string[] = []
  public readonly upsertedMirrors: FollowersMirrorDocument[] = []

  constructor(
    private readonly mirrors = new Map<string, ExistingFollowersMirrorRecord>(),
  ) {}

  async getByFollowerAndFollowed(
    followerId: string,
    followedId: string,
  ): Promise<ExistingFollowersMirrorRecord | null> {
    return this.mirrors.get(buildFollowDocumentId(followerId, followedId)) ?? null
  }

  async upsertMirror(document: FollowersMirrorDocument): Promise<void> {
    this.mirrors.set(document.id, { ...document })
    this.upsertedMirrors.push(document)
  }

  async deleteMirror(followerId: string, followedId: string): Promise<void> {
    const id = buildFollowDocumentId(followerId, followedId)
    this.mirrors.delete(id)
    this.deletedMirrors.push(id)
  }

  snapshotMirrors(): ExistingFollowersMirrorRecord[] {
    return [...this.mirrors.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }
}

function createStore(options?: { mirrors?: ExistingFollowersMirrorRecord[] }) {
  return new InMemoryFollowersMirrorStore(
    new Map((options?.mirrors ?? []).map((record) => [record.id, record])),
  )
}

function createFollowChange(
  overrides: Partial<FollowersMirrorSourceDocument> = {},
): FollowersMirrorSourceDocument {
  return {
    id: 'legacy-follow-id',
    type: 'follow',
    followerId: 'u_follower',
    followedId: 'u_followed',
    createdAt: '2026-04-15T05:00:00.000Z',
    ...overrides,
  }
}

function createContext(): InvocationContext {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  } as unknown as InvocationContext
}

describe('buildFollowersMirrorDocument', () => {
  it('builds a deterministic mirror id from the follower and followed ids', () => {
    expect(
      buildFollowersMirrorDocument(createFollowChange({ id: 'non-deterministic' })),
    ).toEqual({
      id: 'u_follower:u_followed',
      type: 'follow',
      followerId: 'u_follower',
      followedId: 'u_followed',
      createdAt: '2026-04-15T05:00:00.000Z',
    })
  })
})

describe('syncFollowersMirrorBatch', () => {
  it('upserts the reverse mirror for a follow relationship', async () => {
    const store = createStore()

    await syncFollowersMirrorBatch([createFollowChange()], store)

    expect(store.upsertedMirrors).toEqual([
      {
        id: 'u_follower:u_followed',
        type: 'follow',
        followerId: 'u_follower',
        followedId: 'u_followed',
        createdAt: '2026-04-15T05:00:00.000Z',
      },
    ])
    expect(store.snapshotMirrors()).toEqual([
      {
        id: 'u_follower:u_followed',
        type: 'follow',
        followerId: 'u_follower',
        followedId: 'u_followed',
        createdAt: '2026-04-15T05:00:00.000Z',
      },
    ])
  })

  it('becomes a no-op when the mirror is already synchronized', async () => {
    const existingMirror: ExistingFollowersMirrorRecord = {
      id: 'u_follower:u_followed',
      type: 'follow',
      followerId: 'u_follower',
      followedId: 'u_followed',
      createdAt: '2026-04-15T05:00:00.000Z',
    }
    const store = createStore({
      mirrors: [existingMirror],
    })

    await syncFollowersMirrorBatch([createFollowChange()], store)

    expect(store.upsertedMirrors).toEqual([])
  })

  it('collapses duplicate change-feed deliveries to the latest follow document', async () => {
    const store = createStore()

    await syncFollowersMirrorBatch(
      [
        createFollowChange({
          createdAt: '2026-04-15T05:00:00.000Z',
        }),
        createFollowChange({
          id: 'duplicate-delivery',
          createdAt: '2026-04-15T05:01:00.000Z',
        }),
      ],
      store,
    )

    expect(store.upsertedMirrors).toEqual([
      {
        id: 'u_follower:u_followed',
        type: 'follow',
        followerId: 'u_follower',
        followedId: 'u_followed',
        createdAt: '2026-04-15T05:01:00.000Z',
      },
    ])
  })

  it('deletes the reverse mirror when a follow relationship is soft-deleted', async () => {
    const existingMirror: ExistingFollowersMirrorRecord = {
      id: 'u_follower:u_followed',
      type: 'follow',
      followerId: 'u_follower',
      followedId: 'u_followed',
      createdAt: '2026-04-15T05:00:00.000Z',
    }
    const store = createStore({
      mirrors: [existingMirror],
    })
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    await syncFollowersMirrorBatch(
      [
        createFollowChange({
          deletedAt: '2026-04-15T06:00:00.000Z',
        }),
      ],
      store,
      logger,
    )

    expect(store.deletedMirrors).toEqual(['u_follower:u_followed'])
    expect(store.snapshotMirrors()).toEqual([])
    expect(logger.info).toHaveBeenCalledWith(
      "Deleted followers mirror '%s' for follower '%s' under followed user '%s'.",
      'u_follower:u_followed',
      'u_follower',
      'u_followed',
    )
  })

  it('warns and skips invalid follow documents safely', async () => {
    const store = createStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    await syncFollowersMirrorBatch(
      [
        createFollowChange({ type: 'reaction' }),
        createFollowChange({ followerId: '' }),
      ],
      store,
      logger,
    )

    expect(store.upsertedMirrors).toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping followers mirror sync for an invalid follow document.',
    )
  })
})

describe('followersMirrorFn', () => {
  it('uses the injected store to synchronize follower mirrors for change-feed batches', async () => {
    const store = createStore()
    const handler = buildFollowersMirrorFn({
      storeFactory: () => store,
    })
    const context = createContext()

    await handler([createFollowChange()], context)

    expect(store.upsertedMirrors).toEqual([
      {
        id: 'u_follower:u_followed',
        type: 'follow',
        followerId: 'u_follower',
        followedId: 'u_followed',
        createdAt: '2026-04-15T05:00:00.000Z',
      },
    ])
    expect(context.info).toHaveBeenCalledWith(
      "Upserted followers mirror '%s' for follower '%s' under followed user '%s'.",
      'u_follower:u_followed',
      'u_follower',
      'u_followed',
    )
  })

  it('deletes mirrored followers when the latest change-feed image is a soft delete', async () => {
    const existingMirror: ExistingFollowersMirrorRecord = {
      id: 'u_follower:u_followed',
      type: 'follow',
      followerId: 'u_follower',
      followedId: 'u_followed',
      createdAt: '2026-04-15T05:00:00.000Z',
    }
    const store = createStore({
      mirrors: [existingMirror],
    })
    const handler = buildFollowersMirrorFn({
      storeFactory: () => store,
    })

    await handler(
      [
        createFollowChange(),
        createFollowChange({
          deletedAt: '2026-04-15T06:00:00.000Z',
        }),
      ],
      createContext(),
    )

    expect(store.upsertedMirrors).toEqual([])
    expect(store.deletedMirrors).toEqual(['u_follower:u_followed'])
    expect(store.snapshotMirrors()).toEqual([])
  })
})
