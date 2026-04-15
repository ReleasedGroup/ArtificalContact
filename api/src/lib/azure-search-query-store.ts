import { DefaultAzureCredential } from '@azure/identity'
import {
  AzureKeyCredential,
  SearchClient,
  type FacetResult,
} from '@azure/search-documents'
import { getEnvironmentConfig } from './config.js'
import { getRequestMetricsEndpoint } from './request-metrics-context.js'
import { readOptionalValue } from './strings.js'
import type {
  SearchFacetValue,
  SearchFilters,
  SearchHashtagResult,
  SearchPostResult,
  SearchStore,
  SearchUserResult,
} from './search.js'
import type {
  SearchPostIndexDocument,
  SearchUserIndexDocument,
} from './search-sync.js'
import { trackSearchQueryDuration } from './telemetry.js'

interface SearchPostQueryDocument extends Partial<SearchPostIndexDocument> {
  id: string
}

interface SearchUserQueryDocument extends Partial<SearchUserIndexDocument> {
  id: string
}

const defaultTop = 20
const defaultFacetCount = 10

function createSearchClient<TDocument extends { id: string }>(
  endpoint: string,
  indexName: string,
) {
  const searchApiKey =
    readOptionalValue(process.env.SEARCH_API_KEY) ??
    readOptionalValue(process.env.SEARCH_QUERY_KEY) ??
    readOptionalValue(process.env.AZURE_AI_SEARCH_API_KEY)

  return new SearchClient<TDocument>(
    endpoint,
    indexName,
    searchApiKey
      ? new AzureKeyCredential(searchApiKey)
      : new DefaultAzureCredential(),
  )
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.trunc(value)
}

function extractUniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const uniqueValues = new Set<string>()
  for (const value of values) {
    const normalizedValue = toNullableString(value)
    if (normalizedValue === null) {
      continue
    }

    uniqueValues.add(normalizedValue)
  }

  return [...uniqueValues]
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

function buildPostFilter(filters: SearchFilters): string {
  const clauses = ["visibility eq 'public'", "moderationState eq 'ok'"]

  if (filters.hashtag) {
    clauses.push(
      `hashtags/any(h: h eq '${escapeODataString(filters.hashtag)}')`,
    )
  }

  if (filters.mediaKind) {
    clauses.push(
      `mediaKinds/any(m: m eq '${escapeODataString(filters.mediaKind)}')`,
    )
  }

  return clauses.join(' and ')
}

function mapFacetValues(
  values: FacetResult[] | undefined,
  maximumCount = defaultFacetCount,
): SearchFacetValue[] {
  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((value) => {
      const label = toNullableString(value.value)
      if (label === null) {
        return null
      }

      return {
        value: label,
        count: toNonNegativeInteger(value.count),
      }
    })
    .filter((value): value is SearchFacetValue => value !== null)
    .slice(0, maximumCount)
}

function createSearchText(query: string): string {
  return query.trim().length > 0 ? query.trim() : '*'
}

async function getFirstPage<TDocument extends object>(
  response: Awaited<ReturnType<SearchClient<TDocument>['search']>>,
): Promise<TDocument[]> {
  const results: TDocument[] = []

  for await (const item of response.results) {
    results.push(item.document)
  }

  return results
}

function mapPostResult(document: SearchPostQueryDocument): SearchPostResult {
  const kind = toNullableString(document.kind)

  return {
    type: 'post',
    id: document.id,
    kind: kind === 'github' ? 'github' : 'user',
    authorHandle: toNullableString(document.authorHandle),
    text: toNullableString(document.text),
    hashtags: extractUniqueStrings(document.hashtags),
    mediaKinds: extractUniqueStrings(document.mediaKinds),
    createdAt: toNullableString(document.createdAt),
    likeCount: toNonNegativeInteger(document.likeCount),
    replyCount: toNonNegativeInteger(document.replyCount),
    githubEventType: toNullableString(document.githubEventType),
    githubRepo: toNullableString(document.githubRepo),
  }
}

function mapUserResult(document: SearchUserQueryDocument): SearchUserResult {
  return {
    type: 'user',
    id: document.id,
    handle: toNullableString(document.handle) ?? '',
    displayName: toNullableString(document.displayName),
    bio: toNullableString(document.bio),
    expertise: extractUniqueStrings(document.expertise),
    followerCount: toNonNegativeInteger(document.followerCount),
  }
}

