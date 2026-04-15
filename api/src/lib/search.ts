import { DefaultAzureCredential } from '@azure/identity'
import { SearchClient } from '@azure/search-documents'
import { getEnvironmentConfig } from './config.js'
import { readOptionalValue } from './strings.js'
import type { ApiEnvelope, ApiError } from './api-envelope.js'

const POSTS_SEARCH_FILTER = "visibility eq 'public' and moderationState eq 'ok'"
const UNSUPPORTED_FILTER_CHARACTER_PATTERN = /[();\r\n]/

export type SearchType = 'posts' | 'users' | 'hashtags'
export type SearchResultType = SearchType

export interface SearchQuery {
  q?: string
  type: SearchType
  filter?: string
  orderBy?: string[]
  scoringProfile?: string
  top?: number
}

export interface SearchResponse {
  '@odata.count'?: number
  value: Record<string, unknown>[]
}

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

interface SearchResultDocument {
  document: Record<string, unknown>
}

interface SearchResultPage {
  count?: number
  results: AsyncIterable<SearchResultDocument>
}

interface SearchClientLike {
  search(
    searchText: string,
    options: {
      filter?: string
      includeTotalCount: boolean
      orderBy?: string[]
      scoringProfile?: string
      top?: number
    },
  ): Promise<SearchResultPage>
}

interface SearchPostsLookup {
  totalCount: number | null
  facets: SearchPostsData['facets']
  results: SearchPostResult[]
}

interface SearchUsersLookup {
  totalCount: number | null
  results: SearchUserResult[]
}

interface SearchHashtagsLookup {
  totalCount: number | null
  results: SearchHashtagResult[]
}

export interface SearchStore {
  searchPosts(input: {
    query: string
    filters: SearchFilters
    limit: number
  }): Promise<SearchPostsLookup>
  searchUsers(input: {
    query: string
    limit: number
  }): Promise<SearchUsersLookup>
  searchHashtags(input: {
    query: string
    filters: SearchFilters
    limit: number
  }): Promise<SearchHashtagsLookup>
}

export interface SearchRequestInput {
  q?: string | null
  type?: string | null
  filter?: string | null
}

export interface SearchLookupResult {
  status: 200 | 400
  body: ApiEnvelope<SearchResponseData | null>
}

type SearchClientFactory = (indexName: string) => SearchClientLike

const defaultSearchLimit = 20
const validSearchTypes = new Set<SearchResultType>([
  'posts',
  'users',
  'hashtags',
])
const hashtagValuePattern = /^[a-z0-9_]{1,64}$/i
const mediaKindValuePattern = /^[a-z0-9_-]{1,32}$/i

function createSearchClient(indexName: string): SearchClientLike {
  const config = getEnvironmentConfig()
  const endpoint = readOptionalValue(config.searchEndpoint)

  if (!endpoint) {
    throw new SearchConfigurationError(
      'Search endpoint must be configured to query AI Search.',
    )
  }

  return new SearchClient<Record<string, unknown>>(
    endpoint,
    indexName,
    new DefaultAzureCredential(),
  )
}

function createValidationError(
  code: string,
  message: string,
  field: string,
): ApiError {
  return {
    code,
    message,
    field,
  }
}

function createErrorResult(error: ApiError): SearchLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [error],
    },
  }
}

function normalizeQuery(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSearchType(
  value: string | null | undefined,
): SearchResultType | null {
  const normalizedValue =
    typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (normalizedValue.length === 0) {
    return 'posts'
  }

  return validSearchTypes.has(normalizedValue as SearchResultType)
    ? (normalizedValue as SearchResultType)
    : null
}

function normalizeHashtagValue(value: string): string | null {
  const normalizedValue = value.trim().replace(/^#/, '').toLowerCase()
  return hashtagValuePattern.test(normalizedValue) ? normalizedValue : null
}

function normalizeMediaKindValue(value: string): string | null {
  const normalizedValue = value.trim().toLowerCase()
  return mediaKindValuePattern.test(normalizedValue) ? normalizedValue : null
}

function validateSearchFilter(filter: string): string {
  if (UNSUPPORTED_FILTER_CHARACTER_PATTERN.test(filter)) {
    throw new SearchFilterValidationError(
      'The filter query parameter only supports flat expressions without grouping characters.',
    )
  }

  return filter
}

function parseFilterValue(
  value: string | null | undefined,
): SearchFilters | ApiError {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      hashtag: null,
      mediaKind: null,
    }
  }

  const filters: SearchFilters = {
    hashtag: null,
    mediaKind: null,
  }

  for (const token of value.split(',')) {
    const normalizedToken = token.trim()
    if (normalizedToken.length === 0) {
      continue
    }

    const separatorIndex = normalizedToken.indexOf(':')
    if (separatorIndex <= 0 || separatorIndex === normalizedToken.length - 1) {
      return createValidationError(
        'invalid_search_filter',
        'The search filter query parameter is malformed.',
        'filter',
      )
    }

    const key = normalizedToken.slice(0, separatorIndex).trim().toLowerCase()
    const rawValue = normalizedToken.slice(separatorIndex + 1)

    if (key === 'hashtag') {
      const hashtag = normalizeHashtagValue(rawValue)
      if (hashtag === null) {
        return createValidationError(
          'invalid_search_filter',
          'The hashtag facet filter must contain only letters, numbers, or underscores.',
          'filter',
        )
      }

      filters.hashtag = hashtag
      continue
    }

    if (key === 'mediakind') {
      const mediaKind = normalizeMediaKindValue(rawValue)
      if (mediaKind === null) {
        return createValidationError(
          'invalid_search_filter',
          'The media kind facet filter is not valid.',
          'filter',
        )
      }

      filters.mediaKind = mediaKind
      continue
    }

    return createValidationError(
      'invalid_search_filter',
      `Unsupported search filter "${key}".`,
      'filter',
    )
  }

  return filters
}

