interface ApiError {
  code: string
  message: string
  field?: string
}

interface NotificationEnvelope {
  data: NotificationApiRecord[] | null
  cursor?: string | null
  unreadCount?: number | null
  errors: ApiError[]
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
  read?: boolean | null
  isRead?: boolean | null
  createdAt?: string | null
  targetUrl?: string | null
  postId?: string | null
  threadId?: string | null
  actor?: NotificationActorRecord | null
  actorId?: string | null
  actorHandle?: string | null
  actorDisplayName?: string | null
  actorAvatarUrl?: string | null
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
  actor: NotificationActor | null
}

export interface NotificationsPage {
  notifications: NotificationItem[]
  cursor: string | null
  unreadCount: number
}

function readErrorMessage(payload: NotificationEnvelope | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

function normalizeActor(record: NotificationApiRecord): NotificationActor | null {
  const actor =
    record.actor ??
    (record.actorId ||
    record.actorHandle ||
    record.actorDisplayName ||
    record.actorAvatarUrl
      ? {
          id: record.actorId,
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
  return {
    id: record.id,
    eventType: (record.eventType ?? record.type ?? 'unknown').trim(),
    text: record.text ?? record.message ?? null,
    read: Boolean(record.read ?? record.isRead ?? false),
    createdAt: record.createdAt ?? null,
    targetUrl: record.targetUrl ?? null,
    postId: record.postId ?? null,
    threadId: record.threadId ?? null,
    actor: normalizeActor(record),
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

  if (!Array.isArray(payload?.data)) {
    throw new Error('Notification response did not contain a notification payload.')
  }

  return {
    notifications: payload.data.map(normalizeNotification),
    cursor: typeof payload.cursor === 'string' ? payload.cursor : null,
    unreadCount:
      typeof payload.unreadCount === 'number' && payload.unreadCount >= 0
        ? payload.unreadCount
        : payload.data.reduce(
            (count, notification) =>
              count +
              (notification.read === true || notification.isRead === true ? 0 : 1),
            0,
          ),
  }
}
