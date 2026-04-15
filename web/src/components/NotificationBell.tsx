import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  getNotificationsPage,
  type NotificationItem,
} from '../lib/notifications'
import { AppImage } from './AppImage'

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
})

function buildMonogram(
  displayName: string | null | undefined,
  handle: string | null | undefined,
): string {
  const source = displayName?.trim() || handle?.trim() || 'AC'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function getActorLabel(notification: NotificationItem): string {
  return (
    notification.actor?.displayName?.trim() ||
    (notification.actor?.handle?.trim()
      ? `@${notification.actor.handle.trim()}`
      : 'Someone')
  )
}

function getProfileHref(handle: string | null | undefined): string | null {
  const trimmedHandle = handle?.trim()
  return trimmedHandle ? `/u/${encodeURIComponent(trimmedHandle)}` : null
}

function sanitizeNotificationTargetUrl(
  targetUrl: string | null | undefined,
): string | null {
  const trimmedTargetUrl = targetUrl?.trim()

  if (!trimmedTargetUrl) {
    return null
  }

  if (!trimmedTargetUrl.startsWith('/') || trimmedTargetUrl.startsWith('//')) {
    return null
  }

  return trimmedTargetUrl
}

function getNotificationHref(notification: NotificationItem): string | null {
  const safeTargetUrl = sanitizeNotificationTargetUrl(notification.targetUrl)
  if (safeTargetUrl) {
    return safeTargetUrl
  }

  if (notification.postId) {
    return `/p/${encodeURIComponent(notification.postId)}`
  }

  if (notification.threadId) {
    return `/p/${encodeURIComponent(notification.threadId)}`
  }

  return getProfileHref(notification.actor?.handle)
}

function getNotificationMessage(notification: NotificationItem): string {
  if (notification.text?.trim()) {
    return notification.text
  }

  switch (notification.eventType.trim().toLowerCase()) {
    case 'mention':
    case 'mentions':
      return 'mentioned you in a thread.'
    case 'reply':
    case 'replies':
      return 'replied to your post.'
    case 'reaction':
    case 'reactions':
    case 'like':
    case 'likes':
    case 'emoji':
    case 'gif':
      return 'reacted to your post.'
    case 'follow':
    case 'follows':
    case 'follower':
      return 'started following you.'
    default:
      return 'generated a notification.'
  }
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'Just now'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.valueOf())) {
    return 'Just now'
  }

  const diffMs = timestamp.valueOf() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)

  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  return relativeTimeFormatter.format(diffDays, 'day')
}

function NotificationRow({ notification }: { notification: NotificationItem }) {
  const actorLabel = getActorLabel(notification)
  const targetHref = getNotificationHref(notification)
  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-fuchsia-500 to-sky-500 text-xs font-semibold tracking-[0.08em] text-white shadow-lg shadow-slate-950/30">
          {notification.actor?.avatarUrl ? (
            <AppImage
              src={notification.actor.avatarUrl}
              alt={`${actorLabel} avatar`}
              className="h-full w-full object-cover"
            />
          ) : (
            buildMonogram(
              notification.actor?.displayName,
              notification.actor?.handle,
            )
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-slate-200">
            <span className="font-semibold text-white">{actorLabel}</span>{' '}
            {getNotificationMessage(notification)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <span>{formatRelativeTime(notification.createdAt)}</span>
            <span className="rounded-full border border-white/10 px-2 py-1">
              {notification.eventType}
            </span>
          </div>
        </div>

        {!notification.read && (
          <span
            aria-hidden="true"
            className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]"
          />
        )}
      </div>
    </>
  )

  if (!targetHref) {
    return (
      <li className="rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-3">
        {content}
      </li>
    )
  }

  return (
    <li>
      <a
        href={targetHref}
        className="block rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-3 transition hover:border-white/14 hover:bg-white/7"
      >
        {content}
      </a>
    </li>
  )
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: ({ signal }) => getNotificationsPage({ signal }),
    retry: false,
    staleTime: 15_000,
    refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const notifications = notificationsQuery.data?.notifications.slice(0, 5) ?? []
  const buttonLabel =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
  const dialogId = 'notification-bell-dialog'
  const titleId = 'notification-bell-title'

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus()
    }
  }, [isOpen])

  return (
    <div className="relative">
      <button
        type="button"
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={buttonLabel}
        data-testid="notification-bell-button"
        onClick={() => {
          setIsOpen((currentValue) => !currentValue)
        }}
        className="relative inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/7 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 text-cyan-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M15 18H5.9a1 1 0 0 1-.8-1.6l1.2-1.6A5 5 0 0 0 7.5 11.8V10a4.5 4.5 0 1 1 9 0v1.8a5 5 0 0 0 1.2 3L19 16.4a1 1 0 0 1-.8 1.6H15m0 0a3 3 0 1 1-6 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="hidden sm:inline">Notifications</span>
        {unreadCount > 0 && (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-cyan-200/30 bg-cyan-300 px-2 py-0.5 text-xs font-semibold text-slate-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="absolute right-0 top-full z-20 mt-3 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-[1.8rem] border border-white/10 bg-slate-950/96 shadow-2xl shadow-slate-950/50 backdrop-blur"
        >
          <div className="border-b border-white/8 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p
                  id={titleId}
                  className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80"
                >
                  Notifications
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                </p>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                {notificationsQuery.isFetching ? 'Syncing' : 'Live'}
              </span>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto px-4 py-4">
            {notificationsQuery.isPending && (
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={`notification-skeleton-${index}`}
                    className="animate-pulse rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-white/8" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="h-3 w-4/5 rounded-full bg-white/8" />
                        <div className="h-3 w-2/3 rounded-full bg-white/8" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {notificationsQuery.isError && !notificationsQuery.data && (
              <article className="rounded-[1.4rem] border border-rose-400/20 bg-rose-400/10 px-4 py-4 text-sm leading-7 text-rose-100">
                {notificationsQuery.error instanceof Error
                  ? notificationsQuery.error.message
                  : 'Unable to load notifications.'}
              </article>
            )}

            {!notificationsQuery.isPending &&
              notificationsQuery.data &&
              notifications.length === 0 && (
                <article className="rounded-[1.4rem] border border-dashed border-white/10 bg-white/3 px-4 py-6 text-center">
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-100/75">
                    No alerts yet
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-400">
                    New follows, replies, mentions, and reactions will appear
                    here as soon as they land in the notifications read model.
                  </p>
                </article>
              )}

            {!notificationsQuery.isPending &&
              notificationsQuery.data &&
              notifications.length > 0 && (
                <ul className="space-y-3">
                  {notifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                    />
                  ))}
                </ul>
              )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 text-xs uppercase tracking-[0.18em] text-slate-500">
            <span>Polling every 30s while the page is active</span>
            <a
              href="/notifications"
              className="text-cyan-100 transition hover:text-white"
            >
              View all
            </a>
          </div>
        </section>
      )}
    </div>
  )
}
