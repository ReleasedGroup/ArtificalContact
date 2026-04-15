import type { InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import {
  buildFollowNotificationFn,
  buildPostNotificationFn,
  buildReactionNotificationFn,
} from '../src/functions/notification.js'
import type {
  NotificationDocument,
  NotificationFollowSourceDocument,
  NotificationPostSourceDocument,
  NotificationProfileStore,
  NotificationReactionSourceDocument,
  NotificationStore,
} from '../src/lib/notifications.js'
import {
  buildNotificationId,
  syncFollowNotificationsBatch,
  syncPostNotificationsBatch,
  syncReactionNotificationsBatch,
} from '../src/lib/notifications.js'
import type { StoredPostDocument, PostStore } from '../src/lib/posts.js'
import type { StoredUserDocument } from '../src/lib/user-profile.js'
import type { ExistingMirrorRecord } from '../src/lib/users-by-handle-mirror.js'

class InMemoryNotificationDependencyStore
  implements NotificationStore, NotificationProfileStore, PostStore
{
  public readonly upsertedNotifications: NotificationDocument[] = []

  private readonly notifications = new Map<string, NotificationDocument>()

  constructor(
    private readonly posts = new Map<string, StoredPostDocument>(),
    private readonly users = new Map<string, StoredUserDocument>(),
    private readonly mirrors = new Map<string, ExistingMirrorRecord>(),
  ) {}

  async upsertNotification(document: NotificationDocument): Promise<void> {
    this.notifications.set(document.id, { ...document })
    this.upsertedNotifications.push(document)
  }

  async listNotificationsByActorAndWindow(
    targetUserId: string,
    eventType: NotificationDocument['eventType'],
    actorUserId: string,
    windowStart: string,
    windowEndExclusive: string,
  ): Promise<NotificationDocument[]> {
    return this.snapshotNotifications().filter((notification) => {
      if (
        notification.targetUserId !== targetUserId ||
        notification.eventType !== eventType ||
        notification.actorUserId !== actorUserId
      ) {
        return false
      }

      return (
        notification.createdAt >= windowStart &&
        notification.createdAt < windowEndExclusive
      )
    })
  }

  async deleteNotification(
    targetUserId: string,
    notificationId: string,
  ): Promise<void> {
    const existingNotification = this.notifications.get(notificationId)
    if (existingNotification?.targetUserId !== targetUserId) {
      return
    }

    this.notifications.delete(notificationId)
  }

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    return this.mirrors.get(handle) ?? null
  }

  async getUserById(userId: string): Promise<StoredUserDocument | null> {
    return this.users.get(userId) ?? null
  }

  async getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null> {
    if (threadId !== undefined) {
      const pointRead = this.posts.get(`${threadId}:${postId}`)
      if (pointRead !== undefined) {
        return pointRead
      }
    }

    for (const post of this.posts.values()) {
      if (post.id === postId) {
        return post
      }
    }

    return null
  }

  snapshotNotifications(): NotificationDocument[] {
    return [...this.notifications.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }
}

function createStoredUser(
  overrides: Partial<StoredUserDocument> & { id: string },
): StoredUserDocument {
  const { id, handle, handleLower, status, counters, ...rest } = overrides

  return {
    ...rest,
    id,
    handle: handle ?? id,
    handleLower: handleLower ?? (handle ?? id).toLowerCase(),
    status: status ?? 'active',
    counters: {
      posts: counters?.posts ?? 0,
      followers: counters?.followers ?? 0,
      following: counters?.following ?? 0,
    },
  }
}

function createStoredPost(
  overrides: Partial<StoredPostDocument> & {
    id: string
    threadId: string
  },
): StoredPostDocument {
  const {
    id,
    threadId,
    type,
    kind,
    parentId,
    authorId,
    authorHandle,
    authorDisplayName,
    authorAvatarUrl,
    text,
    mentions,
    counters,
    visibility,
    moderationState,
    createdAt,
    updatedAt,
    deletedAt,
    ...rest
  } = overrides

  return {
    ...rest,
    id,
    threadId,
    type: type ?? 'post',
    kind: kind ?? 'user',
    parentId: parentId ?? null,
    authorId: authorId ?? 'u_author',
    authorHandle: authorHandle ?? 'author',
    authorDisplayName: authorDisplayName ?? 'Author',
    ...(authorAvatarUrl === undefined ? {} : { authorAvatarUrl }),
    text: text ?? 'Source text',
    mentions: mentions ?? [],
    counters: {
      likes: counters?.likes ?? 0,
      dislikes: counters?.dislikes ?? 0,
      emoji: counters?.emoji ?? 0,
      replies: counters?.replies ?? 0,
    },
    visibility: visibility ?? 'public',
    moderationState: moderationState ?? 'ok',
    createdAt: createdAt ?? '2026-04-15T09:00:00.000Z',
    updatedAt: updatedAt ?? '2026-04-15T09:00:00.000Z',
    deletedAt: deletedAt ?? null,
  }
}

function createFollowChange(
  overrides: Partial<NotificationFollowSourceDocument> = {},
): NotificationFollowSourceDocument {
  return {
    id: 'u_follower:u_target',
    type: 'follow',
    followerId: 'u_follower',
    followedId: 'u_target',
    createdAt: '2026-04-15T08:00:00.000Z',
    ...overrides,
  }
}

function createPostChange(
  overrides: Partial<NotificationPostSourceDocument> & {
    id?: string
    threadId?: string
  } = {},
): NotificationPostSourceDocument {
  return createStoredPost({
    id: overrides.id ?? 'p_reply',
    threadId: overrides.threadId ?? 'p_root',
    type: overrides.type ?? 'reply',
    parentId: overrides.parentId ?? 'p_root',
    authorId: overrides.authorId ?? 'u_reply_author',
    authorHandle: overrides.authorHandle ?? 'grace',
    authorDisplayName: overrides.authorDisplayName ?? 'Grace Hopper',
    authorAvatarUrl:
      overrides.authorAvatarUrl ?? 'https://cdn.example.com/grace.png',
    text:
      overrides.text ??
      'Nice catch @ada. Looping in @mira for the deployment follow-up.',
    mentions: overrides.mentions ?? ['ada', 'mira'],
    createdAt: overrides.createdAt ?? '2026-04-15T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-15T10:00:00.000Z',
    ...overrides,
  })
}

function createReactionChange(
  overrides: Partial<NotificationReactionSourceDocument> = {},
): NotificationReactionSourceDocument {
  return {
    id: 'p_root:u_reactor',
    type: 'reaction',
    postId: 'p_root',
    userId: 'u_reactor',
    sentiment: 'like',
    emojiValues: [],
    gifValue: null,
    createdAt: '2026-04-15T11:00:00.000Z',
    updatedAt: '2026-04-15T11:00:00.000Z',
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

describe('notification helpers', () => {
  it('builds deterministic notification ids from the target, event type, and entity', () => {
    expect(buildNotificationId('u_target', 'reply', 'p_reply')).toBe(
      'u_target:reply:p_reply',
    )
  })
})

describe('syncFollowNotificationsBatch', () => {
  it('creates a follower notification with a deterministic id and actor snapshot', async () => {
    const store = new InMemoryNotificationDependencyStore(
      new Map(),
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            handle: 'grace',
            displayName: 'Grace Hopper',
            avatarUrl: 'https://cdn.example.com/grace.png',
          }),
        ],
      ]),
    )

    await syncFollowNotificationsBatch([createFollowChange()], store, store)

    expect(store.snapshotNotifications()).toEqual([
      {
        id: 'u_target:follow:u_follower:u_target',
        type: 'notification',
        targetUserId: 'u_target',
        actorUserId: 'u_follower',
        actorHandle: 'grace',
        actorDisplayName: 'Grace Hopper',
        actorAvatarUrl: 'https://cdn.example.com/grace.png',
        eventType: 'follow',
        relatedEntityId: 'u_follower:u_target',
        postId: null,
        threadId: null,
        parentId: null,
        reactionType: null,
        reactionValues: [],
        excerpt: null,
        readAt: null,
        createdAt: '2026-04-15T08:00:00.000Z',
        updatedAt: '2026-04-15T08:00:00.000Z',
        eventCount: 1,
        coalesced: false,
        coalescedWindowStart: null,
        coalescedRelatedEntityIds: [],
        ttl: 7776000,
      },
    ])
  })
})

