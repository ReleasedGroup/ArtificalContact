import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'

export const DEFAULT_NOTIFICATION_PREFS_CONTAINER_NAME = 'notificationPrefs'

export const notificationPreferenceEventTypes = [
  'follow',
  'reply',
  'reaction',
  'mention',
  'followeePost',
] as const

export type NotificationPreferenceEventType =
  (typeof notificationPreferenceEventTypes)[number]

export interface NotificationChannelPreference {
  inApp: boolean
  email: boolean
  webPush: boolean
}

export type NotificationEventPreferences = Record<
  NotificationPreferenceEventType,
  NotificationChannelPreference
>

export interface NotificationWebPushSubscription {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface NotificationPreferencesDocument {
  id: string
  type: 'notificationPrefs'
  userId: string
  events: NotificationEventPreferences
  webPush: {
    supported: boolean
    subscription: NotificationWebPushSubscription | null
  }
  createdAt: string
  updatedAt: string
}

export interface NotificationPreferencesView {
  userId: string
  events: NotificationEventPreferences
  webPush: {
    supported: boolean
    subscription: NotificationWebPushSubscription | null
  }
  createdAt: string
  updatedAt: string
}

function hasDefinedField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((fieldValue) => fieldValue !== undefined)
}

const channelPreferenceUpdateSchema = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    webPush: z.boolean().optional(),
  })
  .strict()
  .refine((value) => hasDefinedField(value as Record<string, unknown>), {
    message: 'At least one channel preference must be provided.',
  })

const notificationPreferenceEventsUpdateSchema = z
  .object({
    follow: channelPreferenceUpdateSchema.optional(),
    reply: channelPreferenceUpdateSchema.optional(),
    reaction: channelPreferenceUpdateSchema.optional(),
    mention: channelPreferenceUpdateSchema.optional(),
    followeePost: channelPreferenceUpdateSchema.optional(),
  })
  .strict()
  .refine((value) => hasDefinedField(value as Record<string, unknown>), {
    message: 'At least one notification event preference must be provided.',
  })

const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().trim().url(),
    expirationTime: z.number().int().nonnegative().nullable(),
    keys: z
      .object({
        p256dh: z.string().trim().min(1),
        auth: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict()

const notificationPreferenceWebPushUpdateSchema = z
  .object({
    supported: z.boolean().optional(),
    subscription: pushSubscriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => hasDefinedField(value as Record<string, unknown>), {
    message: 'At least one web push preference field must be provided.',
  })

export const updateNotificationPreferencesRequestSchema = z
  .object({
    events: notificationPreferenceEventsUpdateSchema.optional(),
    webPush: notificationPreferenceWebPushUpdateSchema.optional(),
  })
  .strict()
  .refine((value) => hasDefinedField(value as Record<string, unknown>), {
    message: 'At least one notification preference field must be provided.',
  })

export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>

function buildDefaultChannelPreference(
  overrides: Partial<NotificationChannelPreference> = {},
): NotificationChannelPreference {
  return {
    inApp: true,
    email: false,
    webPush: false,
    ...overrides,
  }
}

export function buildDefaultNotificationPreferences(
  userId: string,
  createdAt: Date,
): NotificationPreferencesDocument {
  const timestamp = createdAt.toISOString()

  return {
    id: userId,
    type: 'notificationPrefs',
    userId,
    events: {
      follow: buildDefaultChannelPreference(),
      reply: buildDefaultChannelPreference(),
      reaction: buildDefaultChannelPreference(),
      mention: buildDefaultChannelPreference(),
      followeePost: buildDefaultChannelPreference({
        inApp: false,
      }),
    },
    webPush: {
      supported: false,
      subscription: null,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function toNotificationPreferencesView(
  document: NotificationPreferencesDocument,
): NotificationPreferencesView {
  return {
    userId: document.userId,
    events: {
      follow: { ...document.events.follow },
      reply: { ...document.events.reply },
      reaction: { ...document.events.reaction },
      mention: { ...document.events.mention },
      followeePost: { ...document.events.followeePost },
    },
    webPush: {
      supported: document.webPush.supported,
      subscription:
        document.webPush.subscription === null
          ? null
          : {
              endpoint: document.webPush.subscription.endpoint,
              expirationTime: document.webPush.subscription.expirationTime,
              keys: { ...document.webPush.subscription.keys },
            },
    },
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

export function applyNotificationPreferencesUpdate(
  document: NotificationPreferencesDocument,
  update: UpdateNotificationPreferencesRequest,
  updatedAt: Date,
): NotificationPreferencesDocument {
  const nextDocument: NotificationPreferencesDocument = {
    ...document,
    events: {
      follow: { ...document.events.follow },
      reply: { ...document.events.reply },
      reaction: { ...document.events.reaction },
      mention: { ...document.events.mention },
      followeePost: { ...document.events.followeePost },
    },
    webPush: {
      supported: document.webPush.supported,
      subscription:
        document.webPush.subscription === null
          ? null
          : {
              endpoint: document.webPush.subscription.endpoint,
              expirationTime: document.webPush.subscription.expirationTime,
              keys: { ...document.webPush.subscription.keys },
            },
    },
    updatedAt: updatedAt.toISOString(),
  }

  if (update.events !== undefined) {
    for (const eventType of notificationPreferenceEventTypes) {
      const eventUpdate = update.events[eventType]
      if (eventUpdate === undefined) {
        continue
      }

      nextDocument.events[eventType] = {
        inApp: eventUpdate.inApp ?? nextDocument.events[eventType].inApp,
        email: eventUpdate.email ?? nextDocument.events[eventType].email,
        webPush: eventUpdate.webPush ?? nextDocument.events[eventType].webPush,
      }
    }
  }

  if (update.webPush !== undefined) {
    const disablesWebPush = update.webPush.supported === false

    if (update.webPush.supported !== undefined) {
      nextDocument.webPush.supported = update.webPush.supported
      if (disablesWebPush) {
        nextDocument.webPush.subscription = null
      }
    }

    if (update.webPush.subscription !== undefined && !disablesWebPush) {
      nextDocument.webPush.subscription =
        update.webPush.subscription === null
          ? null
          : {
              endpoint: update.webPush.subscription.endpoint,
              expirationTime: update.webPush.subscription.expirationTime,
              keys: {
                p256dh: update.webPush.subscription.keys.p256dh,
                auth: update.webPush.subscription.keys.auth,
              },
            }
    }
  }

  return nextDocument
}

export function mapNotificationPreferenceValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_notification_preferences',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}
