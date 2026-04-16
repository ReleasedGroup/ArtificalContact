import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
} from 'react'
import { AppImage } from './AppImage'
import { NotificationBell } from './NotificationBell'
import { hasRole, type MeProfile, type ResolvedMeProfile } from '../lib/me'
import { getFeedPage, type FeedEntry } from '../lib/feed'
import { createPost } from '../lib/post-write'
import { signOut } from '../lib/auth'
import { HeaderSearchBox } from './HeaderSearchBox'
import { ReportDialog } from './ReportDialog'
import {
  createResolvedMeProfileSnapshot,
  OPTIONAL_ME_QUERY_KEY,
  updateCachedOptionalMe,
} from '../lib/optional-me-cache'

interface HomeFeedScreenProps {
  viewer: MeProfile
}

type PullRefreshState = 'idle' | 'pulling' | 'armed' | 'refreshing'

const pullRefreshThreshold = 80
const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatCount(value: number): string {
  return value >= 1000 ? compactCountFormatter.format(value) : String(value)
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

function getProfileHref(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`
}

function getPostHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`
}

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

function getAuthorName(entry: FeedEntry): string {
  return (
    entry.authorDisplayName?.trim() ||
    entry.authorHandle?.trim() ||
    'Unknown author'
  )
}

function getRefreshMessage(state: PullRefreshState): string {
  switch (state) {
    case 'pulling':
      return 'Pull to refresh'
    case 'armed':
      return 'Release to refresh'
    case 'refreshing':
      return 'Refreshing feed…'
    default:
      return 'Pull down from the top of the list to refresh.'
  }
}

function FeedCard({ entry, viewer }: { entry: FeedEntry; viewer: MeProfile }) {
  const authorName = getAuthorName(entry)
  const authorHandle = entry.authorHandle?.trim() || null
  const timestamp = formatTimestamp(entry.createdAt)
  const viewerCanReport =
    viewer.status === 'active' && Boolean(viewer.handle?.trim())
  const canReport =
    viewerCanReport && entry.authorId !== null && entry.authorId !== viewer.id

  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-5 shadow-lg shadow-slate-950/20 transition hover:border-white/15 hover:bg-slate-900/80">
      <div className="flex items-start gap-4">
        {entry.authorAvatarUrl ? (
          <AppImage
            src={entry.authorAvatarUrl}
            alt={`${authorName} avatar`}
            className="h-12 w-12 rounded-[1.2rem] object-cover ring-1 ring-white/10"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 text-sm font-semibold tracking-[0.08em] text-white shadow-lg shadow-sky-950/25">
            {buildMonogram(entry.authorDisplayName || entry.authorHandle, 'AI')}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {authorHandle ? (
              <>
                <a
                  href={getProfileHref(authorHandle)}
                  className="font-semibold text-white transition hover:text-cyan-100"
                >
                  {authorName}
                </a>
                <a
                  href={getProfileHref(authorHandle)}
                  className="text-slate-400 transition hover:text-slate-200"
                >
                  @{authorHandle}
                </a>
              </>
            ) : (
              <span className="font-semibold text-white">{authorName}</span>
            )}
            {timestamp && (
              <time className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {timestamp}
              </time>
            )}
          </div>

          <a
            href={getPostHref(entry.postId)}
            className="mt-4 block rounded-[1.4rem] border border-transparent bg-white/0 px-1 py-1 transition hover:border-white/8 hover:bg-white/4"
          >
            <p className="line-clamp-4 text-sm leading-7 text-slate-200 sm:text-[15px]">
              {entry.excerpt?.trim() ||
                'This feed item does not include an excerpt yet.'}
            </p>
          </a>

          {entry.media.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {entry.media.slice(0, 4).map((media, index) => {
                const mediaKey = `${entry.id}-${media.kind ?? 'media'}-${index}`

                if (media.thumbUrl) {
                  return (
                    <a
                      key={mediaKey}
                      href={getPostHref(entry.postId)}
                      className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-slate-950/60"
                    >
                      <AppImage
                        src={media.thumbUrl}
                        alt={
                          media.kind ? `${media.kind} preview` : 'Media preview'
                        }
                        className="h-40 w-full object-cover"
                      />
                    </a>
                  )
                }

                return (
                  <a
                    key={mediaKey}
                    href={getPostHref(entry.postId)}
                    className="flex h-40 items-center justify-center rounded-[1.4rem] border border-dashed border-white/12 bg-slate-950/55 px-4 text-center text-xs font-medium uppercase tracking-[0.18em] text-slate-400"
                  >
                    {media.kind ?? 'Media'}
                  </a>
                )
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-cyan-100">
                {formatCount(entry.counters.likes)} likes
              </span>
              <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-fuchsia-100">
                {formatCount(entry.counters.replies)} replies
              </span>
            </div>

            <a
              href={getPostHref(entry.postId)}
              className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
            >
              Open thread
            </a>
            {canReport && (
              <ReportDialog
                actionLabel="Report post"
                dialogDescription={`Flag ${authorName}'s post for moderator review.`}
                dialogTitle="Report this post"
                successMessage="Post report submitted."
                target={{
                  targetType: 'post',
                  targetId: entry.postId,
                  targetProfileHandle: authorHandle,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export function HomeFeedScreen({ viewer }: HomeFeedScreenProps) {
  const queryClient = useQueryClient()
  const viewerState = useQuery<ResolvedMeProfile | null>({
    queryKey: OPTIONAL_ME_QUERY_KEY,
    queryFn: async () => createResolvedMeProfileSnapshot(viewer),
    initialData: createResolvedMeProfileSnapshot(viewer),
    enabled: false,
  })
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const touchStartYRef = useRef<number | null>(null)
  const pullRefreshStateRef = useRef<PullRefreshState>('idle')
  const [pullRefreshState, setPullRefreshState] =
    useState<PullRefreshState>('idle')
  const [pullDistance, setPullDistance] = useState(0)

  const feedQuery = useInfiniteQuery({
    queryKey: ['home-feed'],
    queryFn: ({ pageParam, signal }) =>
      getFeedPage({ cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const feedEntries = useDeferredValue(
    (feedQuery.data?.pages ?? []).flatMap((page) => page.entries),
  )
  const {
    error,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
    isRefetching,
    refetch,
  } = feedQuery
  const intersectionObserverAvailable =
    typeof window.IntersectionObserver !== 'undefined'
  const canObserveMore =
    !isPending && !isError && feedEntries.length > 0 && Boolean(hasNextPage)

  const handleRefresh = async () => {
    pullRefreshStateRef.current = 'refreshing'

    startTransition(() => {
      setPullRefreshState('refreshing')
      setPullDistance(0)
    })

    try {
      await refetch()
    } finally {
      pullRefreshStateRef.current = 'idle'
      startTransition(() => {
        setPullRefreshState('idle')
      })
    }
  }

  useEffect(() => {
    if (!intersectionObserverAvailable || !canObserveMore) {
      return
    }

    const root = scrollRegionRef.current
    const target = sentinelRef.current

    if (!root || !target) {
      return
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          hasNextPage &&
          !isFetchingNextPage
        ) {
          void fetchNextPage()
        }
      },
      {
        root,
        rootMargin: '160px 0px 160px 0px',
      },
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [
    canObserveMore,
    fetchNextPage,
    hasNextPage,
    intersectionObserverAvailable,
    isFetchingNextPage,
  ])

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (isRefetching || isPending) {
      return
    }

    const scrollTop = scrollRegionRef.current?.scrollTop ?? 0

    if (scrollTop > 0 || event.touches.length !== 1) {
      touchStartYRef.current = null
      return
    }

    touchStartYRef.current = event.touches[0]?.clientY ?? null
  }

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current

    if (startY === null) {
      return
    }

    const scrollTop = scrollRegionRef.current?.scrollTop ?? 0

    if (scrollTop > 0) {
      touchStartYRef.current = null
      pullRefreshStateRef.current = 'idle'
      startTransition(() => {
        setPullRefreshState('idle')
        setPullDistance(0)
      })
      return
    }

    const currentY = event.touches[0]?.clientY ?? startY
    const delta = currentY - startY

    if (delta <= 0) {
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    const nextDistance = Math.min(delta * 0.45, 110)
    const nextPullRefreshState =
      nextDistance >= pullRefreshThreshold ? 'armed' : 'pulling'

    pullRefreshStateRef.current = nextPullRefreshState

    startTransition(() => {
      setPullDistance(nextDistance)
      setPullRefreshState(nextPullRefreshState)
    })
  }

  const handleTouchEnd = () => {
    const shouldRefresh = pullRefreshStateRef.current === 'armed'
    touchStartYRef.current = null

    if (shouldRefresh) {
      void handleRefresh()
      return
    }

    pullRefreshStateRef.current = 'idle'
    startTransition(() => {
      setPullRefreshState('idle')
      setPullDistance(0)
    })
  }

  const [composerText, setComposerText] = useState('')
  const [composerPublishing, setComposerPublishing] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const composerSubmittingRef = useRef(false)
  const resolvedViewer = viewerState.data?.user ?? viewer

  const viewerMonogram = buildMonogram(
    resolvedViewer.displayName.trim() || resolvedViewer.handle?.trim(),
    'ME',
  )
  const refreshMessage = getRefreshMessage(pullRefreshState)
  const viewerIsAdmin = hasRole(resolvedViewer.roles, 'admin')
  const canPublish =
    resolvedViewer.status === 'active' &&
    Boolean(resolvedViewer.handle) &&
    composerText.trim().length > 0 &&
    !composerPublishing

  function handleSignOut() {
    signOut({ queryClient })
  }

  const handleComposerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canPublish || composerSubmittingRef.current) return

    composerSubmittingRef.current = true
    setComposerPublishing(true)
    setComposerError(null)

    try {
      await createPost({ text: composerText.trim() })
      updateCachedOptionalMe(queryClient, resolvedViewer, (currentViewer) => ({
        ...currentViewer,
        counters: {
          ...currentViewer.counters,
          posts: currentViewer.counters.posts + 1,
        },
      }))
      setComposerText('')
      await handleRefresh()
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : 'Unable to publish the post.',
      )
    } finally {
      composerSubmittingRef.current = false
      setComposerPublishing(false)
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.14),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative z-40 rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Home feed
                </h1>
              </div>
            </div>

            <div className="flex w-full max-w-xl flex-col gap-3 lg:items-end">
              <HeaderSearchBox />

              <div className="flex flex-wrap items-center gap-3">
                <NotificationBell />
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
                {resolvedViewer.handle && (
                  <a
                    href={getProfileHref(resolvedViewer.handle)}
                    className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                  >
                    View public profile
                  </a>
                )}
                {viewerIsAdmin && (
                  <a
                    href="/admin/metrics"
                    className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-medium text-amber-50 transition hover:border-amber-300/35 hover:bg-amber-300/15"
                  >
                    Admin metrics
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void handleRefresh()
                  }}
                  className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                  disabled={isPending || isRefetching}
                >
                  Refresh feed
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
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 shadow-2xl shadow-slate-950/30 backdrop-blur">
            <div
              ref={scrollRegionRef}
              data-testid="home-feed-scroll-region"
              className="max-h-[calc(100vh-12rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onTouchStart={handleTouchStart}
            >
              <div
                className="transition-transform duration-150 ease-out"
                style={{
                  transform:
                    pullDistance > 0
                      ? `translateY(${pullDistance}px)`
                      : undefined,
                }}
              >
                {pullRefreshState !== 'idle' && (
                  <div
                    aria-live="polite"
                    className="mb-4 rounded-[1.5rem] border border-white/8 bg-white/5 px-4 py-3 text-center text-sm text-slate-300"
                  >
                    {refreshMessage}
                  </div>
                )}

                <form
                  className="mb-6 flex items-start gap-3 rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-4 shadow-lg shadow-slate-950/20"
                  onSubmit={handleComposerSubmit}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.2rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 text-xs font-semibold tracking-[0.08em] text-white">
                    {viewerMonogram}
                  </div>
                  <div className="min-w-0 flex-1">
                    <textarea
                      aria-label="Post body"
                      className="block w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/30"
                      disabled={
                        composerPublishing ||
                        !resolvedViewer.handle ||
                        resolvedViewer.status !== 'active'
                      }
                      maxLength={280}
                      onChange={(event) => {
                        setComposerText(event.target.value)
                        setComposerError(null)
                      }}
                      placeholder={
                        !resolvedViewer.handle
                          ? 'Set a handle in your profile to start posting.'
                          : resolvedViewer.status !== 'active'
                            ? 'Activate your profile to start posting.'
                            : 'Share an update...'
                      }
                      rows={2}
                      value={composerText}
                    />
                    {composerError && (
                      <p className="mt-2 text-sm text-rose-300">
                        {composerError}
                      </p>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          aria-label="Browse images"
                          className="cursor-not-allowed rounded-full border border-white/10 p-2 text-slate-600 opacity-60"
                          disabled
                          title="Image attachments coming soon"
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            viewBox="0 0 24 24"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path
                              d="M21 15l-5-5L5 21"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          aria-label="Browse GIFs"
                          className="cursor-not-allowed rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 opacity-60"
                          disabled
                          title="GIF replies coming soon"
                          type="button"
                        >
                          GIF
                        </button>
                        <span className="text-xs text-slate-500">
                          {composerText.length}/280
                        </span>
                      </div>
                      <button
                        className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                        disabled={!canPublish}
                        type="submit"
                      >
                        {composerPublishing ? 'Posting...' : 'Post'}
                      </button>
                    </div>
                  </div>
                </form>

                {isPending && (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }, (_, index) => (
                      <div
                        key={`feed-skeleton-${index}`}
                        className="animate-pulse rounded-[1.75rem] border border-white/8 bg-slate-900/65 p-5"
                      >
                        <div className="flex items-start gap-4">
                          <div className="h-12 w-12 rounded-[1.2rem] bg-white/8" />
                          <div className="flex-1 space-y-3">
                            <div className="h-4 w-40 rounded-full bg-white/8" />
                            <div className="h-4 w-full rounded-full bg-white/8" />
                            <div className="h-4 w-4/5 rounded-full bg-white/8" />
                            <div className="h-28 rounded-[1.2rem] bg-white/8" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isError && (
                  <article className="rounded-[1.75rem] border border-rose-400/20 bg-rose-400/10 p-6 text-rose-50">
                    <h2 className="text-xl font-semibold">
                      Feed lookup failed
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-rose-100/90">
                      {error instanceof Error
                        ? error.message
                        : 'Unable to load the personalised feed.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRefresh()
                      }}
                      className="mt-5 rounded-full border border-rose-200/25 px-4 py-2 text-sm font-medium text-white transition hover:border-rose-100/40 hover:bg-white/6"
                    >
                      Retry feed
                    </button>
                  </article>
                )}

                {!isPending && !isError && feedEntries.length === 0 && (
                  <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-900/55 p-8 text-center">
                    <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                      Feed waiting for activity
                    </p>
                    <h2 className="mt-4 text-2xl font-semibold text-white">
                      No posts have landed in your home feed yet
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                      Publish your first post above or follow more people and
                      their posts will appear here.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <a
                        href="/me"
                        className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                      >
                        Finish your profile
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          void handleRefresh()
                        }}
                        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
                      >
                        Check again
                      </button>
                    </div>
                  </article>
                )}

                {!isPending && !isError && feedEntries.length > 0 && (
                  <div className="space-y-4">
                    {feedEntries.map((entry) => (
                      <FeedCard
                        key={entry.id}
                        entry={entry}
                        viewer={resolvedViewer}
                      />
                    ))}
                  </div>
                )}

                {!isPending && !isError && feedEntries.length > 0 && (
                  <div className="pb-4 pt-5">
                    <div ref={sentinelRef} className="h-1 w-full" />

                    {isFetchingNextPage && (
                      <p className="mt-4 text-center text-sm text-slate-400">
                        Loading older feed entries…
                      </p>
                    )}

                    {!hasNextPage && (
                      <p className="mt-4 text-center text-sm text-slate-500">
                        You&apos;ve reached the end of your feed.
                      </p>
                    )}

                    {!intersectionObserverAvailable && hasNextPage && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            void fetchNextPage()
                          }}
                          className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                        >
                          Load older entries
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <article className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 text-sm font-semibold tracking-[0.08em] text-white shadow-lg shadow-sky-950/25">
                  {viewerMonogram}
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-white">
                    {resolvedViewer.displayName}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {resolvedViewer.handle
                      ? `@${resolvedViewer.handle}`
                      : 'Handle pending'}
                  </p>
                  <p className="mt-3 line-clamp-3 text-sm leading-7 text-slate-300">
                    {resolvedViewer.bio?.trim() ||
                      'Add a bio in your profile to show it here.'}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="overflow-hidden rounded-[1.4rem] border border-white/8 bg-white/5 px-2 py-4 text-center">
                  <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
                    Posts
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(resolvedViewer.counters.posts)}
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.4rem] border border-white/8 bg-white/5 px-2 py-4 text-center">
                  <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
                    Following
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(resolvedViewer.counters.following)}
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.4rem] border border-white/8 bg-white/5 px-2 py-4 text-center">
                  <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
                    Followers
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(resolvedViewer.counters.followers)}
                  </p>
                </div>
              </div>
            </article>

          </aside>
        </div>
      </div>
    </main>
  )
}
