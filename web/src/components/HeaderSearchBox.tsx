import { startTransition, useEffect, useId, useRef, useState } from 'react'
import {
  MIN_SEARCH_QUERY_LENGTH,
  type SearchPostResult,
  type SearchUserResult,
  searchSite,
} from '../lib/search'

const debounceDelayMs = 250
const maximumQuickResults = 4
const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

interface QuickSearchResults {
  query: string
  posts: SearchPostResult[]
  users: SearchUserResult[]
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: QuickSearchResults }
  | { status: 'error'; message: string }

function getProfileHref(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`
}

function getPostHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`
}

function formatFollowerCount(value: number): string {
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
  }).format(parsed)
}

function createExcerpt(value: string, maximumLength = 140): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maximumLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maximumLength - 3)).trimEnd()}...`
}

function SearchResultUserRow({ result }: { result: SearchUserResult }) {
  return (
    <a
      href={getProfileHref(result.handle)}
      className="block rounded-[1.35rem] border border-white/8 bg-white/4 px-4 py-3 transition hover:border-cyan-300/25 hover:bg-cyan-300/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {result.displayName || `@${result.handle}`}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-cyan-100/80">
            @{result.handle}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
          {formatFollowerCount(result.followerCount)} followers
        </span>
      </div>

      {result.bio && (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">
          {result.bio}
        </p>
      )}
    </a>
  )
}

function SearchResultPostRow({ result }: { result: SearchPostResult }) {
  const timestamp = formatTimestamp(result.createdAt)

  return (
    <a
      href={getPostHref(result.id)}
      className="block rounded-[1.35rem] border border-white/8 bg-white/4 px-4 py-3 transition hover:border-fuchsia-300/25 hover:bg-fuchsia-300/10"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300">
          @{result.authorHandle || 'unknown'}
        </span>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300">
          {result.kind}
        </span>
        {timestamp && <span>{timestamp}</span>}
      </div>

      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-200">
        {createExcerpt(result.text ?? '')}
      </p>
    </a>
  )
}

export function HeaderSearchBox() {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'idle',
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isFocusedRef = useRef(false)
  const resultsId = useId()
  const trimmedQuery = query.trim()
  const hasReachedMinimumLength =
    trimmedQuery.length >= MIN_SEARCH_QUERY_LENGTH

  useEffect(() => {
    if (!isFocused) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        isFocusedRef.current = false
        startTransition(() => {
          setIsFocused(false)
        })
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isFocused])

  useEffect(() => {
    if (!isFocused) {
      return
    }

    if (!hasReachedMinimumLength) {
      startTransition(() => {
        setSearchState({ status: 'idle' })
      })
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      if (!isFocusedRef.current) {
        return
      }

      startTransition(() => {
        setSearchState({ status: 'loading' })
      })

      void Promise.all([
        searchSite(trimmedQuery, 'users', controller.signal),
        searchSite(trimmedQuery, 'posts', controller.signal),
      ])
        .then(([usersResponse, postsResponse]) => {
          startTransition(() => {
            setSearchState({
              status: 'ready',
              data: {
                query: trimmedQuery,
                users: usersResponse.results.slice(0, maximumQuickResults),
                posts: postsResponse.results.slice(0, maximumQuickResults),
              },
            })
          })
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }

          startTransition(() => {
            setSearchState({
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Unable to load quick results.',
            })
          })
        })
    }, debounceDelayMs)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [hasReachedMinimumLength, isFocused, trimmedQuery])

  const hasResults =
    searchState.status === 'ready' &&
    (searchState.data.users.length > 0 || searchState.data.posts.length > 0)
  const shouldRenderDropdown =
    isFocused &&
    (trimmedQuery.length > 0 ||
      searchState.status === 'loading' ||
      searchState.status === 'error' ||
      hasResults)

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <label className="sr-only" htmlFor={resultsId}>
        Search people and posts
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path
              d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <input
          id={resultsId}
          aria-controls={`${resultsId}-dropdown`}
          aria-expanded={shouldRenderDropdown}
          aria-label="Search people and posts"
          autoComplete="off"
          className="w-full rounded-[1.5rem] border border-white/12 bg-slate-950/65 py-3 pl-11 pr-4 text-sm text-white shadow-lg shadow-slate-950/25 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-slate-950/80 focus:ring-2 focus:ring-cyan-300/20"
          onBlur={() => {
            isFocusedRef.current = false
            window.setTimeout(() => {
              startTransition(() => {
                setIsFocused(false)
              })
            }, 0)
          }}
          onChange={(event) => {
            startTransition(() => {
              setQuery(event.target.value)
            })
          }}
          onFocus={() => {
            isFocusedRef.current = true
            startTransition(() => {
              setIsFocused(true)
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              isFocusedRef.current = false
              startTransition(() => {
                setIsFocused(false)
              })
              event.currentTarget.blur()
            }
          }}
          placeholder="Search people and posts"
          type="search"
          value={query}
        />
      </div>

      {shouldRenderDropdown && (
        <div
          id={`${resultsId}-dropdown`}
          className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 rounded-[1.75rem] border border-white/10 bg-slate-950/96 p-4 shadow-2xl shadow-slate-950/45 backdrop-blur"
        >
          {!hasReachedMinimumLength && (
            <p className="text-sm text-slate-400">
              Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search.
            </p>
          )}

          {searchState.status === 'loading' && (
            <p className="text-sm text-slate-300">Searching...</p>
          )}

          {searchState.status === 'error' && (
            <p className="text-sm text-rose-200">{searchState.message}</p>
          )}

          {searchState.status === 'ready' && hasResults && (
            <div className="space-y-4">
              {searchState.data.users.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                      People
                    </h2>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {searchState.data.users.length} shown
                    </span>
                  </div>
                  <div className="space-y-2">
                    {searchState.data.users.map((result) => (
                      <SearchResultUserRow key={result.id} result={result} />
                    ))}
                  </div>
                </section>
              )}

              {searchState.data.posts.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-xs font-medium uppercase tracking-[0.24em] text-fuchsia-100/80">
                      Posts
                    </h2>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {searchState.data.posts.length} shown
                    </span>
                  </div>
                  <div className="space-y-2">
                    {searchState.data.posts.map((result) => (
                      <SearchResultPostRow key={result.id} result={result} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {searchState.status === 'ready' && !hasResults && (
            <p className="text-sm text-slate-400">
              No quick results matched "{searchState.data.query}".
            </p>
          )}
        </div>
      )}
    </div>
  )
}
