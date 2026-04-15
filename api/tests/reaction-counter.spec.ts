import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildReactionCounterFn } from '../src/functions/counter.js'
import {
  syncReactionCountersBatch,
  type ReactionCounterSourceDocument,
  type ReactionCounterStore,
} from '../src/lib/reaction-counter.js'
import type { StoredPostDocument } from '../src/lib/posts.js'
import type { ReactionDocument } from '../src/lib/reactions.js'

class InMemoryReactionCounterStore implements ReactionCounterStore {
  public readonly reactionCountUpdates: Array<{
    postId: string
    threadId: string
    likes: number
    dislikes: number
    emoji: number
  }> = []

  constructor(
    private readonly posts = new Map<string, StoredPostDocument>(),
    private readonly reactions = new Map<string, ReactionDocument>(),
  ) {}

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

  async getReactionSummary(postId: string): Promise<{
    likes: number
    dislikes: number
    emoji: number
  }> {
    let likes = 0
    let dislikes = 0
    let emoji = 0

    for (const reaction of this.reactions.values()) {
      if (reaction.postId !== postId) {
        continue
      }

      if (reaction.sentiment === 'like') {
        likes += 1
      } else if (reaction.sentiment === 'dislike') {
        dislikes += 1
      }

      emoji += reaction.emojiValues.length
    }

    return {
      likes,
      dislikes,
      emoji,
    }
  }

  async setReactionCounts(
    postId: string,
    threadId: string,
    counts: {
      likes: number
      dislikes: number
      emoji: number
      replies: number
    },
  ): Promise<void> {
    const post = this.posts.get(postId)
    if (post === undefined) {
      throw new Error(`Cannot update missing post '${postId}'.`)
    }

    if (post.threadId !== threadId) {
      throw new Error(
        `Cannot update post '${postId}' in unexpected thread '${threadId}'.`,
      )
    }

    this.posts.set(postId, {
      ...post,
      counters: {
        ...(post.counters ?? {}),
        likes: counts.likes,
        dislikes: counts.dislikes,
        emoji: counts.emoji,
        replies: counts.replies,
      },
    })
    this.reactionCountUpdates.push({
      postId,
      threadId,
      likes: counts.likes,
      dislikes: counts.dislikes,
      emoji: counts.emoji,
    })
  }
}

function createStoredPost(
  overrides: Partial<StoredPostDocument> = {},
): StoredPostDocument {
  return {
    id: 'post-1',
    type: 'post',
    kind: 'user',
    threadId: 'post-1',
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
      replies: 4,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function createStoredReaction(
  overrides: Partial<ReactionDocument> = {},
): ReactionDocument {
  return {
    id: 'post-1:github:user-1',
    type: 'reaction',
    postId: 'post-1',
    userId: 'github:user-1',
    sentiment: null,
    emojiValues: [],
    gifValue: null,
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    ...overrides,
  }
}

function createReactionDocument(
  overrides: Partial<ReactionCounterSourceDocument> = {},
): ReactionCounterSourceDocument {
  return {
    id: 'post-1:github:user-1',
    type: 'reaction',
    postId: 'post-1',
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

describe('syncReactionCountersBatch', () => {
  it('recomputes likes, dislikes, and emoji totals for the affected post', async () => {
    const store = new InMemoryReactionCounterStore(
      new Map([
        [
          'post-1',
          createStoredPost({
            counters: {
              likes: 0,
              dislikes: 0,
              emoji: 0,
              replies: 4,
            },
          }),
        ],
      ]),
      new Map([
        [
          'post-1:github:user-1',
          createStoredReaction({
            sentiment: 'like',
          }),
        ],
        [
          'post-1:github:user-2',
          createStoredReaction({
            id: 'post-1:github:user-2',
            userId: 'github:user-2',
            sentiment: 'dislike',
            emojiValues: ['🎉', '🔥'],
          }),
        ],
        [
          'post-1:github:user-3',
          createStoredReaction({
            id: 'post-1:github:user-3',
            userId: 'github:user-3',
            emojiValues: ['💯'],
            gifValue: 'gif://party',
          }),
        ],
      ]),
    )
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncReactionCountersBatch([createReactionDocument()], store, logger)
    const updatedPost = await store.getPostById('post-1', 'post-1')

    expect(store.reactionCountUpdates).toEqual([
      {
        postId: 'post-1',
        threadId: 'post-1',
        likes: 1,
        dislikes: 1,
        emoji: 3,
      },
    ])
    expect(updatedPost?.counters).toEqual({
      likes: 1,
      dislikes: 1,
      emoji: 3,
      replies: 4,
    })
    expect(logger.info).toHaveBeenCalledWith(
      "Updated reaction counters for post '%s' from likes=%d/dislikes=%d/emoji=%d to likes=%d/dislikes=%d/emoji=%d.",
      'post-1',
      0,
      0,
      0,
      1,
      1,
      3,
    )
  })

  it('collapses duplicate change-feed deliveries and becomes a no-op once synchronized', async () => {
    const store = new InMemoryReactionCounterStore(
      new Map([['post-1', createStoredPost()]]),
      new Map([
        [
          'post-1:github:user-1',
          createStoredReaction({
            sentiment: 'like',
          }),
        ],
      ]),
    )

    await syncReactionCountersBatch(
      [createReactionDocument(), createReactionDocument()],
      store,
    )
    await syncReactionCountersBatch([createReactionDocument()], store)

    expect(store.reactionCountUpdates).toEqual([
      {
        postId: 'post-1',
        threadId: 'post-1',
        likes: 1,
        dislikes: 0,
        emoji: 0,
      },
    ])
  })

  it('warns when a reaction references a post that cannot be loaded', async () => {
    const store = new InMemoryReactionCounterStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncReactionCountersBatch([createReactionDocument()], store, logger)

    expect(store.reactionCountUpdates).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reaction counter sync for reaction '%s' because post '%s' was not found.",
      'post-1:github:user-1',
      'post-1',
    )
  })

  it('ignores non-reaction and malformed change-feed documents', async () => {
    const store = new InMemoryReactionCounterStore(
      new Map([['post-1', createStoredPost()]]),
    )

    await syncReactionCountersBatch(
      [
        {
          id: 'post-1',
          type: 'post',
          postId: 'post-1',
        },
        {
          id: 'bad-reaction',
          type: 'reaction',
          postId: null,
        },
      ],
      store,
    )

    expect(store.reactionCountUpdates).toEqual([])
  })
})

describe('reactionCounterFn', () => {
  it('uses the injected store to synchronize reaction counters for change-feed batches', async () => {
    const store = new InMemoryReactionCounterStore(
      new Map([['post-1', createStoredPost()]]),
      new Map([
        [
          'post-1:github:user-1',
          createStoredReaction({
            sentiment: 'like',
            emojiValues: ['🎉'],
          }),
        ],
      ]),
    )
    const handler = buildReactionCounterFn({
      reactionStoreFactory: () => store,
    })
    const context = createContext()

    await handler([createReactionDocument()], context)

    expect(store.reactionCountUpdates).toEqual([
      {
        postId: 'post-1',
        threadId: 'post-1',
        likes: 1,
        dislikes: 0,
        emoji: 1,
      },
    ])
    expect(context.info).toHaveBeenCalledWith(
      "Updated reaction counters for post '%s' from likes=%d/dislikes=%d/emoji=%d to likes=%d/dislikes=%d/emoji=%d.",
      'post-1',
      0,
      0,
      0,
      1,
      0,
      1,
    )
  })
})
