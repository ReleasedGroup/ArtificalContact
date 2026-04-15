import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { startTransition, useDeferredValue, useState } from 'react'
import type { MeProfile } from '../lib/me'
import {
  getNotificationsPage,
  type NotificationItem,
} from '../lib/notifications'
import { signOut } from '../lib/auth'
import { AppImage } from './AppImage'
import { BrowserPushCard } from './BrowserPushCard'

interface NotificationsScreenProps {
  viewer: MeProfile
}

type NotificationTab = 'all' | 'mentions' | 'replies' | 'reactions' | 'follows'

const notificationTabs: Array<{
  label: string
  value: NotificationTab
}> = [
  { label: 'All', value: 'all' },
  { label: 'Mentions', value: 'mentions' },
  { label: 'Replies', value: 'replies' },
  { label: 'Reactions', value: 'reactions' },
  { label: 'Follows', value: 'follows' },
]

function buildMonogram(
  source: string | null | undefined,
  fallback: string,
): string {
  const resolvedSource = source?.trim() || fallback
  const words = resolvedSource.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return resolvedSource.slice(0, 2).toUpperCase()
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function getProfileHref(handle: string | null): string | null {
  return handle ? `/u/${encodeURIComponent(handle)}` : null
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

  if (notification.actor?.handle) {
    return getProfileHref(notification.actor.handle)
  }

  return null
}

function getNotificationTab(
  eventType: string,
): Exclude<NotificationTab, 'all'> | null {
  switch (eventType.trim().toLowerCase()) {
    case 'mention':
    case 'mentions':
      return 'mentions'
    case 'reply':
    case 'replies':
    case 'answer':
      return 'replies'
    case 'reaction':
    case 'reactions':
    case 'like':
    case 'likes':
    case 'emoji':
    case 'gif':
      return 'reactions'
    case 'follow':
    case 'follows':
    case 'follower':
      return 'follows'
    default:
      return null
  }
}

function getNotificationMessage(notification: NotificationItem): string {
  if (notification.text?.trim()) {
    return notification.text
  }

  switch (getNotificationTab(notification.eventType)) {
    case 'mentions':
      return 'mentioned you in a thread.'
    case 'replies':
      return 'replied to your post.'
    case 'reactions':
      return 'reacted to your post.'
    case 'follows':
      return 'started following you.'
    default:
      return 'generated a notification.'
  }
}

function getEmptyStateCopy(activeTab: NotificationTab): {
  heading: string
  body: string
} {
  switch (activeTab) {
    case 'mentions':
      return {
        heading: 'No mention notifications yet',
        body: 'Mentions from threads and posts will appear here once they land in the in-app feed.',
      }
    case 'replies':
      return {
        heading: 'No reply notifications yet',
        body: 'Replies to your posts and threads will appear here after the change-feed worker emits them.',
      }
    case 'reactions':
      return {
        heading: 'No reaction notifications yet',
        body: 'Likes and other reactions will appear here once people engage with your posts.',
      }
    case 'follows':
      return {
        heading: 'No follow notifications yet',
        body: 'New follower activity will appear here when someone starts following you.',
      }
    default:
      return {
        heading: 'No notifications yet',
        body: 'Your in-app feed is empty right now. Once people reply, react, follow, or mention you, those events will appear here.',
      }
  }
}

function NotificationIcon({ eventType }: { eventType: string }) {
  switch (getNotificationTab(eventType)) {
    case 'mentions':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-amber-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'replies':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-sky-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9 8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'reactions':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-rose-300"
          fill="currentColor"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z" />
        </svg>
      )
    case 'follows':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-emerald-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-slate-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      )
  }
}

