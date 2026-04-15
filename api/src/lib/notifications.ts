import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiEnvelope, ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import type { FollowDocument } from './follows.js'
import {
  isPubliclyVisiblePost,
  type PostStore,
  type StoredPostDocument,
} from './posts.js'
import {
  isReactionDocumentEmpty,
  type ReactionDocument,
  type ReactionType,
} from './reactions.js'
import { readOptionalValue } from './strings.js'
import type { StoredUserDocument, UserProfileStore } from './user-profile.js'

export const DEFAULT_NOTIFICATIONS_CONTAINER_NAME = 'notifications'
export const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 90
export const DEFAULT_NOTIFICATIONS_PAGE_SIZE = 20
export const MAX_NOTIFICATIONS_PAGE_SIZE = 100
export const DEFAULT_REACTION_NOTIFICATION_HOURLY_THRESHOLD = 3

let cachedNotificationRepository: NotificationRepository | undefined

type CosmosLikeError = Error & {
  code?: number | string
  statusCode?: number | string
}

export type NotificationEventType = 'follow' | 'reply' | 'reaction' | 'mention'

export interface NotificationDocument {
  id: string
  type: 'notification'
  targetUserId: string
  actorUserId: string
  actorHandle: string | null
  actorDisplayName: string | null
  actorAvatarUrl: string | null
  eventType: NotificationEventType
  relatedEntityId: string
  postId: string | null
  threadId: string | null
  parentId: string | null
  reactionType: ReactionType | null
  reactionValues: string[]
  excerpt: string | null
  readAt: string | null
  createdAt: string
  updatedAt: string
  eventCount?: number
  coalesced?: boolean
  coalescedWindowStart?: string | null
  coalescedRelatedEntityIds?: string[]
  ttl: number
}

export type StoredNotificationDocument = NotificationDocument

export interface NotificationStore {
  upsertNotification(document: NotificationDocument): Promise<void>
  listNotificationsByActorAndWindow(
    targetUserId: string,
    eventType: NotificationEventType,
    actorUserId: string,
    windowStart: string,
    windowEndExclusive: string,
  ): Promise<NotificationDocument[]>
  deleteNotification(targetUserId: string, notificationId: string): Promise<void>
}

export interface NotificationReadStore {
  listNotifications(
    targetUserId: string,
    options: {
      limit: number
      cursor?: string
    },
  ): Promise<{
    notifications: StoredNotificationDocument[]
    cursor?: string
  }>
  countUnreadNotifications(targetUserId: string): Promise<number>
}

export interface NotificationRepository {
  getByTargetUserAndId(
    targetUserId: string,
    notificationId: string,
  ): Promise<NotificationDocument | null>
  listUnreadByTargetUserId(targetUserId: string): Promise<NotificationDocument[]>
  upsert(notification: NotificationDocument): Promise<NotificationDocument>
}

export type MarkNotificationsReadRequest =
  | {
      scope: 'all'
    }
  | {
      scope: 'single'
      notificationId: string
    }

export interface NotificationReadMutationResult {
  changed: boolean
  notification: NotificationDocument
}

export type NotificationProfileStore = Pick<
  UserProfileStore,
  'getByHandle' | 'getUserById'
>

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface NotificationActor {
  userId: string
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export type NotificationPostSourceDocument = StoredPostDocument
export type NotificationReactionSourceDocument = ReactionDocument
export type NotificationFollowSourceDocument = FollowDocument

export interface NotificationEntry {
  id: string
  eventType: NotificationEventType
  actorUserId: string
  actorHandle: string | null
  actorDisplayName: string | null
  actorAvatarUrl: string | null
  relatedEntityId: string
  postId: string | null
  threadId: string | null
  parentId: string | null
  reactionType: ReactionType | null
  reactionValues: string[]
  excerpt: string | null
  read: boolean
  readAt: string | null
  createdAt: string
  updatedAt: string
  eventCount: number
  coalesced: boolean
  coalescedWindowStart: string | null
}

export interface NotificationPage {
  notifications: NotificationEntry[]
  unreadCount: number
}

export interface NotificationsPageRequest {
  targetUserId: string | undefined
  limit?: string | undefined
  cursor?: string | undefined
}

export interface NotificationsLookupResult {
  status: 200 | 400
  body: ApiEnvelope<NotificationPage | null> & {
    cursor: string | null
  }
}

const noop = (): void => undefined

const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
  error: noop,
}