describe('syncPostNotificationsBatch', () => {
  it('creates reply and mention notifications while suppressing duplicate self-targets', async () => {
    const rootPost = createStoredPost({
      id: 'p_root',
      threadId: 'p_root',
      type: 'post',
      parentId: null,
      authorId: 'u_target',
      authorHandle: 'ada',
      authorDisplayName: 'Ada Lovelace',
      text: 'Root post',
    })
    const store = new InMemoryNotificationDependencyStore(
      new Map([['p_root:p_root', rootPost]]),
      new Map(),
      new Map([
        ['ada', { id: 'ada', handle: 'ada', userId: 'u_target' }],
        ['mira', { id: 'mira', handle: 'mira', userId: 'u_mention' }],
      ]),
    )

    await syncPostNotificationsBatch([createPostChange()], store, store, store)

    expect(store.snapshotNotifications()).toEqual([
      {
        id: 'u_mention:mention:p_reply',
        type: 'notification',
        targetUserId: 'u_mention',
        actorUserId: 'u_reply_author',
        actorHandle: 'grace',
        actorDisplayName: 'Grace Hopper',
        actorAvatarUrl: 'https://cdn.example.com/grace.png',
        eventType: 'mention',
        relatedEntityId: 'p_reply',
        postId: 'p_reply',
        threadId: 'p_root',
        parentId: 'p_root',
        reactionType: null,
        reactionValues: [],
        excerpt: 'Nice catch @ada. Looping in @mira for the deployment follow-up.',
        readAt: null,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
        eventCount: 1,
        coalesced: false,
        coalescedWindowStart: null,
        coalescedRelatedEntityIds: [],
        ttl: 7776000,
      },
      {
        id: 'u_target:reply:p_reply',
        type: 'notification',
        targetUserId: 'u_target',
        actorUserId: 'u_reply_author',
        actorHandle: 'grace',
        actorDisplayName: 'Grace Hopper',
        actorAvatarUrl: 'https://cdn.example.com/grace.png',
        eventType: 'reply',
        relatedEntityId: 'p_reply',
        postId: 'p_reply',
        threadId: 'p_root',
        parentId: 'p_root',
        reactionType: null,
        reactionValues: [],
        excerpt: 'Nice catch @ada. Looping in @mira for the deployment follow-up.',
        readAt: null,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
        eventCount: 1,
        coalesced: false,
        coalescedWindowStart: null,
        coalescedRelatedEntityIds: [],
        ttl: 7776000,
      },
    ])
  })

  it('warns and skips reply notifications when the parent post cannot be found', async () => {
    const store = new InMemoryNotificationDependencyStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncPostNotificationsBatch([createPostChange()], store, store, store, logger)

    expect(store.snapshotNotifications()).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reply notification sync for reply '%s' because parent '%s' was not found in thread '%s'.",
      'p_reply',
      'p_root',
      'p_root',
    )
  })
})

