interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

interface SearchApiResponse {
  '@odata.count'?: number
  value: unknown[]
}

export type SearchType = 'posts' | 'users' | 'hashtags'

export interface SearchPostResult {
  id: string
  authorHandle: string
  text: string
  hashtags: string[]
  mediaKinds: string[]
  createdAt: string
  likeCount: number
  replyCount: number
  kind: string
  githubEventType?: string
  githubRepo?: string
}

export interface SearchUserResult {
  id: string
  handle: string
  displayName: string
  bio: string
  expertise: string[]
  followerCount: number
}

export interface SearchHashtagResult {
  value: string
  count: number
}

export interface SearchPostsResponse {
  type: 'posts'
  query: string
  totalCount: number | null
  results: SearchPostResult[]
}

export interface SearchUsersResponse {
  type: 'users'
  query: string
  totalCount: number | null
  results: SearchUserResult[]
}

export interface SearchHashtagsResponse {
  type: 'hashtags'
  query: string
  totalCount: number | null
  results: SearchHashtagResult[]
}

export type SearchResponse =
  | SearchPostsResponse
  | SearchUsersResponse
  | SearchHashtagsResponse

export const MIN_SEARCH_QUERY_LENGTH = 2

function readErrorMessage(
  payload: ApiEnvelope<SearchApiResponse> | null,
): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
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

function mapPostResults(results: unknown[]): SearchPostResult[] {
  return results.flatMap((result) => {
    if (!isRecord(result)) {
      return []
    }

    const id = readString(result.id)
    if (id === null) {
      return []
    }

    const mappedResult: SearchPostResult = {
      id,
      authorHandle: readString(result.authorHandle) ?? 'unknown',
      text: readString(result.text) ?? '',
      hashtags: readStringArray(result.hashtags),
      mediaKinds: readStringArray(result.mediaKinds),
      createdAt: readString(result.createdAt) ?? '',
      likeCount: readNumber(result.likeCount),
      replyCount: readNumber(result.replyCount),
      kind: readString(result.kind) ?? 'user',
    }

    const githubEventType = readString(result.githubEventType)
    if (githubEventType) {
      mappedResult.githubEventType = githubEventType
    }

    const githubRepo = readString(result.githubRepo)
    if (githubRepo) {
      mappedResult.githubRepo = githubRepo
    }

    return [mappedResult]
  })
}

function mapUserResults(results: unknown[]): SearchUserResult[] {
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
        id,
        handle,
        displayName: readString(result.displayName) ?? '',
        bio: readString(result.bio) ?? '',
        expertise: readStringArray(result.expertise),
        followerCount: readNumber(result.followerCount),
      } satisfies SearchUserResult,
    ]
  })
}

function mapHashtagResults(results: unknown[]): SearchHashtagResult[] {
  return results.flatMap((result) => {
    if (!isRecord(result)) {
      return []
    }

    const value = readString(result.id)
    if (value === null) {
      return []
    }

    return [
      {
        value,
        count: readNumber(result.count),
      } satisfies SearchHashtagResult,
    ]
  })
}

export function searchSite(
  query: string,
  type: 'posts',
  signal?: AbortSignal,
): Promise<SearchPostsResponse>
export function searchSite(
  query: string,
  type: 'users',
  signal?: AbortSignal,
): Promise<SearchUsersResponse>
export function searchSite(
  query: string,
  type: 'hashtags',
  signal?: AbortSignal,
): Promise<SearchHashtagsResponse>
export function searchSite(
  query: string,
  type: SearchType,
  signal?: AbortSignal,
): Promise<SearchResponse>
export async function searchSite(
  query: string,
  type: SearchType,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const normalizedQuery = query.trim()
  const requestUrl = new URL('/api/search', window.location.origin)
  requestUrl.searchParams.set('q', normalizedQuery)
  requestUrl.searchParams.set('type', type)

  const response = await fetch(requestUrl.pathname + requestUrl.search, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  let payload: ApiEnvelope<SearchApiResponse> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<SearchApiResponse>
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Search lookup failed with status ${response.status}.`,
    )
  }

  if (!payload?.data || !Array.isArray(payload.data.value)) {
    throw new Error('Search response did not contain the expected payload.')
  }

  const totalCount =
    typeof payload.data['@odata.count'] === 'number'
      ? payload.data['@odata.count']
      : null

  switch (type) {
    case 'users':
      return {
        type,
        query: normalizedQuery,
        totalCount,
        results: mapUserResults(payload.data.value),
      }
    case 'hashtags':
      return {
        type,
        query: normalizedQuery,
        totalCount,
        results: mapHashtagResults(payload.data.value),
      }
    case 'posts':
    default:
      return {
        type: 'posts',
        query: normalizedQuery,
        totalCount,
        results: mapPostResults(payload.data.value),
      }
  }
}