function isExpectedCosmosStatusCode(
  error: unknown,
  expectedStatusCode: number,
): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cosmosError = error as CosmosLikeError
  const statusCodeValues = [cosmosError.statusCode, cosmosError.code]

  return statusCodeValues.some((value) => {
    if (typeof value === 'number') {
      return value === expectedStatusCode
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value, 10) === expectedStatusCode
    }

    return false
  })
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map((entry) => toNonEmptyString(entry)?.toLowerCase() ?? null)
        .filter((entry): entry is string => entry !== null),
    ),
  ]
}

function toNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0
    ? value
    : 0
}

function toDistinctStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map((entry) => toNonEmptyString(entry))
        .filter((entry): entry is string => entry !== null),
    ),
  ]
}

function collapseDocumentsToLatest<T extends { id?: string | null }>(
  documents: readonly T[],
): T[] {
  const latestById = new Map<string, T>()

  for (const document of documents) {
    const id = toNonEmptyString(document.id)
    if (id === null) {
      continue
    }

    latestById.set(id, document)
  }

  return [...latestById.values()]
}

function buildExcerpt(text: unknown): string | null {
  return toNonEmptyString(text)
}

function buildUtcHourWindow(
  timestamp: string,
): { start: string; endExclusive: string } | null {
  const parsedTimestamp = new Date(timestamp)
  if (Number.isNaN(parsedTimestamp.getTime())) {
    return null
  }

  const hourStart = new Date(parsedTimestamp)
  hourStart.setUTCMinutes(0, 0, 0)

  const hourEnd = new Date(hourStart)
  hourEnd.setUTCHours(hourEnd.getUTCHours() + 1)

  return {
    start: hourStart.toISOString(),
    endExclusive: hourEnd.toISOString(),
  }
}

function extractCoalescedEntityIds(document: NotificationDocument): string[] {
  const coalescedIds = toDistinctStringArray(document.coalescedRelatedEntityIds)
  if (coalescedIds.length > 0) {
    return coalescedIds
  }

  const relatedEntityId = toNonEmptyString(document.relatedEntityId)
  return relatedEntityId === null ? [] : [relatedEntityId]
}

function getEarliestCreatedAt(
  documents: readonly NotificationDocument[],
  fallback: string,
): string {
  let earliestTimestamp = fallback
  let earliestValue = new Date(fallback).getTime()

  if (Number.isNaN(earliestValue)) {
    return fallback
  }

  for (const document of documents) {
    const candidateValue = new Date(document.createdAt).getTime()
    if (Number.isNaN(candidateValue)) {
      continue
    }

    if (candidateValue < earliestValue) {
      earliestTimestamp = document.createdAt
      earliestValue = candidateValue
    }
  }

  return earliestTimestamp
}

function buildReactionThrottleNotificationId(
  targetUserId: string,
  actorUserId: string,
  windowStart: string,
): string {
  return buildNotificationId(
    targetUserId,
    'reaction',
    `coalesced:${actorUserId}:${windowStart}`,
  )
}

function buildReactionType(
  reaction: Pick<ReactionDocument, 'sentiment' | 'emojiValues' | 'gifValue'>,
): ReactionType | null {
  if (reaction.sentiment === 'like' || reaction.sentiment === 'dislike') {
    return reaction.sentiment
  }

  if (toStringArray(reaction.emojiValues).length > 0) {
    return 'emoji'
  }

  if (toNonEmptyString(reaction.gifValue) !== null) {
    return 'gif'
  }

  return null
}

function buildReactionValues(
  reaction: Pick<ReactionDocument, 'emojiValues' | 'gifValue'>,
): string[] {
  const emojiValues = toStringArray(reaction.emojiValues)
  if (emojiValues.length > 0) {
    return emojiValues
  }

  const gifValue = toNonEmptyString(reaction.gifValue)
  return gifValue === null ? [] : [gifValue]
}

