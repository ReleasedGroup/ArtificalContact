import { useQuery } from '@tanstack/react-query'
import {
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { searchSite, type SearchResponse, type SearchType } from '../lib/search'

interface SearchResultsScreenProps {
  initialQuery: string
  initialType: SearchType
}

const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const searchTabs: Array<{ value: SearchType; label: string }> = [
  { value: 'posts', label: 'Posts' },
  { value: 'users', label: 'People' },
  { value: 'hashtags', label: 'Hashtags' },
]

function formatCount(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '0'
  }

  return value >= 1000 ? compactCountFormatter.format(value) : String(value)
}

function formatTimestamp(value: string): string | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function buildMonogram(source: string): string {
  const trimmed = source.trim()
  if (trimmed.length === 0) {
    return 'AC'
  }

  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return trimmed.slice(0, 2).toUpperCase()
}

function getProfileHref(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`
}

function getPostHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`
}

function getSearchHref(query: string, type: SearchType): string {
  const params = new URLSearchParams()
  if (query.trim().length > 0) {
    params.set('q', query.trim())
  }
  if (type !== 'posts') {
    params.set('type', type)
  }

  return `/search${params.size > 0 ? `?${params.toString()}` : ''}`
}

function SearchPostResults({ response }: { response: SearchResponse }) {
  if (response.type !== 'posts') {
    return null
  }

  return (
    <div className="space-y-4">
      {response.results.map((result) => {
        const timestamp = formatTimestamp(result.createdAt)

        return (
          <article
            key={result.id}
            className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-5 shadow-lg shadow-slate-950/20"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 text-sm font-semibold tracking-[0.08em] text-white">
                {buildMonogram(result.authorHandle)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <a
                    href={getProfileHref(result.authorHandle)}
                    className="font-semibold text-white transition hover:text-cyan-100"
                  >
                    @{result.authorHandle}
                  </a>
                  {timestamp && (
                    <time className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {timestamp}
                    </time>
                  )}
                  {result.kind === 'github' && (
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-100">
                      GitHub {result.githubEventType ?? 'event'}
                    </span>
                  )}
                </div>

                <a
                  href={getPostHref(result.id)}
                  className="mt-4 block rounded-[1.35rem] border border-transparent bg-white/0 px-1 py-1 transition hover:border-white/8 hover:bg-white/4"
                >
                  <p className="text-sm leading-7 text-slate-200 sm:text-[15px]">
                    {result.text.trim() ||
                      'This post does not include a text excerpt yet.'}
                  </p>
                </a>

                {(result.hashtags.length > 0 || result.mediaKinds.length > 0) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.hashtags.map((hashtag) => (
                      <a
                        key={`${result.id}-hashtag-${hashtag}`}
                        href={getSearchHref(hashtag, 'hashtags')}
                        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
                      >
                        #{hashtag}
                      </a>
                    ))}
                    {result.mediaKinds.map((mediaKind) => (
                      <span
                        key={`${result.id}-media-${mediaKind}`}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300"
                      >
                        {mediaKind}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-cyan-100">
                      {formatCount(result.likeCount)} likes
                    </span>
                    <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-fuchsia-100">
                      {formatCount(result.replyCount)} replies
                    </span>
                    {result.githubRepo && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">
                        {result.githubRepo}
                      </span>
                    )}
                  </div>

                  <a
                    href={getPostHref(result.id)}
                    className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                  >
                    Open post
                  </a>
                </div>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function SearchUserResults({ response }: { response: SearchResponse }) {
  if (response.type !== 'users') {
    return null
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {response.results.map((result) => (
        <article
          key={result.id}
          className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-5 shadow-lg shadow-slate-950/20"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-emerald-500 to-cyan-500 text-base font-semibold tracking-[0.08em] text-slate-950">
              {buildMonogram(result.displayName || result.handle)}
            </div>
            <div className="min-w-0 flex-1">
              <a
                href={getProfileHref(result.handle)}
                className="text-lg font-semibold text-white transition hover:text-cyan-100"
              >
                {result.displayName || `@${result.handle}`}
              </a>
              <p className="mt-1 text-sm text-slate-400">@{result.handle}</p>
              <p className="mt-4 text-sm leading-7 text-slate-200">
                {result.bio.trim() || 'This profile does not have a public bio yet.'}
              </p>

              {result.expertise.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {result.expertise.map((expertise) => (
                    <span
                      key={`${result.id}-expertise-${expertise}`}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200"
                    >
                      {expertise}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-300">
                  <span className="font-semibold text-white">
                    {formatCount(result.followerCount)}
                  </span>{' '}
                  followers
                </span>
                <a
                  href={getProfileHref(result.handle)}
                  className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
                >
                  Open profile
                </a>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function SearchHashtagResults({ response }: { response: SearchResponse }) {
  if (response.type !== 'hashtags') {
    return null
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {response.results.map((result) => (
        <article
          key={result.value}
          className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-5 shadow-lg shadow-slate-950/20"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70">
            Hashtag
          </p>
          <a
            href={getSearchHref(result.value, 'posts')}
            className="mt-4 block text-2xl font-semibold tracking-tight text-white transition hover:text-cyan-100"
          >
            #{result.value}
          </a>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Found in {formatCount(result.count)} matching public posts.
          </p>
          <a
            href={getSearchHref(result.value, 'posts')}
            className="mt-5 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
          >
            View posts
          </a>
        </article>
      ))}
    </div>
  )
}

export function SearchResultsScreen({
  initialQuery,
  initialType,
}: SearchResultsScreenProps) {
  const [query, setQuery] = useState(initialQuery)
  const [activeType, setActiveType] = useState<SearchType>(initialType)

  const normalizedQuery = query.trim()
  const deferredQuery = useDeferredValue(normalizedQuery)

  useEffect(() => {
    const nextHref = getSearchHref(normalizedQuery, activeType)
    const currentHref = `${window.location.pathname}${window.location.search}`

    if (currentHref !== nextHref) {
      window.history.replaceState({}, '', nextHref)
    }
  }, [activeType, normalizedQuery])

  const searchQuery = useQuery({
    queryKey: ['search', deferredQuery, activeType],
    queryFn: ({ signal }) => searchSite(deferredQuery, activeType, signal),
    enabled: deferredQuery.length > 0,
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const resultCount =
    searchQuery.data && typeof searchQuery.data.totalCount === 'number'
      ? searchQuery.data.totalCount
      : null

  const resultLabel =
    activeType === 'posts'
      ? 'posts'
      : activeType === 'users'
        ? 'people'
        : 'hashtags'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.14),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-6 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                  Search
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Azure AI Search
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Public route
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Search results
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Explore public posts, practitioner profiles, and hashtags from
                  the Azure AI Search-backed discovery index.
                </p>
              </div>
            </div>

            <a
              href="/"
              className="inline-flex rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
            >
              Back to home
            </a>
          </div>

          <form
            className="mt-6"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
            }}
          >
            <label className="sr-only" htmlFor="search-query">
              Search query
            </label>
            <input
              id="search-query"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              placeholder="Search posts, people, or hashtags"
              className="w-full rounded-[1.4rem] border border-white/10 bg-slate-950/85 px-5 py-4 text-base text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/30"
            />
          </form>

          <div
            className="mt-5 flex flex-wrap gap-2"
            aria-label="Search result types"
            role="tablist"
          >
            {searchTabs.map((tab) => {
              const isActive = activeType === tab.value

              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveType(tab.value)
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80 ${
                    isActive
                      ? 'border border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
                      : 'border border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </header>

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:p-6">
          {normalizedQuery.length === 0 && (
            <div className="rounded-[1.75rem] border border-dashed border-white/12 bg-white/4 px-6 py-12 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                Start with a query
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
                Search posts, people, or hashtags.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                The tabs stay on the same route while the query updates the
                result set as you type.
              </p>
            </div>
          )}

          {normalizedQuery.length > 0 && searchQuery.isPending && (
            <div className="space-y-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={`search-skeleton-${index}`}
                  className="animate-pulse rounded-[1.75rem] border border-white/8 bg-slate-900/65 p-5"
                >
                  <div className="h-4 w-40 rounded-full bg-white/8" />
                  <div className="mt-4 h-4 rounded-full bg-white/8" />
                  <div className="mt-3 h-4 w-5/6 rounded-full bg-white/8" />
                </div>
              ))}
            </div>
          )}

          {normalizedQuery.length > 0 && searchQuery.isError && (
            <div className="rounded-[1.75rem] border border-rose-400/20 bg-rose-400/10 px-6 py-10 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-rose-100/80">
                Search unavailable
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
                The search request failed.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-rose-50/90">
                {searchQuery.error instanceof Error
                  ? searchQuery.error.message
                  : 'Unable to load search results right now.'}
              </p>
            </div>
          )}

          {normalizedQuery.length > 0 && searchQuery.isSuccess && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/8 bg-white/4 px-4 py-3">
                <p className="text-sm text-slate-300">
                  Showing{' '}
                  <span className="font-semibold text-white">
                    {formatCount(resultCount)}
                  </span>{' '}
                  {resultLabel} for{' '}
                  <span className="font-semibold text-white">
                    {searchQuery.data.query || normalizedQuery}
                  </span>
                  .
                </p>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                  {activeType}
                </span>
              </div>

              {searchQuery.data.results.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-white/12 bg-white/4 px-6 py-12 text-center">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                    No matches
                  </p>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
                    No {resultLabel} matched that search.
                  </h2>
                  <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                    Try a broader query, switch tabs, or search by a handle
                    prefix such as <span className="text-cyan-100">ada</span>.
                  </p>
                </div>
              ) : (
                <>
                  <SearchPostResults response={searchQuery.data} />
                  <SearchUserResults response={searchQuery.data} />
                  <SearchHashtagResults response={searchQuery.data} />
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
