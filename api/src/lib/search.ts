import { DefaultAzureCredential } from '@azure/identity'
import { SearchClient } from '@azure/search-documents'
import { getEnvironmentConfig } from './config.js'
import { readOptionalValue } from './strings.js'

const POSTS_SEARCH_FILTER = "visibility eq 'public' and moderationState eq 'ok'"
const UNSUPPORTED_FILTER_CHARACTER_PATTERN = /[();\r\n]/

export type SearchType = 'posts' | 'users' | 'hashtags'

export interface SearchQuery {
  q?: string
  type: SearchType
  filter?: string
}

export interface SearchResponse {
  '@odata.count'?: number
  value: Record<string, unknown>[]
}

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
    },
  ): Promise<SearchResultPage>
}

type SearchClientFactory = (indexName: string) => SearchClientLike

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

function validateSearchFilter(filter: string): string {
  if (UNSUPPORTED_FILTER_CHARACTER_PATTERN.test(filter)) {
    throw new SearchFilterValidationError(
      'The filter query parameter only supports flat expressions without grouping characters.',
    )
  }

  return filter
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