function buildNotificationDocument(
  eventType: NotificationEventType,
  actor: NotificationActor,
  targetUserId: string,
  relatedEntityId: string,
  createdAt: string,
  updatedAt: string,
  options: {
    notificationId?: string
    postId?: string | null
    threadId?: string | null
    parentId?: string | null
    reactionType?: ReactionType | null
    reactionValues?: string[]
    excerpt?: string | null
    eventCount?: number
    coalesced?: boolean
    coalescedWindowStart?: string | null
    coalescedRelatedEntityIds?: string[]
  } = {},
): NotificationDocument {
  return {
    id:
      options.notificationId ??
      buildNotificationId(targetUserId, eventType, relatedEntityId),
    type: 'notification',
    targetUserId,
    actorUserId: actor.userId,
    actorHandle: actor.handle,
    actorDisplayName: actor.displayName,
    actorAvatarUrl: actor.avatarUrl,
    eventType,
    relatedEntityId,
    postId: options.postId ?? null,
    threadId: options.threadId ?? null,
    parentId: options.parentId ?? null,
    reactionType: options.reactionType ?? null,
    reactionValues: options.reactionValues ?? [],
    excerpt: options.excerpt ?? null,
    readAt: null,
    createdAt,
    updatedAt,
    eventCount: options.eventCount ?? 1,
    coalesced: options.coalesced ?? false,
    coalescedWindowStart: options.coalescedWindowStart ?? null,
    coalescedRelatedEntityIds: options.coalescedRelatedEntityIds ?? [],
    ttl: NOTIFICATION_TTL_SECONDS,
  }
}

function buildActorFromUser(
  userId: string,
  user: StoredUserDocument | null,
): NotificationActor {
  return {
    userId,
    handle:
      toNonEmptyString(user?.handle) ?? toNonEmptyString(user?.handleLower),
    displayName: toNonEmptyString(user?.displayName),
    avatarUrl: toNonEmptyString(user?.avatarUrl),
  }
}

async function loadActorFromProfileStore(
  userId: string,
  profileStore: NotificationProfileStore,
  actorCache: Map<string, NotificationActor>,
): Promise<NotificationActor> {
  const cachedActor = actorCache.get(userId)
  if (cachedActor !== undefined) {
    return cachedActor
  }

  const actor = buildActorFromUser(userId, await profileStore.getUserById(userId))
  actorCache.set(userId, actor)
  return actor
}

async function resolveMentionTargets(
  handles: readonly string[],
  profileStore: NotificationProfileStore,
  mentionCache: Map<string, string | null>,
): Promise<string[]> {
  const targets: string[] = []

  for (const handle of handles) {
    let userId = mentionCache.get(handle)
    if (userId === undefined) {
      userId = (await profileStore.getByHandle(handle))?.userId ?? null
      mentionCache.set(handle, userId)
    }

    if (userId !== null) {
      targets.push(userId)
    }
  }

  return [...new Set(targets)]
}

function buildActorFromPost(
  post: Pick<
    StoredPostDocument,
    'authorId' | 'authorHandle' | 'authorDisplayName' | 'authorAvatarUrl'
  >,
): NotificationActor | null {
  const userId = toNonEmptyString(post.authorId)
  if (userId === null) {
    return null
  }

  return {
    userId,
    handle: toNonEmptyString(post.authorHandle),
    displayName: toNonEmptyString(post.authorDisplayName),
    avatarUrl: toNonEmptyString(post.authorAvatarUrl),
  }
}

export function createNotificationRepositoryForContainer(
  container: Container,
): NotificationRepository {
  return {
    async getByTargetUserAndId(targetUserId, notificationId) {
      try {
        const response = await container
          .item(notificationId, targetUserId)
          .read<NotificationDocument>()

        return response.resource ?? null
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return null
        }

        throw error
      }
    },

    async listUnreadByTargetUserId(targetUserId) {
      const queryIterator = container.items.query<NotificationDocument>(
        {
          query: `
            SELECT * FROM c
            WHERE c.type = @type
            AND (
              NOT IS_DEFINED(c.read)
              OR IS_NULL(c.read)
              OR c.read = false
            )
            AND (
              NOT IS_DEFINED(c.readAt)
              OR IS_NULL(c.readAt)
              OR LENGTH(TRIM(c.readAt)) = 0
            )
            ORDER BY c.createdAt DESC, c.id DESC
          `,
          parameters: [{ name: '@type', value: 'notification' }],
        },
        {
          maxItemCount: 100,
          partitionKey: targetUserId,
        },
      )

      const resources: NotificationDocument[] = []

      while (queryIterator.hasMoreResults()) {
        const { resources: pageResources } = await queryIterator.fetchNext()

        if (pageResources?.length) {
          resources.push(...pageResources)
        }
      }

      return resources
    },

    async upsert(notification) {
      const response = await container.items.upsert<NotificationDocument>(
        notification,
      )

      return response.resource ?? notification
    },
  }
}

