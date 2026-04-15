import { useQuery } from '@tanstack/react-query'
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  searchSite,
  type SearchFacetValue,
  type SearchFilters,
  type SearchHashtagsData,
  type SearchPostsData,
  type SearchResponseData,
  type SearchResultType,
  type SearchUserResult,
} from '../lib/search'

interface SearchRouteState {
  query: string
  type: SearchResultType
  filters: SearchFilters
}

const searchTabs: { label: string; value: SearchResultType }[] = [
  { label: 'Posts', value: 'posts' },
  { label: 'People', value: 'users' },
  { label: 'Hashtags', value: 'hashtags' },
]

function normalizeSearchType(value: string | null): SearchResultType {
  if (value === 'users' || value === 'hashtags') {
    return value
  }

  return 'posts'
}

function normalizeFacetValue(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim().replace(/^#/, '').toLowerCase()
  return normalizedValue.length > 0 ? normalizedValue : null
}

function normalizeFiltersForType(
  type: SearchResultType,
  filters: SearchFilters,
): SearchFilters {
  const mediaKind = normalizeFacetValue(filters.mediaKind)

  if (type === 'users') {
    return {
      hashtag: null,
      mediaKind: null,
    }
  }

  if (type === 'hashtags') {
    return {
      hashtag: null,
      mediaKind,
    }
  }

  return {
    hashtag: normalizeFacetValue(filters.hashtag),
    mediaKind,
  }
}

function normalizeRouteState(state: SearchRouteState): SearchRouteState {
  return {
    ...state,
    filters: normalizeFiltersForType(state.type, state.filters),
  }
}

function parseRouteState(
  search: string = window.location.search,
): SearchRouteState {
  const params = new URLSearchParams(search)
  const type = normalizeSearchType(params.get('type'))

  return normalizeRouteState({
    query: params.get('q')?.trim() ?? '',
    type,
    filters: normalizeFiltersForType(type, {
      hashtag: params.get('hashtag'),
      mediaKind: params.get('mediaKind'),
    }),
  })
}

function buildSearchHref(state: SearchRouteState): string {
  const normalizedState = normalizeRouteState(state)
  const params = new URLSearchParams()

  if (normalizedState.query.trim().length > 0) {
    params.set('q', normalizedState.query.trim())
  }

  if (normalizedState.type !== 'posts') {
    params.set('type', normalizedState.type)
  }

  if (normalizedState.filters.hashtag) {
    params.set('hashtag', normalizedState.filters.hashtag)
  }

  if (normalizedState.filters.mediaKind) {
    params.set('mediaKind', normalizedState.filters.mediaKind)
  }

  const serialized = params.toString()
  return serialized.length > 0 ? `/search?${serialized}` : '/search'
}

function updateBrowserRoute(nextState: SearchRouteState) {
  const nextUrl = buildSearchHref(nextState)
  window.history.pushState({}, '', nextUrl)
}

function replaceBrowserRoute(nextState: SearchRouteState) {
  const nextUrl = buildSearchHref(nextState)
  window.history.replaceState({}, '', nextUrl)
}

function formatCount(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0'
  }

  return value.toLocaleString()
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

function renderResultSummary(data: SearchResponseData) {
  const count = formatCount(data.totalCount)

  if (data.type === 'posts') {
    return `${count} posts`
  }

  if (data.type === 'users') {
    return `${count} people`
  }

  return `${count} hashtags`
}

function SearchFacetGroup(props: {
  title: string
  values: SearchFacetValue[]
  selectedValue: string | null
  formatValue: (value: string) => string
  onToggle: (value: string) => void
}) {
  if (props.values.length === 0) {
    return null
  }

  const selectedValue = props.selectedValue

  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5 shadow-xl shadow-slate-950/20">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
          {props.title}
        </h2>
        {selectedValue && (
          <button
            type="button"
            onClick={() => props.onToggle(selectedValue)}
            className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-200"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {props.values.map((value) => {
          const selected = props.selectedValue === value.value

          return (
            <button
              key={value.value}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onToggle(value.value)}
              className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                selected
                  ? 'border-cyan-300/45 bg-cyan-300/15 text-cyan-50'
                  : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/8'
              }`}
            >
              {props.formatValue(value.value)}
              <span className="ml-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                {value.count}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function SearchPostsResults(props: { data: SearchPostsData }) {
  if (props.data.results.length === 0) {
    return (
      <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-950/55 p-8 text-center">
        <h2 className="text-2xl font-semibold text-white">No posts matched</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Try a broader query or clear one of the active facets to widen the
          post results.
        </p>
      </article>
    )
  }

  return (
    <div className="space-y-4">
      {props.data.results.map((result) => {
        const formattedCreatedAt = formatTimestamp(result.createdAt)

        return (
          <article
            key={result.id}
            className="rounded-[1.75rem] border border-white/10 bg-slate-950/68 p-5 shadow-xl shadow-slate-950/20"
          >
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {result.authorHandle ? (
                <a
                  href={`/u/${encodeURIComponent(result.authorHandle)}`}
                  className="font-semibold text-white transition hover:text-cyan-100"
                >
                  @{result.authorHandle}
                </a>
              ) : (
                <span className="font-semibold text-white">Unknown author</span>
              )}
              {result.kind === 'github' && (
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-100">
                  GitHub
                </span>
              )}
              {formattedCreatedAt && (
                <time className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {formattedCreatedAt}
                </time>
              )}
            </div>

            <a
              href={`/p/${encodeURIComponent(result.id)}`}
              className="mt-4 block rounded-[1.4rem] border border-transparent bg-white/0 px-1 py-1 transition hover:border-white/8 hover:bg-white/4"
            >
              <p className="text-sm leading-7 text-slate-200 sm:text-[15px]">
                {result.text?.trim() ||
                  'This post did not include searchable text.'}
              </p>
            </a>

            <div className="mt-4 flex flex-wrap gap-2">
              {result.hashtags.map((hashtag) => (
                <a
                  key={`${result.id}-${hashtag}`}
                  href={buildSearchHref({
                    query: hashtag,
                    type: 'hashtags',
                    filters: {
                      hashtag: null,
                      mediaKind: null,
                    },
                  })}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-50"
                >
                  #{hashtag}
                </a>
              ))}
              {result.mediaKinds.map((mediaKind) => (
                <span
                  key={`${result.id}-${mediaKind}`}
                  className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-fuchsia-50"
                >
                  {mediaKind}
                </span>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                {formatCount(result.likeCount)} likes
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                {formatCount(result.replyCount)} replies
              </span>
              {result.githubRepo && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  {result.githubRepo}
                </span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function SearchUsersResults(props: { results: SearchUserResult[] }) {
  if (props.results.length === 0) {
    return (
      <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-950/55 p-8 text-center">
        <h2 className="text-2xl font-semibold text-white">No people matched</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Try a handle prefix, display name, or a topic from someone&apos;s bio
          or expertise list.
        </p>
      </article>
    )
  }

  return (
    <div className="space-y-4">
      {props.results.map((result) => (
        <article
          key={result.id}
          className="rounded-[1.75rem] border border-white/10 bg-slate-950/68 p-5 shadow-xl shadow-slate-950/20"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <a
                href={`/u/${encodeURIComponent(result.handle)}`}
                className="text-xl font-semibold text-white transition hover:text-cyan-100"
              >
                {result.displayName?.trim() || `@${result.handle}`}
              </a>
              <p className="mt-1 text-sm text-slate-400">@{result.handle}</p>
            </div>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-cyan-100">
              {formatCount(result.followerCount)} followers
            </span>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-300">
            {result.bio?.trim() ||
              'This profile has not published a public bio yet.'}
          </p>

          {result.expertise.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {result.expertise.map((expertise) => (
                <span
                  key={`${result.id}-${expertise}`}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-slate-200"
                >
                  {expertise}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}

function SearchHashtagsResults(props: {
  data: SearchHashtagsData
}) {
  if (props.data.results.length === 0) {
    return (
      <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-950/55 p-8 text-center">
        <h2 className="text-2xl font-semibold text-white">
          No hashtags matched
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Try a broader query or clear the media facet to widen the hashtag
          list.
        </p>
      </article>
    )
  }

  return (
    <div className="space-y-4">
      {props.data.results.map((result) => (
        <article
          key={result.hashtag}
          className="flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] border border-white/10 bg-slate-950/68 p-5 shadow-xl shadow-slate-950/20"
        >
          <div>
            <a
              href={buildSearchHref({
                query: result.hashtag,
                type: 'posts',
                filters: {
                  hashtag: null,
                  mediaKind: null,
                },
              })}
              className="text-xl font-semibold text-white transition hover:text-cyan-100"
            >
              #{result.hashtag}
            </a>
            <p className="mt-1 text-sm text-slate-400">
              {formatCount(result.count)} matching posts
            </p>
          </div>
          <a
            href={buildSearchHref({
              query: result.hashtag,
              type: 'posts',
              filters: {
                hashtag: null,
                mediaKind: null,
              },
            })}
            className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
          >
            Browse posts
          </a>
        </article>
      ))}
    </div>
  )
}

export function SearchScreen() {
  const [routeState, setRouteState] = useState<SearchRouteState>(() =>
    parseRouteState(),
  )
  const [draftQuery, setDraftQuery] = useState(routeState.query)
  const deferredQuery = useDeferredValue(draftQuery.trim())
  const scopedFilters = useMemo(
    () => normalizeFiltersForType(routeState.type, routeState.filters),
    [routeState.filters, routeState.type],
  )

  useEffect(() => {
    const handlePopState = () => {
      const nextState = parseRouteState()
      startTransition(() => {
        setRouteState(nextState)
        setDraftQuery(nextState.query)
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (deferredQuery === routeState.query) {
      return
    }

    const nextState = normalizeRouteState({
      ...routeState,
      query: deferredQuery,
    })

    replaceBrowserRoute(nextState)
    startTransition(() => {
      setRouteState(nextState)
    })
  }, [deferredQuery, routeState])

  useEffect(() => {
    const normalizedUrl = buildSearchHref(routeState)
    const currentUrl = `${window.location.pathname}${window.location.search}`

    if (currentUrl !== normalizedUrl) {
      replaceBrowserRoute(routeState)
    }
  }, [
    routeState,
    routeState.query,
    routeState.type,
    scopedFilters.hashtag,
    scopedFilters.mediaKind,
  ])

  const searchQuery = useQuery({
    queryKey: [
      'search',
      routeState.query,
      routeState.type,
      scopedFilters.hashtag,
      scopedFilters.mediaKind,
    ],
    queryFn: ({ signal }) =>
      searchSite({
        query: routeState.query,
        type: routeState.type,
        filters: scopedFilters,
        signal,
      }),
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const activeFilters = useMemo(
    () =>
      [
        scopedFilters.hashtag
          ? {
              key: 'hashtag',
              label: `#${scopedFilters.hashtag}`,
            }
          : null,
        scopedFilters.mediaKind
          ? {
              key: 'mediaKind',
              label: scopedFilters.mediaKind,
            }
          : null,
      ].filter(
        (value): value is { key: 'hashtag' | 'mediaKind'; label: string } =>
          value !== null,
      ),
    [scopedFilters.hashtag, scopedFilters.mediaKind],
  )

  const commitRouteState = (nextState: SearchRouteState) => {
    const normalizedState = normalizeRouteState(nextState)
    updateBrowserRoute(normalizedState)
    startTransition(() => {
      setRouteState(normalizedState)
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    commitRouteState({
      ...routeState,
      query: draftQuery.trim(),
    })
  }

  const handleTabSelect = (type: SearchResultType) => {
    commitRouteState({
      ...routeState,
      type,
    })
  }

  const toggleHashtagFacet = (value: string) => {
    const normalizedValue = value.trim().replace(/^#/, '').toLowerCase()

    commitRouteState({
      ...routeState,
      type: 'posts',
      filters: {
        ...routeState.filters,
        hashtag:
          routeState.filters.hashtag === normalizedValue
            ? null
            : normalizedValue,
      },
    })
  }

  const toggleMediaKindFacet = (value: string) => {
    const normalizedValue = value.trim().toLowerCase()

    commitRouteState({
      ...routeState,
      type: 'posts',
      filters: {
        ...routeState.filters,
        mediaKind:
          routeState.filters.mediaKind === normalizedValue
            ? null
            : normalizedValue,
      },
    })
  }

  const clearAllFilters = () => {
    commitRouteState({
      ...routeState,
      filters: {
        hashtag: null,
        mediaKind: null,
      },
    })
  }

  const data = searchQuery.data

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(244,114,182,0.14),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-6 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                  Azure AI Search
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Public route
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Facets active
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Search results
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Search public posts, people, and hashtags. On the posts tab,
                  facet buttons narrow the result set by hashtag and media kind
                  without leaving the page.
                </p>
              </div>
            </div>

            <form className="w-full max-w-3xl" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="search-page-query">
                  Search query
                </label>
                <input
                  id="search-page-query"
                  type="search"
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  placeholder="Search posts, handles, bios, and hashtags"
                  className="w-full rounded-[1.35rem] border border-white/12 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-2 focus:ring-cyan-300/25"
                />
                <button
                  type="submit"
                  className="rounded-[1.35rem] border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
                >
                  Search
                </button>
              </div>
            </form>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-4 shadow-2xl shadow-slate-950/30 backdrop-blur sm:p-6">
            <div className="flex flex-wrap gap-2">
              {searchTabs.map((tab) => {
                const selected = routeState.type === tab.value

                return (
                  <button
                    key={tab.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleTabSelect(tab.value)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      selected
                        ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-50'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/8'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <div>
                <span className="font-medium text-white">
                  {searchQuery.isPending
                    ? 'Searching…'
                    : data
                      ? renderResultSummary(data)
                      : 'Search results'}
                </span>
                {routeState.query.trim().length > 0 && (
                  <span className="ml-2 text-slate-400">
                    for “{routeState.query}”
                  </span>
                )}
              </div>

              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {activeFilters.map((filter) => (
                    <span
                      key={filter.key}
                      className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-cyan-100"
                    >
                      {filter.label}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-200"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5">
              {searchQuery.isPending && (
                <div className="space-y-4">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div
                      key={`search-skeleton-${index}`}
                      className="animate-pulse rounded-[1.75rem] border border-white/8 bg-slate-900/65 p-5"
                    >
                      <div className="h-4 w-40 rounded-full bg-white/8" />
                      <div className="mt-4 h-4 w-full rounded-full bg-white/8" />
                      <div className="mt-3 h-4 w-4/5 rounded-full bg-white/8" />
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.isError && (
                <article className="rounded-[1.75rem] border border-rose-400/20 bg-rose-400/10 p-6 text-rose-50">
                  <h2 className="text-xl font-semibold">Search failed</h2>
                  <p className="mt-3 text-sm leading-7 text-rose-100/90">
                    {searchQuery.error instanceof Error
                      ? searchQuery.error.message
                      : 'Unable to load search results right now.'}
                  </p>
                </article>
              )}

              {data?.type === 'posts' &&
                !searchQuery.isPending &&
                !searchQuery.isError && (
                  <SearchPostsResults data={data} />
                )}

              {data?.type === 'users' &&
                !searchQuery.isPending &&
                !searchQuery.isError && (
                  <SearchUsersResults results={data.results} />
                )}

              {data?.type === 'hashtags' &&
                !searchQuery.isPending &&
                !searchQuery.isError && (
                  <SearchHashtagsResults data={data} />
                )}
            </div>
          </section>

          <aside className="space-y-6">
            <article className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                Query shape
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  Posts search scopes across body text, hashtags, author
                  handles, and GitHub repo identifiers.
                </li>
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  People search matches handles, display names, bios, and
                  expertise tags.
                </li>
                <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                  Hashtag results roll up the faceted tag counts from the
                  matching public post set.
                </li>
              </ul>
            </article>

            {data?.type === 'posts' && (
              <>
                <SearchFacetGroup
                  title="Hashtags"
                  values={data.facets.hashtags}
                  selectedValue={routeState.filters.hashtag}
                  formatValue={(value) => `#${value}`}
                  onToggle={toggleHashtagFacet}
                />
                <SearchFacetGroup
                  title="Media Kind"
                  values={data.facets.mediaKinds}
                  selectedValue={routeState.filters.mediaKind}
                  formatValue={(value) => value}
                  onToggle={toggleMediaKindFacet}
                />
              </>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