export class AzureSearchQueryStore implements SearchStore {
  constructor(
    private readonly postsClient: SearchClient<SearchPostQueryDocument>,
    private readonly usersClient: SearchClient<SearchUserQueryDocument>,
  ) {}

  static fromEnvironment(): AzureSearchQueryStore {
    const config = getEnvironmentConfig()
    if (!config.searchEndpoint) {
      throw new Error('SEARCH_ENDPOINT is required to query search results.')
    }

    return new AzureSearchQueryStore(
      createSearchClient<SearchPostQueryDocument>(
        config.searchEndpoint,
        config.searchPostsIndexName,
      ),
      createSearchClient<SearchUserQueryDocument>(
        config.searchEndpoint,
        config.searchUsersIndexName,
      ),
    )
  }

  async searchPosts(input: {
    query: string
    filters: SearchFilters
    limit: number
  }) {
    const startedAt = performance.now()
    const searchResponse = await this.postsClient.search(
      createSearchText(input.query),
      {
        facets: [
          `hashtags,count:${defaultFacetCount}`,
          `mediaKinds,count:${defaultFacetCount}`,
        ],
        filter: buildPostFilter(input.filters),
        includeTotalCount: true,
        searchFields: ['text', 'hashtags', 'authorHandle', 'githubRepo'],
        top: input.limit || defaultTop,
        ...(input.query.trim().length === 0
          ? { orderBy: ['createdAt desc'] }
          : {}),
      },
    )

    const results = (await getFirstPage(searchResponse)).map((item) =>
      mapPostResult(item),
    )

    trackSearchQueryDuration(performance.now() - startedAt, {
      endpoint: getRequestMetricsEndpoint() ?? 'background',
      searchType: 'posts',
    })

    return {
      totalCount:
        typeof searchResponse.count === 'number'
          ? Math.trunc(searchResponse.count)
          : null,
      facets: {
        hashtags: mapFacetValues(searchResponse.facets?.hashtags),
        mediaKinds: mapFacetValues(searchResponse.facets?.mediaKinds),
      },
      results,
    }
  }

  async searchUsers(input: { query: string; limit: number }) {
    const startedAt = performance.now()
    const searchResponse = await this.usersClient.search(
      createSearchText(input.query),
      {
        filter: "status eq 'active'",
        includeTotalCount: true,
        searchFields: ['handle', 'displayName', 'bio', 'expertise'],
        top: input.limit || defaultTop,
        ...(input.query.trim().length === 0
          ? { orderBy: ['followerCount desc'] }
          : {}),
      },
    )

    const results = (await getFirstPage(searchResponse))
      .map((item) => mapUserResult(item))
      .filter((item) => item.handle.length > 0)

    trackSearchQueryDuration(performance.now() - startedAt, {
      endpoint: getRequestMetricsEndpoint() ?? 'background',
      searchType: 'users',
    })

    return {
      totalCount:
        typeof searchResponse.count === 'number'
          ? Math.trunc(searchResponse.count)
          : null,
      results,
    }
  }

  async searchHashtags(input: {
    query: string
    filters: SearchFilters
    limit: number
  }) {
    const startedAt = performance.now()
    const searchResponse = await this.postsClient.search(
      createSearchText(input.query),
      {
        facets: [`hashtags,count:${input.limit || defaultTop},sort:count`],
        filter: buildPostFilter({
          hashtag: null,
          mediaKind: input.filters.mediaKind,
        }),
        includeTotalCount: false,
        searchFields: ['hashtags'],
        top: 1,
      },
    )

    const queryFilter = input.query.trim().toLowerCase()
    const results: SearchHashtagResult[] = mapFacetValues(
      searchResponse.facets?.hashtags,
      input.limit || defaultTop,
    )
      .filter((item) =>
        queryFilter.length === 0
          ? true
          : item.value.toLowerCase().includes(queryFilter),
      )
      .map((item) => ({
        type: 'hashtag',
        hashtag: item.value,
        count: item.count,
      }))

    trackSearchQueryDuration(performance.now() - startedAt, {
      endpoint: getRequestMetricsEndpoint() ?? 'background',
      searchType: 'hashtags',
    })

    return {
      totalCount: results.length,
      results,
    }
  }
}
