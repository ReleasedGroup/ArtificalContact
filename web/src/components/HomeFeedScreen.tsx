import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type TouchEvent,
} from 'react'
import type { MeProfile } from '../lib/me'
import { getFeedPage, type FeedEntry } from '../lib/feed'
import { signOut } from '../lib/auth'
import { HeaderSearchBox } from './HeaderSearchBox'

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

function buildMonogram(source: string | null | undefined, fallback: string): string {
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

function FeedCard({ entry }: { entry: FeedEntry }) {
  const authorName = getAuthorName(entry)
  const authorHandle = entry.authorHandle?.trim() || null
  const timestamp = formatTimestamp(entry.createdAt)

  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-5 shadow-lg shadow-slate-950/20 transition hover:border-white/15 hover:bg-slate-900/80">
      <div className="flex items-start gap-4">
        {entry.authorAvatarUrl ? (
          <img
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
            <p className="text-sm leading-7 text-slate-200 sm:text-[15px]">
              {entry.excerpt?.trim() || 'This feed item does not include an excerpt yet.'}
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
                      <img
                        src={media.thumbUrl}
                        alt={media.kind ? `${media.kind} preview` : 'Media preview'}
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
          </div>
        </div>
      </div>
    </article>
  )
}

export function HomeFeedScreen({ viewer }: HomeFeedScreenProps) {
  const queryClient = useQueryClient()
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

  const viewerMonogram = buildMonogram(
    viewer.displayName.trim() || viewer.handle?.trim(),
    'ME',
  )
  const refreshMessage = getRefreshMessage(pullRefreshState)

  function handleSignOut() {
    signOut({ queryClient })
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.14),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                  Personal feed
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Infinite scroll active
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Pull to refresh ready
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Home feed
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  New posts from the people you follow appear here from the
                  denormalised `feeds` read model. Pull down on touch devices to
                  refresh the list or keep scrolling to page deeper into the
                  backlog.
                </p>
              </div>
            </div>

            <div className="flex w-full max-w-xl flex-col gap-3 lg:items-end">
              <HeaderSearchBox />

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="/me"
                  className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                >
                  Edit profile
                </a>
                {viewer.handle && (
                  <a
                    href={getProfileHref(viewer.handle)}
                    className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                  >
                    View public profile
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
                    pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
                }}
              >
                <div
                  aria-live="polite"
                  className="mb-4 rounded-[1.5rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300"
                >
                  {refreshMessage}
                </div>

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
                    <h2 className="text-xl font-semibold">Feed lookup failed</h2>
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

                {!isPending &&
                  !isError &&
                  feedEntries.length === 0 && (
                    <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-900/55 p-8 text-center">
                      <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                        Feed waiting for activity
                      </p>
                      <h2 className="mt-4 text-2xl font-semibold text-white">
                        No posts have landed in your home feed yet
                      </h2>
                      <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                        Follow more practitioners and their next posts will
                        materialise here through the Cosmos-backed feed fan-out
                        pipeline.
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

                {!isPending &&
                  !isError &&
                  feedEntries.length > 0 && (
                    <div className="space-y-4">
                      {feedEntries.map((entry) => (
                        <FeedCard key={entry.id} entry={entry} />
                      ))}
                    </div>
                  )}

                {!isPending &&
                  !isError &&
                  feedEntries.length > 0 && (
                    <div className="pb-4 pt-5">
                      <div ref={sentinelRef} className="h-1 w-full" />

                      {isFetchingNextPage && (
                        <p className="mt-4 text-center text-sm text-slate-400">
                          Loading older feed entries…
                        </p>
                      )}

                      {!hasNextPage && (
                        <p className="mt-4 text-center text-sm text-slate-500">
                          You&apos;ve reached the end of the currently materialised
                          feed.
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
                    {viewer.displayName}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {viewer.handle ? `@${viewer.handle}` : 'Handle pending'}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {viewer.bio?.trim() ||
                      'Complete the /me editor to add a public bio for the home feed and profile surfaces.'}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-[1.4rem] border border-white/8 bg-white/5 px-3 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Posts
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(viewer.counters.posts)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/8 bg-white/5 px-3 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Following
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(viewer.counters.following)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/8 bg-white/5 px-3 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Followers
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatCount(viewer.counters.followers)}
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                Feed behaviour
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  New pages load automatically when the sentinel nears the
                  bottom of the scroll region.
                </li>
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  Touch gestures at the top of the list refetch the feed without
                  leaving the route.
                </li>
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  Each card links directly into the public post detail route and
                  author profile when a handle is present.
                </li>
              </ul>
            </article>
          </aside>
        </div>
      </div>
    </main>
  )
}
