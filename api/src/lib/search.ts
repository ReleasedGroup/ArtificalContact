export type SearchType = 'all' | 'posts' | 'users'

export interface SearchQueryInput {
  query: string
  limit: number
}

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

export interface SearchQueryStore {
  searchPosts(input: SearchQueryInput): Promise<SearchPostResult[]>
  searchUsers(input: SearchQueryInput): Promise<SearchUserResult[]>
}

export const DEFAULT_SEARCH_LIMIT = 4
export const MAX_SEARCH_LIMIT = 8
export const MIN_SEARCH_QUERY_LENGTH = 2

function normalizeSearchToken(value: string): string {
  return value.replace(/^[@#]+/, '').trim()
}

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(normalizeSearchToken)
    .filter((token) => token.length > 0)
    .join(' ')
}

export function createSearchExcerpt(
  value: string,
  maximumLength = 140,
): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maximumLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maximumLength - 3)).trimEnd()}...`
}
