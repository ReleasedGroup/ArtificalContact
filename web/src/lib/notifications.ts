import type { InfiniteData, QueryClient } from '@tanstack/react-query'

interface ApiError {
  code: string
  message: string
  field?: string
}

interface NotificationEnvelope {
  data: NotificationApiRecord[] | NotificationPagePayload | null
  cursor?: string | null
  unreadCount?: number | null
  errors: ApiError[]
}

interface NotificationPagePayload {
  notifications?: NotificationApiRecord[] | null
  unreadCount?: number | null
}

interface NotificationActorRecord {
  id?: string | null
  handle?: string | null
  displayName?: string | null
  avatarUrl?: string | null
}

interface NotificationApiRecord {
  id: string
  eventType?: string | null
  type?: string | null
  text?: string | null
  message?: string | null
  excerpt?: string | null
  read?: boolean | null
  isRead?: boolean | null
  createdAt?: string | null
  targetUrl?: string | null
  postId?: string | null
  threadId?: string | null
  actor?: NotificationActorRecord | null
  actorId?: string | null
  actorUserId?: string | null
  actorHandle?: string | null
  actorDisplayName?: string | null
  actorAvatarUrl?: string | null
  eventCount?: number | null
  coalesced?: boolean | null
}

interface MarkNotificationsReadEnvelope {
  data:
    | {
        read?: {
          scope?: 'all' | 'single'
          notificationId?: string | null
          updatedCount?: number | null
        } | null
      }
    | null
  errors: ApiError[]
}

interface MarkNotificationsReadResult {
  scope: 'all' | 'single'
  notificationId: string | null
  updatedCount: number
}

