interface ApiError {
  code: string
  message: string
  field?: string
}

export type SearchType = 'posts' | 'users' | 'hashtags'
export type SearchResultType = SearchType

export interface SearchFilters {
  hashtag: string | null
  mediaKind: string | null
}

export interface SearchFacetValue {
  value: string
  count: number
}

export interface SearchPostResult {
  type: 'post'
  id: string
  kind: 'user' | 'github'
  authorHandle: string | null
  text: string | null
  hashtags: string[]
  mediaKinds: string[]
  createdAt: string | null
  likeCount: number
  replyCount: number
  githubEventType: string | null
  githubRepo: string | null
}

export interface SearchUserResult {
  type: 'user'
  id: string
  handle: string
  displayName: string | null
  bio: string | null
  expertise: string[]
  followerCount: number
}

export interface SearchHashtagResult {
  type: 'hashtag'
  hashtag: string
  count: number
}

export interface SearchPostsData {
  type: 'posts'
  query: string
  filters: SearchFilters
  totalCount: number | null
  facets: {
    hashtags: SearchFacetValue[]
    mediaKinds: SearchFacetValue[]
  }
  results: SearchPostResult[]
}

export interface SearchUsersData {
  type: 'users'
  query: string
  filters: SearchFilters
  totalCount: number | null
  results: SearchUserResult[]
}

export interface SearchHashtagsData {
  type: 'hashtags'
  query: string
  filters: SearchFilters
  totalCount: number | null
  results: SearchHashtagResult[]
}

export type SearchResponseData =
  | SearchPostsData
  | SearchUsersData
  | SearchHashtagsData

export type SearchResponse = SearchResponseData

export const MIN_SEARCH_QUERY_LENGTH = 2

interface SearchEnvelope {
  data: SearchResponseData | null
  errors: ApiError[]
}

interface LegacySearchApiResponse {
  '@odata.count'?: number
  value: unknown[]
}

interface SearchSiteOptions {
  query: string
  type: SearchResultType
  filters?: SearchFilters
  signal?: AbortSignal
}

