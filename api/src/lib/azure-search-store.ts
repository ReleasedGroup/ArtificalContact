import { DefaultAzureCredential } from '@azure/identity'
import { SearchClient } from '@azure/search-documents'
import { getEnvironmentConfig } from './config.js'
import {
  createSearchExcerpt,
  normalizeSearchText,
  type SearchPostResult,
  type SearchQueryInput,
  type SearchQueryStore,
  type SearchUserResult,
} from './search.js'
import type {
  SearchPostIndexDocument,
  SearchSyncStore,
  SearchUserIndexDocument,
} from './search-sync.js'

const MAX_BATCH_SIZE = 1000

function createSearchClient<TDocument extends { id: string }>(
  endpoint: string,
  indexName: string,
) {
  return new SearchClient<TDocument>(
    endpoint,
    indexName,
    new DefaultAzureCredential(),
  )
}

export class AzureSearchStore implements SearchSyncStore, SearchQueryStore {
  constructor(
    private readonly postsClient: SearchClient<SearchPostIndexDocument>,
    private readonly usersClient: SearchClient<SearchUserIndexDocument>,
  ) {}

  static fromEnvironment(): AzureSearchStore {
    const config = getEnvironmentConfig()
    if (!config.searchEndpoint) {
      throw new Error('SEARCH_ENDPOINT is required to use Azure AI Search.')
    }

    return new AzureSearchStore(
      createSearchClient<SearchPostIndexDocument>(
        config.searchEndpoint,
        config.searchPostsIndexName,
      ),
      createSearchClient<SearchUserIndexDocument>(
        config.searchEndpoint,
        config.searchUsersIndexName,
      ),
    )
  }

  async upsertPosts(documents: SearchPostIndexDocument[]): Promise<void> {
    await this.upsertDocuments(this.postsClient, documents)
  }

  async deletePosts(ids: string[]): Promise<void> {
    await this.deleteDocuments(this.postsClient, ids)
  }

  async upsertUsers(documents: SearchUserIndexDocument[]): Promise<void> {
    await this.upsertDocuments(this.usersClient, documents)
  }

  async deleteUsers(ids: string[]): Promise<void> {
    await this.deleteDocuments(this.usersClient, ids)
  }

  async searchPosts(input: SearchQueryInput): Promise<SearchPostResult[]> {
    const normalizedQuery = normalizeSearchText(input.query)
    const response = await this.postsClient.search(normalizedQuery, {
      filter: "visibility eq 'public' and moderationState eq 'ok'",
      searchFields: ['text', 'hashtags', 'authorHandle'],
      select: [
        'id',
        'authorHandle',
        'text',
        'createdAt',
        'hashtags',
        'mediaKinds',
        'kind',
        'githubRepo',
      ],
      top: input.limit,
    })

    return this.collectResults(response, (document) => ({
      id: document.id,
      postId: document.id,
      authorHandle: document.authorHandle,
      excerpt: createSearchExcerpt(document.text),
      createdAt: document.createdAt ?? null,
      hashtags: [...document.hashtags],
      mediaKinds: [...document.mediaKinds],
      kind: document.kind,
      ...(document.githubRepo ? { githubRepo: document.githubRepo } : {}),
    }))
  }

  async searchUsers(input: SearchQueryInput): Promise<SearchUserResult[]> {
    const response = await this.usersClient.search(
      buildUserPrefixQuery(input.query),
      {
        filter: "status eq 'active'",
        queryType: 'full',
        searchFields: ['handle', 'displayName', 'bio', 'expertise'],
        searchMode: 'all',
        select: [
          'id',
          'handle',
          'displayName',
          'bio',
          'expertise',
          'followerCount',
        ],
        top: input.limit,
      },
    )

    return this.collectResults(response, (document) => ({
      id: document.id,
      handle: document.handle,
      displayName: document.displayName,
      bio: document.bio,
      expertise: [...document.expertise],
      followerCount: document.followerCount,
    }))
  }

  private async upsertDocuments<TDocument extends { id: string }>(
    client: SearchClient<TDocument>,
    documents: readonly TDocument[],
  ) {
    for (let index = 0; index < documents.length; index += MAX_BATCH_SIZE) {
      const chunk = documents.slice(index, index + MAX_BATCH_SIZE)
      if (chunk.length > 0) {
        await client.uploadDocuments(chunk)
      }
    }
  }

  private async deleteDocuments<TDocument extends { id: string }>(
    client: SearchClient<TDocument>,
    ids: readonly string[],
  ) {
    for (let index = 0; index < ids.length; index += MAX_BATCH_SIZE) {
      const chunk = ids
        .slice(index, index + MAX_BATCH_SIZE)
        .filter((id): id is string => id.trim().length > 0)
        .map((id) => ({ id } as TDocument))

      if (chunk.length > 0) {
        await client.deleteDocuments(chunk)
      }
    }
  }

  private async collectResults<TDocument extends { id: string }, TResult>(
    response: {
      results: AsyncIterable<{
        document: TDocument
      }>
    },
    mapDocument: (document: TDocument) => TResult,
  ): Promise<TResult[]> {
    const results: TResult[] = []

    for await (const item of response.results) {
      results.push(mapDocument(item.document))
    }

    return results
  }
}

const luceneSpecialCharacters = new Set([
  '\\',
  '+',
  '-',
  '!',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '^',
  '"',
  '~',
  '*',
  '?',
  ':',
  '/',
])

function escapeLuceneSearchToken(value: string): string {
  let escapedValue = ''

  for (const character of value) {
    escapedValue += luceneSpecialCharacters.has(character)
      ? `\\${character}`
      : character
  }

  return escapedValue
}

function buildUserPrefixQuery(value: string): string {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `${escapeLuceneSearchToken(token)}*`)
    .join(' ')
}