describe('syncReactionNotificationsBatch', () => {
  it('collapses duplicate reaction deliveries and keeps the latest reaction shape', async () => {
    const targetPost = createStoredPost({
      id: 'p_root',
      threadId: 'p_root',
      authorId: 'u_target',
      authorHandle: 'ada',
      authorDisplayName: 'Ada Lovelace',
      text: 'Shipped a new Functions deployment',
    })
    const store = new InMemoryNotificationDependencyStore(
      new Map([['p_root:p_root', targetPost]]),
      new Map([
        [
          'u_reactor',
          createStoredUser({
            id: 'u_reactor',
            handle: 'mira',
            displayName: 'Mira Patel',
            avatarUrl: 'https://cdn.example.com/mira.png',
          }),
        ],
      ]),
    )

    await syncReactionNotificationsBatch(
      [
        createReactionChange(),
        createReactionChange({
          sentiment: null,
          emojiValues: ['🔥', '👏'],
          updatedAt: '2026-04-15T11:05:00.000Z',
        }),
      ],
      store,
      store,
      store,
    )

    expect(store.snapshotNotifications()).toEqual([
      {
        id: 'u_target:reaction:p_root:u_reactor',
        type: 'notification',
        targetUserId: 'u_target',
        actorUserId: 'u_reactor',
        actorHandle: 'mira',
        actorDisplayName: 'Mira Patel',
        actorAvatarUrl: 'https://cdn.example.com/mira.png',
        eventType: 'reaction',
        relatedEntityId: 'p_root:u_reactor',
        postId: 'p_root',
        threadId: 'p_root',
        parentId: null,
        reactionType: 'emoji',
        reactionValues: ['🔥', '👏'],
        excerpt: 'Shipped a new Functions deployment',
        readAt: null,
        createdAt: '2026-04-15T11:00:00.000Z',
        updatedAt: '2026-04-15T11:05:00.000Z',
        eventCount: 1,
        coalesced: false,
        coalescedWindowStart: null,
        coalescedRelatedEntityIds: [],
        ttl: 7776000,
      },
    ])
  })

  it('coalesces more than the hourly threshold into a single actor notification', async () => {
    const posts = new Map<string, StoredPostDocument>([
      [
        'p_root:p_root',
        createStoredPost({
          id: 'p_root',
          threadId: 'p_root',
          authorId: 'u_target',
          text: 'Root post',
        }),
      ],
      [
        'p_second:p_second',
        createStoredPost({
          id: 'p_second',
          threadId: 'p_second',
          authorId: 'u_target',
          text: 'Second post',
        }),
      ],
      [
        'p_third:p_third',
        createStoredPost({
          id: 'p_third',
          threadId: 'p_third',
          authorId: 'u_target',
          text: 'Third post',
        }),
      ],
    ])
    const store = new InMemoryNotificationDependencyStore(
      posts,
      new Map([
        [
          'u_reactor',
          createStoredUser({
            id: 'u_reactor',
            handle: 'mira',
            displayName: 'Mira Patel',
            avatarUrl: 'https://cdn.example.com/mira.png',
          }),
        ],
      ]),
    )

    await syncReactionNotificationsBatch(
      [
        createReactionChange(),
        createReactionChange({
          id: 'p_second:u_reactor',
          postId: 'p_second',
          createdAt: '2026-04-15T11:10:00.000Z',
          updatedAt: '2026-04-15T11:10:00.000Z',
        }),
        createReactionChange({
          id: 'p_third:u_reactor',
          postId: 'p_third',
          sentiment: null,
          emojiValues: ['🔥'],
          createdAt: '2026-04-15T11:20:00.000Z',
          updatedAt: '2026-04-15T11:21:00.000Z',
        }),
      ],
      store,
      store,
      store,
      undefined,
      {
        hourlyActorThrottleThreshold: 2,
      },
    )

    expect(store.snapshotNotifications()).toEqual([
      {
        id: 'u_target:reaction:coalesced:u_reactor:2026-04-15T11:00:00.000Z',
        type: 'notification',
        targetUserId: 'u_target',
        actorUserId: 'u_reactor',
        actorHandle: 'mira',
        actorDisplayName: 'Mira Patel',
        actorAvatarUrl: 'https://cdn.example.com/mira.png',
        eventType: 'reaction',
        relatedEntityId: 'p_third:u_reactor',
        postId: 'p_third',
        threadId: 'p_third',
        parentId: null,
        reactionType: 'emoji',
        reactionValues: ['🔥'],
        excerpt: 'Third post',
        readAt: null,
        createdAt: '2026-04-15T11:00:00.000Z',
        updatedAt: '2026-04-15T11:21:00.000Z',
        eventCount: 3,
        coalesced: true,
        coalescedWindowStart: '2026-04-15T11:00:00.000Z',
        coalescedRelatedEntityIds: [
          'p_root:u_reactor',
          'p_second:u_reactor',
          'p_third:u_reactor',
        ],
        ttl: 7776000,
      },
    ])
  })

  it('keeps the coalesced count stable when an already-represented reaction changes shape', async () => {
    const posts = new Map<string, StoredPostDocument>([
      [
        'p_root:p_root',
        createStoredPost({
          id: 'p_root',
          threadId: 'p_root',
          authorId: 'u_target',
          text: 'Root post',
        }),
      ],
      [
        'p_second:p_second',
        createStoredPost({
          id: 'p_second',
          threadId: 'p_second',
          authorId: 'u_target',
          text: 'Second post',
        }),
      ],
      [
        'p_third:p_third',
        createStoredPost({
          id: 'p_third',
          threadId: 'p_third',
          authorId: 'u_target',
          text: 'Third post',
        }),
      ],
    ])
    const store = new InMemoryNotificationDependencyStore(
      posts,
      new Map([
        [
          'u_reactor',
          createStoredUser({
            id: 'u_reactor',
            handle: 'mira',
            displayName: 'Mira Patel',
          }),
        ],
      ]),
    )

    await syncReactionNotificationsBatch(
      [
        createReactionChange(),
        createReactionChange({
          id: 'p_second:u_reactor',
          postId: 'p_second',
          createdAt: '2026-04-15T11:10:00.000Z',
          updatedAt: '2026-04-15T11:10:00.000Z',
        }),
        createReactionChange({
          id: 'p_third:u_reactor',
          postId: 'p_third',
          createdAt: '2026-04-15T11:20:00.000Z',
          updatedAt: '2026-04-15T11:20:00.000Z',
        }),
      ],
      store,
      store,
      store,
      undefined,
      {
        hourlyActorThrottleThreshold: 2,
      },
    )

    await syncReactionNotificationsBatch(
      [
        createReactionChange({
          id: 'p_second:u_reactor',
          postId: 'p_second',
          sentiment: null,
          emojiValues: ['👏'],
          createdAt: '2026-04-15T11:10:00.000Z',
          updatedAt: '2026-04-15T11:45:00.000Z',
        }),
      ],
      store,
      store,
      store,
      undefined,
      {
        hourlyActorThrottleThreshold: 2,
      },
    )

    expect(store.snapshotNotifications()).toEqual([
      expect.objectContaining({
        id: 'u_target:reaction:coalesced:u_reactor:2026-04-15T11:00:00.000Z',
        relatedEntityId: 'p_second:u_reactor',
        postId: 'p_second',
        reactionType: 'emoji',
        reactionValues: ['👏'],
        updatedAt: '2026-04-15T11:45:00.000Z',
        eventCount: 3,
        coalesced: true,
        coalescedWindowStart: '2026-04-15T11:00:00.000Z',
        coalescedRelatedEntityIds: [
          'p_root:u_reactor',
          'p_second:u_reactor',
          'p_third:u_reactor',
        ],
      }),
    ])
  })

  it('skips malformed or missing-post reactions safely', async () => {
    const store = new InMemoryNotificationDependencyStore()
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await syncReactionNotificationsBatch(
      [createReactionChange({ postId: 'missing-post' })],
      store,
      store,
      store,
      logger,
    )

    expect(store.snapshotNotifications()).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reaction notification sync for reaction '%s' because post '%s' was not found.",
      'p_root:u_reactor',
      'missing-post',
    )
  })
})