function readErrorMessage(payload: { errors?: ApiError[] } | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

function normalizeFacetToken(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim().replace(/^#/, '').toLowerCase()
  return normalizedValue.length > 0 ? normalizedValue : null
}

function buildFilterValue(filters: SearchFilters): string | null {
  const tokens: string[] = []

  const hashtag = normalizeFacetToken(filters.hashtag)
  if (hashtag) {
    tokens.push(`hashtag:${hashtag}`)
  }

  const mediaKind = normalizeFacetToken(filters.mediaKind)
  if (mediaKind) {
    tokens.push(`mediaKind:${mediaKind}`)
  }

  return tokens.length > 0 ? tokens.join(',') : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapLegacyPostResults(results: unknown[]): SearchPostResult[] {
  return results.flatMap((result) => {
    if (!isRecord(result)) {
      return []
    }

    const id = readString(result.id)
    if (id === null) {
      return []
    }

    return [
      {
        type: 'post',
        id,
        kind: readString(result.kind) === 'github' ? 'github' : 'user',
        authorHandle: readString(result.authorHandle),
        text: readString(result.text),
        hashtags: readStringArray(result.hashtags),
        mediaKinds: readStringArray(result.mediaKinds),
        createdAt: readString(result.createdAt),
        likeCount: readNumber(result.likeCount),
        replyCount: readNumber(result.replyCount),
        githubEventType: readString(result.githubEventType),
        githubRepo: readString(result.githubRepo),
      } satisfies SearchPostResult,
    ]
  })
}

function mapLegacyUserResults(results: unknown[]): SearchUserResult[] {
  return results.flatMap((result) => {
    if (!isRecord(result)) {
      return []
    }

    const id = readString(result.id)
    const handle = readString(result.handle)
    if (id === null || handle === null) {
      return []
    }

    return [
      {
        type: 'user',
        id,
        handle,
        displayName: readString(result.displayName),
        bio: readString(result.bio),
        expertise: readStringArray(result.expertise),
        followerCount: readNumber(result.followerCount),
      } satisfies SearchUserResult,
    ]
  })
}

function mapLegacyHashtagResults(results: unknown[]): SearchHashtagResult[] {
  return results.flatMap((result) => {
    if (!isRecord(result)) {
      return []
    }

    const hashtag = readString(result.hashtag) ?? readString(result.value) ?? readString(result.id)
    if (hashtag === null) {
      return []
    }

    return [
      {
        type: 'hashtag',
        hashtag,
        count: readNumber(result.count),
      } satisfies SearchHashtagResult,
    ]
  })
}

function normalizeLegacyPayload(
  payload: SearchEnvelope | { data: LegacySearchApiResponse | null; errors: ApiError[] } | null,
  options: SearchSiteOptions,
): SearchResponseData | null {
  if (!payload?.data) {
    return null
  }

  if ('results' in payload.data || 'facets' in payload.data) {
    return payload.data as SearchResponseData
  }

  if (!Array.isArray(payload.data.value)) {
    return null
  }

  const totalCount =
    typeof payload.data['@odata.count'] === 'number'
      ? payload.data['@odata.count']
      : null

  if (options.type === 'posts') {
    return {
      type: 'posts',
      query: options.query.trim(),
      filters: options.filters ?? {
        hashtag: null,
        mediaKind: null,
      },
      totalCount,
      facets: {
        hashtags: [],
        mediaKinds: [],
      },
      results: mapLegacyPostResults(payload.data.value),
    }
  }

  if (options.type === 'users') {
    return {
      type: 'users',
      query: options.query.trim(),
      filters: options.filters ?? {
        hashtag: null,
        mediaKind: null,
      },
      totalCount,
      results: mapLegacyUserResults(payload.data.value),
    }
  }

  return {
    type: 'hashtags',
    query: options.query.trim(),
    filters: options.filters ?? {
      hashtag: null,
      mediaKind: null,
    },
    totalCount,
    results: mapLegacyHashtagResults(payload.data.value),
  }
}

function normalizeOptions(
  queryOrOptions: string | SearchSiteOptions,
  type?: SearchResultType,
  signal?: AbortSignal,
): SearchSiteOptions {
  if (typeof queryOrOptions === 'string') {
    return {
      query: queryOrOptions,
      type: type ?? 'posts',
      filters: {
        hashtag: null,
        mediaKind: null,
      },
      signal,
    }
  }

  return {
    ...queryOrOptions,
    filters: queryOrOptions.filters ?? {
      hashtag: null,
      mediaKind: null,
    },
  }
}

export function searchSite(
  query: string,
  type: 'posts',
  signal?: AbortSignal,
): Promise<SearchPostsData>
export function searchSite(
  query: string,
  type: 'users',
  signal?: AbortSignal,
): Promise<SearchUsersData>
export function searchSite(
  query: string,
  type: 'hashtags',
  signal?: AbortSignal,
): Promise<SearchHashtagsData>
export function searchSite(options: SearchSiteOptions): Promise<SearchResponseData>
export async function searchSite(
  queryOrOptions: string | SearchSiteOptions,
  type?: SearchResultType,
  signal?: AbortSignal,
): Promise<SearchResponseData> {
  const options = normalizeOptions(queryOrOptions, type, signal)
  const requestUrl = new URL('/api/search', window.location.origin)
  requestUrl.searchParams.set('q', options.query.trim())
  requestUrl.searchParams.set('type', options.type)

  const filterValue = buildFilterValue(options.filters ?? {
    hashtag: null,
    mediaKind: null,
  })
  if (filterValue) {
    requestUrl.searchParams.set('filter', filterValue)
  }

  const response = await fetch(requestUrl.pathname + requestUrl.search, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload:
    | SearchEnvelope
    | { data: LegacySearchApiResponse | null; errors: ApiError[] }
    | null = null

  try {
    payload = (await response.json()) as
      | SearchEnvelope
      | { data: LegacySearchApiResponse | null; errors: ApiError[] }
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Search lookup failed with status ${response.status}.`,
    )
  }

  const normalizedPayload = normalizeLegacyPayload(payload, options)
  if (!normalizedPayload) {
    throw new Error('Search response did not contain a payload.')
  }

  return normalizedPayload
}
