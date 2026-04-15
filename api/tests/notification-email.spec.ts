import { describe, expect, it, vi } from 'vitest'
import type { NotificationPreferenceStore } from '../src/lib/cosmos-notification-preference-store.js'
import {
  buildDefaultNotificationPreferences,
  type NotificationChannelPreference,
  type NotificationPreferencesDocument,
} from '../src/lib/notification-preferences.js'
import {
  buildNotificationEmailTemplate,
  createNotificationEmailTransportFromEnvironment,
  dispatchNotificationEmails,
  type NotificationEmailTransport,
} from '../src/lib/notification-email.js'
import type {
  NotificationDocument,
  NotificationStore,
} from '../src/lib/notifications.js'
import type { UserRepository } from '../src/lib/users.js'
import type { UserDocument } from '../src/lib/users.js'

function createNotification(
  overrides: Partial<NotificationDocument> & {
    id: string
    targetUserId: string
    actorUserId: string
    eventType: NotificationDocument['eventType']
    relatedEntityId: string
    createdAt: string
    updatedAt: string
  },
): NotificationDocument {
  return {
    type: 'notification',
    actorHandle: 'grace',
    actorDisplayName: 'Grace Hopper',
    actorAvatarUrl: null,
    postId: null,
    threadId: null,
    parentId: null,
    reactionType: null,
    reactionValues: [],
    excerpt: null,
    readAt: null,
    eventCount: 1,
    coalesced: false,
    coalescedWindowStart: null,
    coalescedRelatedEntityIds: [],
    ttl: 7776000,
    ...overrides,
  }
}

class InMemoryNotificationStore
  implements Pick<NotificationStore, 'upsertNotification'>
{
  public readonly upsertedNotifications: NotificationDocument[] = []

  async upsertNotification(document: NotificationDocument): Promise<void> {
    this.upsertedNotifications.push({ ...document })
  }
}

function createPreferences(
  emailOverrides: Partial<
    Record<
      keyof NotificationPreferencesDocument['events'],
      Partial<NotificationChannelPreference>
    >
  > = {},
): NotificationPreferencesDocument {
  return {
    ...buildDefaultNotificationPreferences(
      'github:abc123',
      new Date('2026-04-15T00:00:00.000Z'),
    ),
    events: {
      follow: {
        inApp: true,
        email: false,
        webPush: false,
        ...emailOverrides.follow,
      },
      reply: {
        inApp: true,
        email: false,
        webPush: false,
        ...emailOverrides.reply,
      },
      reaction: {
        inApp: true,
        email: false,
        webPush: false,
        ...emailOverrides.reaction,
      },
      mention: {
        inApp: true,
        email: false,
        webPush: false,
        ...emailOverrides.mention,
      },
      followeePost: {
        inApp: false,
        email: false,
        webPush: false,
        ...emailOverrides.followeePost,
      },
    },
  }
}

function createUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'u_target',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'abc123',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    expertise: [],
    links: {},
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 0,
      followers: 0,
      following: 0,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildNotificationEmailTemplate', () => {
  it('renders a reply email with the quoted reply text', () => {
    const template = buildNotificationEmailTemplate(
      createNotification({
        id: 'u_target:reply:p_reply',
        targetUserId: 'u_target',
        actorUserId: 'u_reply_author',
        eventType: 'reply',
        relatedEntityId: 'p_reply',
        excerpt: 'Thanks for the detailed write-up.',
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
      }),
    )

    expect(template).toEqual({
      subject: 'Grace Hopper replied to your post',
      plainText:
        'Grace Hopper replied to your post.\n\n"Thanks for the detailed write-up."',
      html: '<p>Grace Hopper replied to your post.</p><p>Thanks for the detailed write-up.</p>',
    })
  })

  it('only renders reaction email content for coalesced digest notifications', () => {
    const digestTemplate = buildNotificationEmailTemplate(
      createNotification({
        id: 'u_target:reaction:coalesced:u_actor:2026-04-15T11:00:00.000Z',
        targetUserId: 'u_target',
        actorUserId: 'u_actor',
        eventType: 'reaction',
        relatedEntityId: 'p_third:u_actor',
        excerpt: 'Third post',
        eventCount: 4,
        coalesced: true,
        createdAt: '2026-04-15T11:00:00.000Z',
        updatedAt: '2026-04-15T11:20:00.000Z',
      }),
    )
    const individualTemplate = buildNotificationEmailTemplate(
      createNotification({
        id: 'u_target:reaction:p_root:u_actor',
        targetUserId: 'u_target',
        actorUserId: 'u_actor',
        eventType: 'reaction',
        relatedEntityId: 'p_root:u_actor',
        createdAt: '2026-04-15T11:00:00.000Z',
        updatedAt: '2026-04-15T11:00:00.000Z',
      }),
    )

    expect(digestTemplate).toEqual({
      subject: 'Grace Hopper reacted 4 times to your posts',
      plainText:
        'Grace Hopper reacted 4 times to your posts this hour.\n\n"Third post"',
      html:
        '<p>Grace Hopper reacted 4 times to your posts this hour.</p><p>Third post</p>',
    })
    expect(individualTemplate).toBeNull()
  })
})

