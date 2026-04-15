import {
  EmailClient,
  KnownEmailSendStatus,
  type EmailMessage,
} from '@azure/communication-email'
import { DefaultAzureCredential } from '@azure/identity'
import {
  buildDefaultNotificationPreferences,
  type NotificationPreferenceEventType,
} from './notification-preferences.js'
import type { NotificationPreferenceStore } from './cosmos-notification-preference-store.js'
import { getEnvironmentConfig } from './config.js'
import type {
  NotificationDocument,
  NotificationStore,
} from './notifications.js'
import { readOptionalValue } from './strings.js'
import type { UserRepository } from './users.js'

export interface NotificationEmailDeliveryState {
  sentAt: string
  operationId: string | null
  recipientAddress: string
}

export interface NotificationEmailTransportMessage {
  recipientAddress: string
  recipientDisplayName?: string
  subject: string
  plainText: string
  html: string
}

export interface NotificationEmailTransport {
  send(
    message: NotificationEmailTransportMessage,
  ): Promise<{ operationId: string | null }>
}

export interface NotificationEmailTemplate {
  subject: string
  plainText: string
  html: string
}

export interface NotificationEmailDispatcherDependencies {
  notificationStore: Pick<NotificationStore, 'upsertNotification'>
  preferenceStore: Pick<NotificationPreferenceStore, 'getByUserId'>
  userRepository: Pick<UserRepository, 'getById'>
  transport: NotificationEmailTransport
  now?: () => Date
}

const supportedNotificationEmailEventTypes = [
  'follow',
  'reply',
  'reaction',
] as const

type SupportedNotificationEmailEventType =
  (typeof supportedNotificationEmailEventTypes)[number]

function isSupportedNotificationEmailEventType(
  eventType: NotificationDocument['eventType'],
): eventType is SupportedNotificationEmailEventType {
  return supportedNotificationEmailEventTypes.includes(
    eventType as SupportedNotificationEmailEventType,
  )
}