function buildInvalidTargetUserIdResult(): NotificationsLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      cursor: null,
      errors: [
        {
          code: 'invalid_target_user_id',
          message:
            'The authenticated user id is required to load notifications.',
          field: 'targetUserId',
        },
      ],
    },
  }
}

function buildInvalidLimitResult(): NotificationsLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      cursor: null,
      errors: [
        {
          code: 'invalid_limit',
          message: `The limit query parameter must be an integer between 1 and ${MAX_NOTIFICATIONS_PAGE_SIZE}.`,
          field: 'limit',
        },
      ],
    },
  }
}

function normalizeNotificationsPageLimit(limit: string | undefined): number | null {
  const normalizedLimit = toNonEmptyString(limit)
  if (normalizedLimit === null) {
    return DEFAULT_NOTIFICATIONS_PAGE_SIZE
  }

  if (!/^\d+$/.test(normalizedLimit)) {
    return null
  }

  const parsedLimit = Number.parseInt(normalizedLimit, 10)
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_NOTIFICATIONS_PAGE_SIZE
  ) {
    return null
  }

  return parsedLimit
}

export function buildNotificationId(
  targetUserId: string,
  eventType: NotificationEventType,
  relatedEntityId: string,
): string {
  return `${targetUserId}:${eventType}:${relatedEntityId}`
}

export function buildNotificationEntry(
  document: StoredNotificationDocument,
): NotificationEntry | null {
  const id = toNonEmptyString(document.id)
  const actorUserId = toNonEmptyString(document.actorUserId)
  const relatedEntityId = toNonEmptyString(document.relatedEntityId)
  const createdAt = toNonEmptyString(document.createdAt)
  const updatedAt = toNonEmptyString(document.updatedAt)

  if (
    id === null ||
    actorUserId === null ||
    relatedEntityId === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null
  }

  return {
    id,
    eventType: document.eventType,
    actorUserId,
    actorHandle: toNonEmptyString(document.actorHandle),
    actorDisplayName: toNonEmptyString(document.actorDisplayName),
    actorAvatarUrl: toNonEmptyString(document.actorAvatarUrl),
    relatedEntityId,
    postId: toNonEmptyString(document.postId),
    threadId: toNonEmptyString(document.threadId),
    parentId: toNonEmptyString(document.parentId),
    reactionType: document.reactionType ?? null,
    reactionValues: toStringArray(document.reactionValues),
    excerpt: toNonEmptyString(document.excerpt),
    read: toNonEmptyString(document.readAt) !== null,
    readAt: toNonEmptyString(document.readAt),
    createdAt,
    updatedAt,
    eventCount:
      toNonNegativeInteger(document.eventCount) > 0
        ? toNonNegativeInteger(document.eventCount)
        : 1,
    coalesced: document.coalesced === true,
    coalescedWindowStart: toNonEmptyString(document.coalescedWindowStart),
  }
}

export async function lookupNotifications(
  request: NotificationsPageRequest,
  store: NotificationReadStore,
): Promise<NotificationsLookupResult> {
  const targetUserId = toNonEmptyString(request.targetUserId)
  if (targetUserId === null) {
    return buildInvalidTargetUserIdResult()
  }

  const limit = normalizeNotificationsPageLimit(request.limit)
  if (limit === null) {
    return buildInvalidLimitResult()
  }

  const cursor = toNonEmptyString(request.cursor) ?? undefined
  const [page, unreadCount] = await Promise.all([
    store.listNotifications(targetUserId, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    }),
    store.countUnreadNotifications(targetUserId),
  ])

  return {
    status: 200,
    body: {
      data: {
        notifications: page.notifications
          .map((notification) => buildNotificationEntry(notification))
          .filter(
            (notification): notification is NotificationEntry =>
              notification !== null,
          ),
        unreadCount: toNonNegativeInteger(unreadCount),
      },
      cursor: page.cursor ?? null,
      errors: [],
    },
  }
}