describe('dispatchNotificationEmails', () => {
  it('sends opted-in follow emails and persists the delivery marker', async () => {
    const notificationStore = new InMemoryNotificationStore()
    const transport: NotificationEmailTransport = {
      send: vi.fn(async () => ({ operationId: 'op-123' })),
    }
    const preferenceStore: Pick<NotificationPreferenceStore, 'getByUserId'> = {
      getByUserId: vi.fn(async () =>
        createPreferences({
          follow: { email: true },
        }),
      ),
    }
    const userRepository: Pick<UserRepository, 'getById'> = {
      getById: vi.fn(async () => createUser()),
    }

    const deliveredCount = await dispatchNotificationEmails(
      [
        createNotification({
          id: 'u_target:follow:u_actor:u_target',
          targetUserId: 'u_target',
          actorUserId: 'u_actor',
          eventType: 'follow',
          relatedEntityId: 'u_actor:u_target',
          createdAt: '2026-04-15T08:00:00.000Z',
          updatedAt: '2026-04-15T08:00:00.000Z',
        }),
      ],
      {
        notificationStore,
        preferenceStore,
        transport,
        userRepository,
        now: () => new Date('2026-04-15T08:05:00.000Z'),
      },
    )

    expect(deliveredCount).toBe(1)
    expect(transport.send).toHaveBeenCalledWith({
      recipientAddress: 'ada@example.com',
      recipientDisplayName: 'Ada Lovelace',
      subject: 'Grace Hopper followed you on ArtificialContact',
      plainText: 'Grace Hopper started following you on ArtificialContact.',
      html: '<p>Grace Hopper started following you on ArtificialContact.</p>',
    })
    expect(notificationStore.upsertedNotifications).toEqual([
      expect.objectContaining({
        emailDelivery: {
          sentAt: '2026-04-15T08:05:00.000Z',
          operationId: 'op-123',
          recipientAddress: 'ada@example.com',
        },
      }),
    ])
  })

  it('skips reaction emails until the notification has been coalesced into a digest', async () => {
    const notificationStore = new InMemoryNotificationStore()
    const transport: NotificationEmailTransport = {
      send: vi.fn(async () => ({ operationId: 'op-123' })),
    }

    const deliveredCount = await dispatchNotificationEmails(
      [
        createNotification({
          id: 'u_target:reaction:p_root:u_actor',
          targetUserId: 'u_target',
          actorUserId: 'u_actor',
          eventType: 'reaction',
          relatedEntityId: 'p_root:u_actor',
          createdAt: '2026-04-15T11:00:00.000Z',
          updatedAt: '2026-04-15T11:00:00.000Z',
        }),
      ],
      {
        notificationStore,
        preferenceStore: {
          getByUserId: vi.fn(async () =>
            createPreferences({
              reaction: { email: true },
            }),
          ),
        },
        transport,
        userRepository: {
          getById: vi.fn(async () => createUser()),
        },
      },
    )

    expect(deliveredCount).toBe(0)
    expect(transport.send).not.toHaveBeenCalled()
    expect(notificationStore.upsertedNotifications).toEqual([])
  })

  it('does not resend a notification email after the delivery marker is present', async () => {
    const transport: NotificationEmailTransport = {
      send: vi.fn(async () => ({ operationId: 'op-123' })),
    }

    const deliveredCount = await dispatchNotificationEmails(
      [
        createNotification({
          id: 'u_target:follow:u_actor:u_target',
          targetUserId: 'u_target',
          actorUserId: 'u_actor',
          eventType: 'follow',
          relatedEntityId: 'u_actor:u_target',
          createdAt: '2026-04-15T08:00:00.000Z',
          updatedAt: '2026-04-15T08:00:00.000Z',
          emailDelivery: {
            sentAt: '2026-04-15T08:05:00.000Z',
            operationId: 'op-123',
            recipientAddress: 'ada@example.com',
          },
        }),
      ],
      {
        notificationStore: new InMemoryNotificationStore(),
        preferenceStore: {
          getByUserId: vi.fn(async () =>
            createPreferences({
              follow: { email: true },
            }),
          ),
        },
        transport,
        userRepository: {
          getById: vi.fn(async () => null),
        },
      },
    )

    expect(deliveredCount).toBe(0)
    expect(transport.send).not.toHaveBeenCalled()
  })
})

describe('createNotificationEmailTransportFromEnvironment', () => {
  it('returns null when ACS email settings are absent', () => {
    expect(createNotificationEmailTransportFromEnvironment({})).toBeNull()
  })

  it('requires a sender address when ACS configuration is present', () => {
    expect(() =>
      createNotificationEmailTransportFromEnvironment({
        COMMUNICATION_SERVICES_ENDPOINT:
          'https://example.communication.azure.com',
      }),
    ).toThrow(
      'COMMUNICATION_SERVICES_EMAIL_SENDER_ADDRESS is required to send notification email.',
    )
  })
})