function normalizeEmailAddress(value: string | undefined): string | null {
  const normalizedValue = readOptionalValue(value)
  return normalizedValue === undefined ? null : normalizedValue
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function quoteExcerpt(excerpt: string | null): string {
  if (excerpt === null) {
    return ''
  }

  return `\n\n"${excerpt}"`
}

function toHtmlParagraphs(lines: string[]): string {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

function resolveActorDisplayName(notification: NotificationDocument): string {
  return (
    readOptionalValue(notification.actorDisplayName ?? undefined) ??
    readOptionalValue(notification.actorHandle ?? undefined) ??
    'Someone'
  )
}

function buildFollowEmailTemplate(
  notification: NotificationDocument,
): NotificationEmailTemplate {
  const actorDisplayName = resolveActorDisplayName(notification)

  return {
    subject: `${actorDisplayName} followed you on ArtificialContact`,
    plainText: `${actorDisplayName} started following you on ArtificialContact.`,
    html: toHtmlParagraphs([
      `${actorDisplayName} started following you on ArtificialContact.`,
    ]),
  }
}

function buildReplyEmailTemplate(
  notification: NotificationDocument,
): NotificationEmailTemplate {
  const actorDisplayName = resolveActorDisplayName(notification)
  const excerpt =
    normalizeEmailAddress(notification.excerpt ?? undefined) ??
    'They replied to one of your posts.'

  return {
    subject: `${actorDisplayName} replied to your post`,
    plainText: `${actorDisplayName} replied to your post.${quoteExcerpt(excerpt)}`,
    html: toHtmlParagraphs([
      `${actorDisplayName} replied to your post.`,
      excerpt,
    ]),
  }
}

function buildReactionDigestEmailTemplate(
  notification: NotificationDocument,
): NotificationEmailTemplate | null {
  if (notification.coalesced !== true) {
    return null
  }

  const actorDisplayName = resolveActorDisplayName(notification)
  const eventCount =
    typeof notification.eventCount === 'number' && notification.eventCount > 0
      ? notification.eventCount
      : 1
  const excerpt =
    normalizeEmailAddress(notification.excerpt ?? undefined) ??
    'One of your posts received new reactions.'

  return {
    subject: `${actorDisplayName} reacted ${eventCount} times to your posts`,
    plainText: `${actorDisplayName} reacted ${eventCount} times to your posts this hour.${quoteExcerpt(excerpt)}`,
    html: toHtmlParagraphs([
      `${actorDisplayName} reacted ${eventCount} times to your posts this hour.`,
      excerpt,
    ]),
  }
}

export function buildNotificationEmailTemplate(
  notification: NotificationDocument,
): NotificationEmailTemplate | null {
  switch (notification.eventType) {
    case 'follow':
      return buildFollowEmailTemplate(notification)
    case 'reply':
      return buildReplyEmailTemplate(notification)
    case 'reaction':
      return buildReactionDigestEmailTemplate(notification)
    default:
      return null
  }
}

export class AcsNotificationEmailTransport
  implements NotificationEmailTransport
{
  constructor(
    private readonly emailClient: EmailClient,
    private readonly senderAddress: string,
  ) {}

  async send(
    message: NotificationEmailTransportMessage,
  ): Promise<{ operationId: string | null }> {
    const poller = await this.emailClient.beginSend({
      senderAddress: this.senderAddress,
      content: {
        subject: message.subject,
        plainText: message.plainText,
        html: message.html,
      },
      recipients: {
        to: [
          {
            address: message.recipientAddress,
            ...(message.recipientDisplayName === undefined
              ? {}
              : { displayName: message.recipientDisplayName }),
          },
        ],
      },
    } satisfies EmailMessage)
    const result = await poller.pollUntilDone()

    if (result.status !== KnownEmailSendStatus.Succeeded) {
      throw new Error(
        result.error?.message ??
          `Email send failed with status '${result.status}'.`,
      )
    }

    return {
      operationId: result.id ?? null,
    }
  }
}

export function createNotificationEmailTransportFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NotificationEmailTransport | null {
  const config = getEnvironmentConfig(env)
  const senderAddress = config.communicationServicesEmailSenderAddress
  const connectionString = config.communicationServicesConnectionString
  const endpoint = config.communicationServicesEndpoint

  if (
    senderAddress === undefined &&
    connectionString === undefined &&
    endpoint === undefined
  ) {
    return null
  }

  if (senderAddress === undefined) {
    throw new Error(
      'COMMUNICATION_SERVICES_EMAIL_SENDER_ADDRESS is required to send notification email.',
    )
  }

  if (connectionString !== undefined) {
    return new AcsNotificationEmailTransport(
      new EmailClient(connectionString),
      senderAddress,
    )
  }

  if (endpoint === undefined) {
    throw new Error(
      'COMMUNICATION_SERVICES_ENDPOINT or COMMUNICATION_SERVICES_CONNECTION_STRING is required to send notification email.',
    )
  }

  return new AcsNotificationEmailTransport(
    new EmailClient(endpoint, new DefaultAzureCredential()),
    senderAddress,
  )
}

function hasDeliveredNotificationEmail(
  notification: NotificationDocument,
): boolean {
  return normalizeEmailAddress(notification.emailDelivery?.sentAt) !== null
}

function getNotificationEmailPreference(
  notification: NotificationDocument,
  preferences: ReturnType<typeof buildDefaultNotificationPreferences>,
): boolean {
  if (!isSupportedNotificationEmailEventType(notification.eventType)) {
    return false
  }

  const eventType = notification.eventType as NotificationPreferenceEventType
  return preferences.events[eventType].email
}

export async function dispatchNotificationEmails(
  notifications: readonly NotificationDocument[],
  dependencies: NotificationEmailDispatcherDependencies,
): Promise<number> {
  const now = dependencies.now ?? (() => new Date())
  const preferenceCache = new Map<
    string,
    Awaited<ReturnType<NotificationPreferenceStore['getByUserId']>>
  >()
  const userCache = new Map<string, Awaited<ReturnType<UserRepository['getById']>>>()
  let deliveredCount = 0

  for (const notification of notifications) {
    if (hasDeliveredNotificationEmail(notification)) {
      continue
    }

    const template = buildNotificationEmailTemplate(notification)
    if (template === null) {
      continue
    }

    let preferences = preferenceCache.get(notification.targetUserId)
    if (preferences === undefined) {
      preferences = await dependencies.preferenceStore.getByUserId(
        notification.targetUserId,
      )
      preferenceCache.set(notification.targetUserId, preferences)
    }

    const resolvedPreferences =
      preferences ??
      buildDefaultNotificationPreferences(notification.targetUserId, now())

    if (!getNotificationEmailPreference(notification, resolvedPreferences)) {
      continue
    }

    let user = userCache.get(notification.targetUserId)
    if (user === undefined) {
      user = await dependencies.userRepository.getById(notification.targetUserId)
      userCache.set(notification.targetUserId, user)
    }

    const recipientAddress = normalizeEmailAddress(user?.email)
    if (recipientAddress === null) {
      continue
    }

    const recipientDisplayName =
      normalizeEmailAddress(user?.displayName) ?? undefined
    const result = await dependencies.transport.send({
      recipientAddress,
      subject: template.subject,
      plainText: template.plainText,
      html: template.html,
      ...(recipientDisplayName === undefined
        ? {}
        : { recipientDisplayName }),
    })

    await dependencies.notificationStore.upsertNotification({
      ...notification,
      emailDelivery: {
        sentAt: now().toISOString(),
        operationId: result.operationId,
        recipientAddress,
      },
    })
    deliveredCount += 1
  }

  return deliveredCount
}
