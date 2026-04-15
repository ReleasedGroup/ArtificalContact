import { DefaultAzureCredential } from '@azure/identity'
import { SearchClient } from '@azure/search-documents'
import { getEnvironmentConfig } from './config.js'
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

export class AzureSearchStore implements SearchSyncStore {
  constructor(
    private readonly postsClient: SearchClient<SearchPostIndexDocument>,
    private readonly usersClient: SearchClient<SearchUserIndexDocument>,
  ) {}

  static fromEnvironment(): AzureSearchStore {
    const config = getEnvironmentConfig()
    if (!config.searchEndpoint) {
      throw new Error('SEARCH_ENDPOINT is required to sync posts and users.')
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
}