export function buildMarkNotificationsReadRequestSchema() {
  return z
    .object({
      all: z.boolean().optional(),
      notificationId: z.preprocess(
        normalizeOptionalString,
        z.string().optional(),
      ),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.all !== undefined && value.all !== true) {
        context.addIssue({
          code: 'custom',
          message: 'The all field must be true when provided.',
          path: ['all'],
        })
      }

      const hasAll = value.all === true
      const hasNotificationId = value.notificationId !== undefined

      if (hasAll && hasNotificationId) {
        context.addIssue({
          code: 'custom',
          message: 'Specify either all=true or notificationId, but not both.',
          path: ['notificationId'],
        })
        return
      }

      if (!hasAll && !hasNotificationId) {
        context.addIssue({
          code: 'custom',
          message: 'Specify either all=true or notificationId.',
          path: ['notificationId'],
        })
      }
    })
    .transform((value): MarkNotificationsReadRequest => {
      if (value.notificationId !== undefined) {
        return {
          scope: 'single',
          notificationId: value.notificationId,
        }
      }

      return {
        scope: 'all',
      }
    })
}

export function mapMarkNotificationsReadValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_notification_read',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function isNotificationRead(
  notification: Pick<NotificationDocument, 'readAt'>,
): boolean {
  return readOptionalValue(notification.readAt ?? undefined) !== undefined
}

export function applyNotificationRead(
  notification: NotificationDocument,
  now: Date,
): NotificationReadMutationResult {
  if (isNotificationRead(notification)) {
    return {
      changed: false,
      notification,
    }
  }

  const timestamp = now.toISOString()

  return {
    changed: true,
    notification: {
      ...notification,
      readAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

export function createNotificationRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): NotificationRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error(
      'COSMOS_DATABASE_NAME is required to resolve notifications.',
    )
  }

  const notificationsContainerName =
    readOptionalValue(env.NOTIFICATIONS_CONTAINER_NAME) ??
    DEFAULT_NOTIFICATIONS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(notificationsContainerName)

  return createNotificationRepositoryForContainer(container)
}

export function createNotificationRepository(): NotificationRepository {
  cachedNotificationRepository ??= createNotificationRepositoryFromConfig(
    getEnvironmentConfig(),
  )

  return cachedNotificationRepository
}

export async function syncFollowNotificationsBatch(
  documents: readonly NotificationFollowSourceDocument[],
  profileStore: NotificationProfileStore,
  notificationStore: NotificationStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const latestDocuments = collapseDocumentsToLatest(documents)
  const actorCache = new Map<string, NotificationActor>()
  let upsertCount = 0

  for (const document of latestDocuments) {
    const followId = toNonEmptyString(document.id)
    const followerId = toNonEmptyString(document.followerId)
    const followedId = toNonEmptyString(document.followedId)
    const createdAt = toNonEmptyString(document.createdAt)

    if (
      followId === null ||
      document.type !== 'follow' ||
      followerId === null ||
      followedId === null ||
      createdAt === null
    ) {
      logger.warn(
        'Skipping notification sync for an invalid follow document.',
      )
      continue
    }

    if (
      toNonEmptyString(document.deletedAt) !== null ||
      followerId === followedId
    ) {
      continue
    }

    const actor = await loadActorFromProfileStore(
      followerId,
      profileStore,
      actorCache,
    )

    await notificationStore.upsertNotification(
      buildNotificationDocument(
        'follow',
        actor,
        followedId,
        followId,
        createdAt,
        createdAt,
      ),
    )
    upsertCount += 1
  }

  if (upsertCount > 0) {
    logger.info('Upserted %d follow notifications.', upsertCount)
  }
}