function NotificationRow({ notification }: { notification: NotificationItem }) {
  const actorName =
    notification.actor?.displayName?.trim() ||
    notification.actor?.handle?.trim() ||
    'Someone'
  const actorHandle = notification.actor?.handle?.trim() || null
  const actorProfileHref = getProfileHref(actorHandle)
  const targetHref = getNotificationHref(notification)
  const timestamp = formatTimestamp(notification.createdAt)

  return (
    <li
      className={`flex items-start gap-3 px-4 py-4 transition ${
        notification.read ? 'bg-transparent' : 'bg-cyan-400/5'
      }`}
    >
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
        <NotificationIcon eventType={notification.eventType} />
      </div>

      {notification.actor?.avatarUrl ? (
        <AppImage
          src={notification.actor.avatarUrl}
          alt={`${actorName} avatar`}
          className="h-10 w-10 rounded-2xl object-cover ring-1 ring-white/10"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-sky-500 text-xs font-semibold tracking-[0.08em] text-white shadow-lg shadow-sky-950/25">
          {buildMonogram(notification.actor?.displayName || actorHandle, 'AC')}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="text-sm leading-7 text-slate-200">
          {actorProfileHref ? (
            <a
              href={actorProfileHref}
              className="font-semibold text-white transition hover:text-cyan-100"
            >
              {actorName}
            </a>
          ) : (
            <span className="font-semibold text-white">{actorName}</span>
          )}{' '}
          {targetHref ? (
            <a href={targetHref} className="transition hover:text-white">
              {getNotificationMessage(notification)}
            </a>
          ) : (
            getNotificationMessage(notification)
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {actorHandle && <span>@{actorHandle}</span>}
          {actorHandle && timestamp && <span>·</span>}
          {timestamp && <time>{timestamp}</time>}
        </div>
      </div>

      {!notification.read && (
        <span
          aria-label="Unread notification"
          className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300"
        />
      )}
    </li>
  )
}

export function NotificationsScreen({ viewer }: NotificationsScreenProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<NotificationTab>('all')

  const notificationsQuery = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam, signal }) =>
      getNotificationsPage({ cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const loadedNotifications = useDeferredValue(
    (notificationsQuery.data?.pages ?? []).flatMap(
      (page) => page.notifications,
    ),
  )
  const visibleNotifications = loadedNotifications.filter((notification) => {
    if (activeTab === 'all') {
      return true
    }

    return getNotificationTab(notification.eventType) === activeTab
  })
  const unreadCount =
    notificationsQuery.data?.pages[0]?.unreadCount ??
    loadedNotifications.filter((notification) => !notification.read).length
  const emptyStateCopy = getEmptyStateCopy(activeTab)

  function handleSignOut() {
    signOut({ queryClient })
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.14),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                  In-app notifications
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  {unreadCount} unread
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Viewer @{viewer.handle}
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Notifications
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  In-app delivery via the Cosmos DB change-feed worker. Filter
                  by the event you care about without leaving the notification
                  feed.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/"
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Home feed
              </a>
              <a
                href="/moderation"
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Moderation queue
              </a>
              <a
                href="/me"
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Edit profile
              </a>
              <button
                type="button"
                onClick={() => {
                  void notificationsQuery.refetch()
                }}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                disabled={
                  notificationsQuery.isPending ||
                  notificationsQuery.isRefetching
                }
              >
                Refresh notifications
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 px-4 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-6">
          <BrowserPushCard />

          <div
            aria-label="Notification filters"
            className="mt-5 flex flex-wrap items-center gap-2 border-b border-white/10 pb-4 text-sm"
          >
            {notificationTabs.map((tab) => {
              const selected = tab.value === activeTab

              return (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded-full border px-4 py-2 font-medium transition ${
                    selected
                      ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
                      : 'border-white/10 text-slate-300 hover:border-white/18 hover:bg-white/6 hover:text-white'
                  }`}
                  onClick={() => {
                    startTransition(() => {
                      setActiveTab(tab.value)
                    })
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {notificationsQuery.isPending && (
            <div className="space-y-4 py-5">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={`notification-skeleton-${index}`}
                  className="animate-pulse rounded-[1.75rem] border border-white/8 bg-slate-900/65 p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-2xl bg-white/8" />
                    <div className="h-10 w-10 rounded-2xl bg-white/8" />
                    <div className="flex-1 space-y-3">
                      <div className="h-4 w-48 rounded-full bg-white/8" />
                      <div className="h-4 w-full rounded-full bg-white/8" />
                      <div className="h-4 w-2/5 rounded-full bg-white/8" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notificationsQuery.isError && (
            <article className="mt-5 rounded-[1.75rem] border border-rose-400/20 bg-rose-400/10 p-6 text-rose-50">
              <h2 className="text-xl font-semibold">
                Notification feed unavailable
              </h2>
              <p className="mt-3 text-sm leading-7 text-rose-100/90">
                {notificationsQuery.error instanceof Error
                  ? notificationsQuery.error.message
                  : 'Unable to load the in-app notification feed.'}
              </p>
              <p className="mt-3 text-sm leading-7 text-rose-100/90">
                The UI is wired to the documented `/api/notifications` contract
                and will populate here once the API is available.
              </p>
              <button
                type="button"
                onClick={() => {
                  void notificationsQuery.refetch()
                }}
                className="mt-5 rounded-full border border-rose-200/25 px-4 py-2 text-sm font-medium text-white transition hover:border-rose-100/40 hover:bg-white/6"
              >
                Retry notifications
              </button>
            </article>
          )}

          {!notificationsQuery.isPending &&
            !notificationsQuery.isError &&
            visibleNotifications.length === 0 && (
              <article className="mt-5 rounded-[1.75rem] border border-dashed border-white/12 bg-slate-900/55 p-8 text-center">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                  Notification feed standing by
                </p>
                <h2 className="mt-4 text-2xl font-semibold text-white">
                  {emptyStateCopy.heading}
                </h2>
                <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  {emptyStateCopy.body}
                </p>
              </article>
            )}

          {!notificationsQuery.isPending &&
            !notificationsQuery.isError &&
            visibleNotifications.length > 0 && (
              <ul className="mt-4 divide-y divide-white/8">
                {visibleNotifications.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                  />
                ))}
              </ul>
            )}

          {notificationsQuery.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  void notificationsQuery.fetchNextPage()
                }}
                disabled={notificationsQuery.isFetchingNextPage}
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-400"
              >
                {notificationsQuery.isFetchingNextPage
                  ? 'Loading more notifications…'
                  : 'Load more notifications'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