export function resolveSearchIndex(type: SearchType): string {
  const config = getEnvironmentConfig()

  switch (type) {
    case 'users':
      return config.searchUsersIndexName
    case 'hashtags':
      return config.searchHashtagsIndexName
    case 'posts':
    default:
      return config.searchPostsIndexName
  }
}

export function resolveDefaultSearchFilter(
  type: SearchType,
  filter?: string,
): string | undefined {
  const normalizedFilter = readOptionalValue(filter)
  const validatedFilter =
    normalizedFilter === undefined
      ? undefined
      : validateSearchFilter(normalizedFilter)

  if (type !== 'posts') {
    return validatedFilter
  }

  if (validatedFilter === undefined) {
    return POSTS_SEARCH_FILTER
  }

  return `${POSTS_SEARCH_FILTER} and (${validatedFilter})`
}

export class SearchConfigurationError extends Error {}

export class SearchFilterValidationError extends Error {}

export class SearchUpstreamError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function querySearchIndex(
  query: SearchQuery,
  clientFactory: SearchClientFactory = createSearchClient,
): Promise<SearchResponse> {
  const indexName = resolveSearchIndex(query.type)
  const client = clientFactory(indexName)
  const searchText = readOptionalValue(query.q) ?? '*'
  const filter = readOptionalValue(query.filter)

  try {
    const searchResults = await client.search(searchText, {
      ...(filter === undefined ? {} : { filter }),
      includeTotalCount: true,
      ...(query.orderBy === undefined ? {} : { orderBy: query.orderBy }),
      ...(query.scoringProfile === undefined
        ? {}
        : { scoringProfile: query.scoringProfile }),
      ...(query.top === undefined ? {} : { top: query.top }),
    })

    const value: Record<string, unknown>[] = []
    for await (const result of searchResults.results) {
      value.push(result.document)
    }

    return {
      ...(searchResults.count === undefined
        ? {}
        : { '@odata.count': searchResults.count }),
      value,
    }
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 502

    console.error('Search index query failed.', {
      indexName,
      status,
      error: error instanceof Error ? error.message : 'Unknown search error.',
    })

    throw new SearchUpstreamError(
      `Search index query failed with status ${status}.`,
      status,
    )
  }
}

export async function searchSite(
  input: SearchRequestInput,
  store: SearchStore,
): Promise<SearchLookupResult> {
  const type = normalizeSearchType(input.type)
  if (type === null) {
    return createErrorResult(
      createValidationError(
        'invalid_search_type',
        'The search type must be posts, users, or hashtags.',
        'type',
      ),
    )
  }

  const filters = parseFilterValue(input.filter)
  if ('code' in filters) {
    return createErrorResult(filters)
  }

  const query = normalizeQuery(input.q)

  if (type === 'posts') {
    const result = await store.searchPosts({
      query,
      filters,
      limit: defaultSearchLimit,
    })

    return {
      status: 200,
      body: {
        data: {
          type,
          query,
          filters,
          totalCount: result.totalCount,
          facets: result.facets,
          results: result.results,
        },
        errors: [],
      },
    }
  }

  if (type === 'users') {
    const result = await store.searchUsers({
      query,
      limit: defaultSearchLimit,
    })

    return {
      status: 200,
      body: {
        data: {
          type,
          query,
          filters,
          totalCount: result.totalCount,
          results: result.results,
        },
        errors: [],
      },
    }
  }

  const result = await store.searchHashtags({
    query,
    filters,
    limit: defaultSearchLimit,
  })

  return {
    status: 200,
    body: {
      data: {
        type,
        query,
        filters,
        totalCount: result.totalCount,
        results: result.results,
      },
      errors: [],
    },
  }
}