export async function syncPostNotificationsBatch(
  documents: readonly NotificationPostSourceDocument[],
  postStore: PostStore,
  profileStore: NotificationProfileStore,
  notificationStore: NotificationStore,
  logger: LoggerLike = nullLogger,
): Promise<void> {
  const latestDocuments = collapseDocumentsToLatest(documents)
  const mentionCache = new Map<string, string | null>()
  let upsertCount = 0

  for (const document of latestDocuments) {
    const postId = toNonEmptyString(document.id)
    const threadId = toNonEmptyString(document.threadId) ?? postId
    const parentId = toNonEmptyString(document.parentId)
    const createdAt = toNonEmptyString(document.createdAt)
    const actor = buildActorFromPost(document)

    if (
      postId === null ||
      threadId === null ||
      createdAt === null ||
      actor === null ||
      toNonEmptyString(document.kind) !== 'user' ||
      !isPubliclyVisiblePost(document)
    ) {
      if (postId === null || actor === null) {
        logger.warn('Skipping notification sync for an invalid post document.')
      }
      continue
    }

    let replyTargetUserId: string | null = null
    if (toNonEmptyString(document.type) === 'reply' && parentId !== null) {
      const parentPost = await postStore.getPostById(parentId, threadId)
      const parentAuthorId = toNonEmptyString(parentPost?.authorId)

      if (parentPost === null) {
        logger.warn(
          "Skipping reply notification sync for reply '%s' because parent '%s' was not found in thread '%s'.",
          postId,
          parentId,
          threadId,
        )
      } else if (
        isPubliclyVisiblePost(parentPost) &&
        toNonEmptyString(parentPost.kind) === 'user' &&
        parentAuthorId !== null &&
        parentAuthorId !== actor.userId
      ) {
        replyTargetUserId = parentAuthorId
        await notificationStore.upsertNotification(
          buildNotificationDocument(
            'reply',
            actor,
            parentAuthorId,
            postId,
            createdAt,
            createdAt,
            {
              postId,
              threadId,
              parentId,
              excerpt: buildExcerpt(document.text),
            },
          ),
        )
        upsertCount += 1
      }
    }

    const mentionTargets = await resolveMentionTargets(
      toStringArray(document.mentions),
      profileStore,
      mentionCache,
    )

    for (const targetUserId of mentionTargets) {
      if (
        targetUserId === actor.userId ||
        (replyTargetUserId !== null && targetUserId === replyTargetUserId)
      ) {
        continue
      }

      await notificationStore.upsertNotification(
        buildNotificationDocument(
          'mention',
          actor,
          targetUserId,
          postId,
          createdAt,
          createdAt,
          {
            postId,
            threadId,
            parentId,
            excerpt: buildExcerpt(document.text),
          },
        ),
      )
      upsertCount += 1
    }
  }

  if (upsertCount > 0) {
    logger.info('Upserted %d post-derived notifications.', upsertCount)
  }
}

