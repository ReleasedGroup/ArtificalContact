import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildCounterFn } from '../src/functions/counter.js'
import {
  syncReplyCountersBatch,
  type ReplyCounterSourceDocument,
  type ReplyCounterStore,
} from '../src/lib/reply-counter.js'
import type { StoredPostDocument } from '../src/lib/posts.js'

class InMemoryReplyCounterStore implements ReplyCounterStore {
  public readonly upsertedPosts: StoredPostDocument[] = []

  constructor(private readonly posts = new Map<string, StoredPostDocument>()) {}

  async getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null> {
    const post = this.posts.get(postId) ?? null

    if (post === null) {
      return null
    }

    if (threadId !== undefined && post.threadId !== threadId) {
      return null
    }

    return post
  }

  async upsertPost(post: StoredPostDocument): Promise<StoredPostDocument> {
    this.posts.set(post.id, post)
    this.upsertedPosts.push(post)
    return post
  }

  async countActiveReplies(
    threadId: string,
    parentId: string,
  ): Promise<number> {
    return [...this.posts.values()].filter((post) => {
      return (
        post.threadId === threadId &&
        post.parentId === parentId &&
        post.type === 'reply' &&
        post.deletedAt == null
      )
    }).length
  }
}

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'p_root',
    type: 'post',
    kind: 'user',
    threadId: 'p_root',
    parentId: null,
    authorId: 'github:root',
    authorHandle: 'root',
    authorDisplayName: 'Root Author',
    authorAvatarUrl: 'https://cdn.example.com/root.png',
    text: 'Root post',
    hashtags: [],
    mentions: [],
    counters: {
      likes: 0,
      dislikes: 0,
      emoji: 0,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createReplyDocument(
  overrides: Partial<ReplyCounterSourceDocument> = {},
): ReplyCounterSourceDocument {
  return {
    id: 'p_reply',
    type: 'reply',
    threadId: 'p_root',
    parentId: 'p_root',
    deletedAt: null,
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

describe('syncReplyCountersBatch', () => {
  it('recomputes the parent reply count when a new reply is inserted', async () => {
    const store = new InMemoryReplyCounterStore(
      new Map([
        ['p_root', createStoredPost()],
        [
          'p_reply',
          createStoredPost({
            id: 'p_reply',
            type: 'reply',
            threadId: 'p_root',
            parentId: 'p_root',
          }),
        ],
      ]),
    )
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncReplyCountersBatch([createReplyDocument()], store, logger)

    expect(store.upsertedPosts).toEqual([
      expect.objectContaining({
        id: 'p_root',
        counters: expect.objectContaining({
          replies: 1,
        }),
      }),
    ])
    expect(logger.info).toHaveBeenCalledWith(
      "Updated replies counter for parent '%s' in thread '%s' from %d to %d.",
      'p_root',
      'p_root',
      0,
      1,
    )
  })

  it('decrements the parent reply count when a reply is soft-deleted', async () => {
    const store = new InMemoryReplyCounterStore(
      new Map([
        [
          'p_root',
          createStoredPost({
            counters: {
              likes: 2,
              dislikes: 0,
              emoji: 1,
              replies: 1,
            },
          }),
        ],
        [
          'p_reply',
          createStoredPost({
            id: 'p_reply',
            type: 'reply',
            threadId: 'p_root',
            parentId: 'p_root',
            deletedAt: '2026-04-15T10:00:00.000Z',
          }),
        ],
      ]),
    )

    await syncReplyCountersBatch(
      [
        createReplyDocument({
          deletedAt: '2026-04-15T10:00:00.000Z',
        }),
      ],
      store,
    )

    expect(store.upsertedPosts).toEqual([
      expect.objectContaining({
        id: 'p_root',
        counters: expect.objectContaining({
          likes: 2,
          emoji: 1,
          replies: 0,
        }),
      }),
    ])
  })

  it('collapses duplicate change-feed deliveries and becomes a no-op once synchronized', async () => {
    const store = new InMemoryReplyCounterStore(
      new Map([
        ['p_root', createStoredPost()],
        [
          'p_reply',
          createStoredPost({
            id: 'p_reply',
            type: 'reply',
            threadId: 'p_root',
            parentId: 'p_root',
          }),
        ],
      ]),
    )

    await syncReplyCountersBatch(
      [createReplyDocument(), createReplyDocument()],
      store,
    )
    await syncReplyCountersBatch([createReplyDocument()], store)

    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]?.counters?.replies).toBe(1)
  })

  it('warns when a reply references a parent post that cannot be loaded', async () => {
    const store = new InMemoryReplyCounterStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncReplyCountersBatch([createReplyDocument()], store, logger)

    expect(store.upsertedPosts).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reply counter sync for reply '%s' because parent '%s' was not found in thread '%s'.",
      'p_reply',
      'p_root',
      'p_root',
    )
  })

  it('ignores non-reply post changes and malformed reply documents', async () => {
    const store = new InMemoryReplyCounterStore(
      new Map([['p_root', createStoredPost()]]),
    )

    await syncReplyCountersBatch(
      [
        {
          id: 'p_root',
          type: 'post',
          threadId: 'p_root',
          parentId: null,
        },
        {
          id: 'bad_reply',
          type: 'reply',
          threadId: 'p_root',
          parentId: null,
        },
      ],
      store,
    )

    expect(store.upsertedPosts).toEqual([])
  })
})

describe('counterFn', () => {
  it('uses the injected store to synchronize reply counters for change-feed batches', async () => {
    const store = new InMemoryReplyCounterStore(
      new Map([
        ['p_root', createStoredPost()],
        [
          'p_reply',
          createStoredPost({
            id: 'p_reply',
            type: 'reply',
            threadId: 'p_root',
            parentId: 'p_root',
          }),
        ],
      ]),
    )
    const handler = buildCounterFn({
      storeFactory: () => store,
    })
    const context = createContext()

    await handler([createReplyDocument()], context)

    expect(store.upsertedPosts).toHaveLength(1)
    expect(store.upsertedPosts[0]?.counters?.replies).toBe(1)
    expect(context.info).toHaveBeenCalledWith(
      "Updated replies counter for parent '%s' in thread '%s' from %d to %d.",
      'p_root',
      'p_root',
      0,
      1,
    )
  })
})