describe('notification trigger functions', () => {
  it('postNotificationFn uses the injected stores for change-feed batches', async () => {
    const rootPost = createStoredPost({
      id: 'p_root',
      threadId: 'p_root',
      authorId: 'u_target',
      authorHandle: 'ada',
    })
    const store = new InMemoryNotificationDependencyStore(
      new Map([['p_root:p_root', rootPost]]),
      new Map(),
      new Map([
        ['ada', { id: 'ada', handle: 'ada', userId: 'u_target' }],
        ['mira', { id: 'mira', handle: 'mira', userId: 'u_mention' }],
      ]),
    )
    const handler = buildPostNotificationFn({
      postStoreFactory: () => store,
      profileStoreFactory: () => store,
      notificationStoreFactory: () => store,
    })
    const context = createContext()

    await handler([createPostChange()], context)

    expect(store.snapshotNotifications()).toHaveLength(2)
    expect(context.info).toHaveBeenCalledWith(
      'Upserted %d post-derived notifications.',
      2,
    )
  })

  it('reactionNotificationFn uses the injected stores for change-feed batches', async () => {
    const store = new InMemoryNotificationDependencyStore(
      new Map([
        [
          'p_root:p_root',
          createStoredPost({
            id: 'p_root',
            threadId: 'p_root',
            authorId: 'u_target',
            text: 'Target post',
          }),
        ],
      ]),
      new Map([
        [
          'u_reactor',
          createStoredUser({
            id: 'u_reactor',
            handle: 'mira',
            displayName: 'Mira Patel',
          }),
        ],
      ]),
    )
    const handler = buildReactionNotificationFn({
      postStoreFactory: () => store,
      profileStoreFactory: () => store,
      notificationStoreFactory: () => store,
    })
    const context = createContext()

    await handler([createReactionChange()], context)

    expect(store.snapshotNotifications()).toHaveLength(1)
    expect(context.info).toHaveBeenCalledWith(
      'Upserted %d reaction notifications.',
      1,
    )
  })

  it('followNotificationFn uses the injected stores for change-feed batches', async () => {
    const store = new InMemoryNotificationDependencyStore(
      new Map(),
      new Map([
        [
          'u_follower',
          createStoredUser({
            id: 'u_follower',
            handle: 'grace',
            displayName: 'Grace Hopper',
          }),
        ],
      ]),
    )
    const handler = buildFollowNotificationFn({
      profileStoreFactory: () => store,
      notificationStoreFactory: () => store,
    })
    const context = createContext()

    await handler([createFollowChange()], context)

    expect(store.snapshotNotifications()).toHaveLength(1)
    expect(context.info).toHaveBeenCalledWith(
      'Upserted %d follow notifications.',
      1,
    )
  })
})