export async function syncReactionNotificationsBatch(
  documents: readonly NotificationReactionSourceDocument[],
  postStore: PostStore,
  profileStore: NotificationProfileStore,
  notificationStore: NotificationStore,
  logger: LoggerLike = nullLogger,
  options: {
    hourlyActorThrottleThreshold?: number
  } = {},
): Promise<void> {
  const latestDocuments = collapseDocumentsToLatest(documents)
  const actorCache = new Map<string, NotificationActor>()
  const windowNotificationCache = new Map<string, NotificationDocument[]>()
  const rawHourlyActorThrottleThreshold = options.hourlyActorThrottleThreshold
  const normalizedHourlyActorThrottleThreshold =
    typeof rawHourlyActorThrottleThreshold === 'number' &&
    Number.isFinite(rawHourlyActorThrottleThreshold)
      ? rawHourlyActorThrottleThreshold
    : DEFAULT_REACTION_NOTIFICATION_HOURLY_THRESHOLD
  const hourlyActorThrottleThreshold = Math.max(
    1,
    Math.trunc(normalizedHourlyActorThrottleThreshold),
  )
  let upsertCount = 0

  for (const document of latestDocuments) {
    const reactionId = toNonEmptyString(document.id)
    const postId = toNonEmptyString(document.postId)
    const actorUserId = toNonEmptyString(document.userId)
    const createdAt =
      toNonEmptyString(document.createdAt) ??
      toNonEmptyString(document.updatedAt)
    const updatedAt =
      toNonEmptyString(document.updatedAt) ??
      toNonEmptyString(document.createdAt)

    if (
      reactionId === null ||
      document.type !== 'reaction' ||
      postId === null ||
      actorUserId === null ||
      createdAt === null ||
      updatedAt === null
    ) {
      logger.warn(
        'Skipping notification sync for an invalid reaction document.',
      )
      continue
    }

    if (isReactionDocumentEmpty(document)) {
      continue
    }

    const post = await postStore.getPostById(postId)
    const targetUserId = toNonEmptyString(post?.authorId)

    if (post === null) {
      logger.warn(
        "Skipping reaction notification sync for reaction '%s' because post '%s' was not found.",
        reactionId,
        postId,
      )
      continue
    }

    if (
      !isPubliclyVisiblePost(post) ||
      toNonEmptyString(post.kind) !== 'user' ||
      targetUserId === null ||
      targetUserId === actorUserId
    ) {
      continue
    }

    const actor = await loadActorFromProfileStore(
      actorUserId,
      profileStore,
      actorCache,
    )

    const reactionHourWindow = buildUtcHourWindow(createdAt)

    if (reactionHourWindow === null) {
      await notificationStore.upsertNotification(
        buildNotificationDocument(
          'reaction',
          actor,
          targetUserId,
          reactionId,
          createdAt,
          updatedAt,
          {
            postId,
            threadId: toNonEmptyString(post.threadId) ?? postId,
            parentId: toNonEmptyString(post.parentId),
            reactionType: buildReactionType(document),
            reactionValues: buildReactionValues(document),
            excerpt: buildExcerpt(post.text),
          },
        ),
      )
      upsertCount += 1
      continue
    }

    const cacheKey = [
      targetUserId,
      'reaction',
      actorUserId,
      reactionHourWindow.start,
    ].join(':')
    let windowNotifications = windowNotificationCache.get(cacheKey)

    if (windowNotifications === undefined) {
      windowNotifications = await notificationStore.listNotificationsByActorAndWindow(
        targetUserId,
        'reaction',
        actorUserId,
        reactionHourWindow.start,
        reactionHourWindow.endExclusive,
      )
      windowNotificationCache.set(cacheKey, windowNotifications)
    }

    const representedReactionIds = new Set(
      windowNotifications.flatMap((notification) =>
        extractCoalescedEntityIds(notification),
      ),
    )
    const reactionAlreadyRepresented = representedReactionIds.has(reactionId)
    const aggregateNotificationId = buildReactionThrottleNotificationId(
      targetUserId,
      actorUserId,
      reactionHourWindow.start,
    )
    const shouldCoalesce =
      windowNotifications.some(
        (notification) => notification.id === aggregateNotificationId,
      ) ||
      (!reactionAlreadyRepresented &&
        representedReactionIds.size + 1 > hourlyActorThrottleThreshold)

    if (shouldCoalesce) {
      if (!reactionAlreadyRepresented) {
        representedReactionIds.add(reactionId)
      }

      for (const notification of windowNotifications) {
        if (notification.id === aggregateNotificationId) {
          continue
        }

        await notificationStore.deleteNotification(targetUserId, notification.id)
      }

      const aggregateNotification = buildNotificationDocument(
        'reaction',
        actor,
        targetUserId,
        reactionId,
        getEarliestCreatedAt(windowNotifications, createdAt),
        updatedAt,
        {
          notificationId: aggregateNotificationId,
          postId,
          threadId: toNonEmptyString(post.threadId) ?? postId,
          parentId: toNonEmptyString(post.parentId),
          reactionType: buildReactionType(document),
          reactionValues: buildReactionValues(document),
          excerpt: buildExcerpt(post.text),
          eventCount: representedReactionIds.size,
          coalesced: true,
          coalescedWindowStart: reactionHourWindow.start,
          coalescedRelatedEntityIds: [...representedReactionIds].sort(),
        },
      )

      await notificationStore.upsertNotification(aggregateNotification)
      windowNotificationCache.set(cacheKey, [aggregateNotification])
      upsertCount += 1
      continue
    }

    const individualNotification = buildNotificationDocument(
      'reaction',
      actor,
      targetUserId,
      reactionId,
      createdAt,
      updatedAt,
      {
        postId,
        threadId: toNonEmptyString(post.threadId) ?? postId,
        parentId: toNonEmptyString(post.parentId),
        reactionType: buildReactionType(document),
        reactionValues: buildReactionValues(document),
        excerpt: buildExcerpt(post.text),
      },
    )

    await notificationStore.upsertNotification(individualNotification)
    windowNotificationCache.set(
      cacheKey,
      reactionAlreadyRepresented
        ? windowNotifications.map((notification) =>
            notification.relatedEntityId === reactionId
              ? individualNotification
              : notification,
          )
        : [...windowNotifications, individualNotification],
    )
    upsertCount += 1
  }

  if (upsertCount > 0) {
    logger.info('Upserted %d reaction notifications.', upsertCount)
  }
}
