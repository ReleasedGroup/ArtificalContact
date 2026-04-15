interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export type SearchType = 'all' | 'posts' | 'users'

export interface SearchPostResult {
  id: string
  postId: string
  authorHandle: string
  excerpt: string
  createdAt: string | null
  hashtags: string[]
  mediaKinds: string[]
  kind: string
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

export interface SearchResponse {
  query: string
  type: SearchType
  posts: SearchPostResult[]
  users: SearchUserResult[]
}

export const MIN_SEARCH_QUERY_LENGTH = 2

function readErrorMessage(payload: ApiEnvelope<unknown> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function search(
  query: string,
  options: {
    limit?: number
    signal?: AbortSignal
    type?: SearchType
  } = {},
): Promise<SearchResponse> {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
    return {
      query: normalizedQuery,
      type: options.type ?? 'all',
      posts: [],
      users: [],
    }
  }

  const searchParams = new URLSearchParams({
    q: normalizedQuery,
  })

  if (options.type && options.type !== 'all') {
    searchParams.set('type', options.type)
  }

  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    searchParams.set('limit', String(Math.trunc(options.limit)))
  }

  const response = await fetch(`/api/search?${searchParams.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload: ApiEnvelope<SearchResponse> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<SearchResponse>
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Search failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('The search response did not contain any results.')
  }

  return payload.data
}