export interface NotificationActor {
  id: string | null
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface NotificationItem {
  id: string
  eventType: string
  text: string | null
  read: boolean
  createdAt: string | null
  targetUrl: string | null
  postId: string | null
  threadId: string | null
  excerpt: string | null
  eventCount: number
  coalesced: boolean
  actor: NotificationActor | null
}

export interface NotificationsPage {
  notifications: NotificationItem[]
  cursor: string | null
  unreadCount: number
}

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const
export const NOTIFICATION_FEED_QUERY_KEY = [
  ...NOTIFICATIONS_QUERY_KEY,
  'feed',
] as const
export const NOTIFICATION_BELL_QUERY_KEY = [
  ...NOTIFICATIONS_QUERY_KEY,
  'bell',
] as const

export interface NotificationsCacheSnapshot {
  bellData: NotificationsPage | undefined
  bellPresent: boolean
  feedData: InfiniteData<NotificationsPage, string | null> | undefined
  feedPresent: boolean
}

function readErrorMessage(
  payload: NotificationEnvelope | MarkNotificationsReadEnvelope | null,
): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

function normalizeActor(record: NotificationApiRecord): NotificationActor | null {
  const actor =
    record.actor ??
    (record.actorId ||
    record.actorUserId ||
    record.actorHandle ||
    record.actorDisplayName ||
    record.actorAvatarUrl
      ? {
          id: record.actorId ?? record.actorUserId,
          handle: record.actorHandle,
          displayName: record.actorDisplayName,
          avatarUrl: record.actorAvatarUrl,
        }
      : null)

  if (!actor) {
    return null
  }

  return {
    id: actor.id ?? null,
    handle: actor.handle ?? null,
    displayName: actor.displayName ?? null,
    avatarUrl: actor.avatarUrl ?? null,
  }
}

function normalizeNotification(record: NotificationApiRecord): NotificationItem {
  const eventCount =
    typeof record.eventCount === 'number' &&
    Number.isFinite(record.eventCount) &&
    record.eventCount > 0
      ? Math.trunc(record.eventCount)
      : 1

  return {
    id: record.id,
    eventType: (record.eventType ?? record.type ?? 'unknown').trim(),
    text: record.text ?? record.message ?? null,
    read: Boolean(record.read ?? record.isRead ?? false),
    createdAt: record.createdAt ?? null,
    targetUrl: record.targetUrl ?? null,
    postId: record.postId ?? null,
    threadId: record.threadId ?? null,
    excerpt: record.excerpt ?? null,
    eventCount,
    coalesced: record.coalesced === true,
    actor: normalizeActor(record),
  }
}

function resolveNotificationRecords(
  payload: NotificationEnvelope | null,
): NotificationApiRecord[] | null {
  if (Array.isArray(payload?.data)) {
    return payload.data
  }

  if (payload?.data && Array.isArray(payload.data.notifications)) {
    return payload.data.notifications
  }

  return null
}

function resolveUnreadCount(
  payload: NotificationEnvelope | null,
  records: readonly NotificationApiRecord[],
): number {
  if (
    payload?.data &&
    !Array.isArray(payload.data) &&
    typeof payload.data.unreadCount === 'number' &&
    payload.data.unreadCount >= 0
  ) {
    return payload.data.unreadCount
  }

  if (typeof payload?.unreadCount === 'number' && payload.unreadCount >= 0) {
    return payload.unreadCount
  }

  return records.reduce(
    (count, notification) =>
      count + (notification.read === true || notification.isRead === true ? 0 : 1),
    0,
  )
}

function requestNotificationReadBody(
  scope: 'all' | 'single',
  notificationId?: string,
) {
  return scope === 'all' ? { all: true } : { notificationId }
}

function applyNotificationReadState(
  notifications: readonly NotificationItem[],
  predicate: (notification: NotificationItem) => boolean,
): { notifications: NotificationItem[]; updatedCount: number } {
  let updatedCount = 0

  const nextNotifications = notifications.map((notification) => {
    if (notification.read || !predicate(notification)) {
      return notification
    }

    updatedCount += 1
    return {
      ...notification,
      read: true,
    }
  })

  return {
    notifications: nextNotifications,
    updatedCount,
  }
}

function applyNotificationsPageReadState(
  page: NotificationsPage,
  predicate: (notification: NotificationItem) => boolean,
): NotificationsPage {
  const { notifications, updatedCount } = applyNotificationReadState(
    page.notifications,
    predicate,
  )

  if (updatedCount === 0) {
    return page
  }

  return {
    ...page,
    notifications,
    unreadCount: Math.max(0, page.unreadCount - updatedCount),
  }
}

function applyInfiniteNotificationsReadState(
  data: InfiniteData<NotificationsPage, string | null>,
  predicate: (notification: NotificationItem) => boolean,
): InfiniteData<NotificationsPage, string | null> {
  let changed = false

  const pages = data.pages.map((page) => {
    const nextPage = applyNotificationsPageReadState(page, predicate)

    if (nextPage !== page) {
      changed = true
    }

    return nextPage
  })

  if (!changed) {
    return data
  }

  const firstPage = pages[0]

  if (!firstPage) {
    return data
  }

  const unreadCount = firstPage.unreadCount

  return {
    ...data,
    pages: pages.map((page, index) =>
      index === 0 ? page : { ...page, unreadCount },
    ),
  }
}

export function markNotificationReadInCache(
  queryClient: QueryClient,
  notificationId: string,
): NotificationsCacheSnapshot {
  const snapshot: NotificationsCacheSnapshot = {
    bellData: queryClient.getQueryData<NotificationsPage>(
      NOTIFICATION_BELL_QUERY_KEY,
    ),
    bellPresent:
      queryClient.getQueryState(NOTIFICATION_BELL_QUERY_KEY) !== undefined,
    feedData: queryClient.getQueryData<
      InfiniteData<NotificationsPage, string | null>
    >(NOTIFICATION_FEED_QUERY_KEY),
    feedPresent:
      queryClient.getQueryState(NOTIFICATION_FEED_QUERY_KEY) !== undefined,
  }

  queryClient.setQueryData<NotificationsPage | undefined>(
    NOTIFICATION_BELL_QUERY_KEY,
    (current) =>
      current
        ? applyNotificationsPageReadState(
            current,
            (notification) => notification.id === notificationId,
          )
        : current,
  )

  queryClient.setQueryData<InfiniteData<NotificationsPage, string | null> | undefined>(
    NOTIFICATION_FEED_QUERY_KEY,
    (current) =>
      current
        ? applyInfiniteNotificationsReadState(
            current,
            (notification) => notification.id === notificationId,
          )
        : current,
  )

  return snapshot
}

export function markAllNotificationsReadInCache(
  queryClient: QueryClient,
): NotificationsCacheSnapshot {
  const snapshot: NotificationsCacheSnapshot = {
    bellData: queryClient.getQueryData<NotificationsPage>(
      NOTIFICATION_BELL_QUERY_KEY,
    ),
    bellPresent:
      queryClient.getQueryState(NOTIFICATION_BELL_QUERY_KEY) !== undefined,
    feedData: queryClient.getQueryData<
      InfiniteData<NotificationsPage, string | null>
    >(NOTIFICATION_FEED_QUERY_KEY),
    feedPresent:
      queryClient.getQueryState(NOTIFICATION_FEED_QUERY_KEY) !== undefined,
  }

  queryClient.setQueryData<NotificationsPage | undefined>(
    NOTIFICATION_BELL_QUERY_KEY,
    (current) =>
      current ? applyNotificationsPageReadState(current, () => true) : current,
  )

  queryClient.setQueryData<InfiniteData<NotificationsPage, string | null> | undefined>(
    NOTIFICATION_FEED_QUERY_KEY,
    (current) =>
      current ? applyInfiniteNotificationsReadState(current, () => true) : current,
  )

  return snapshot
}

export function restoreNotificationsCache(
  queryClient: QueryClient,
  snapshot: NotificationsCacheSnapshot,
): void {
  if (snapshot.bellPresent) {
    queryClient.setQueryData(NOTIFICATION_BELL_QUERY_KEY, snapshot.bellData)
  } else {
    queryClient.removeQueries({
      queryKey: NOTIFICATION_BELL_QUERY_KEY,
      exact: true,
    })
  }

  if (snapshot.feedPresent) {
    queryClient.setQueryData(NOTIFICATION_FEED_QUERY_KEY, snapshot.feedData)
  } else {
    queryClient.removeQueries({
      queryKey: NOTIFICATION_FEED_QUERY_KEY,
      exact: true,
    })
  }
}

export async function getNotificationsPage(
  options: {
    cursor?: string | null
    signal?: AbortSignal
  } = {},
): Promise<NotificationsPage> {
  const requestUrl = new URL('/api/notifications', window.location.origin)

  if (options.cursor) {
    requestUrl.searchParams.set('cursor', options.cursor)
  }

  const response = await fetch(requestUrl.pathname + requestUrl.search, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload: NotificationEnvelope | null = null

  try {
    payload = (await response.json()) as NotificationEnvelope
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Notification lookup failed with status ${response.status}.`,
    )
  }

  const records = resolveNotificationRecords(payload)

  if (!Array.isArray(records)) {
    throw new Error('Notification response did not contain a notification payload.')
  }

  return {
    notifications: records.map(normalizeNotification),
    cursor: typeof payload?.cursor === 'string' ? payload.cursor : null,
    unreadCount: resolveUnreadCount(payload, records),
  }
}

async function markNotificationsRead(
  scope: 'all' | 'single',
  options: {
    notificationId?: string
    signal?: AbortSignal
  } = {},
): Promise<MarkNotificationsReadResult> {
  const response = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      requestNotificationReadBody(scope, options.notificationId),
    ),
    signal: options.signal,
  })

  let payload: MarkNotificationsReadEnvelope | null = null

  try {
    payload = (await response.json()) as MarkNotificationsReadEnvelope
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Notification read update failed with status ${response.status}.`,
    )
  }

  return {
    scope,
    notificationId: payload?.data?.read?.notificationId ?? null,
    updatedCount:
      typeof payload?.data?.read?.updatedCount === 'number' &&
      payload.data.read.updatedCount >= 0
        ? payload.data.read.updatedCount
        : 0,
  }
}

export function markNotificationRead(
  notificationId: string,
  signal?: AbortSignal,
): Promise<MarkNotificationsReadResult> {
  return markNotificationsRead('single', {
    notificationId,
    signal,
  })
}

export function markAllNotificationsRead(
  signal?: AbortSignal,
): Promise<MarkNotificationsReadResult> {
  return markNotificationsRead('all', {
    signal,
  })
}
