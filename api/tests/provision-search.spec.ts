import { describe, expect, it } from 'vitest'
import { buildPostsDataSource } from '../../scripts/provision-search.mjs'

describe('buildPostsDataSource', () => {
  it('uses the Azure Search SDK public discriminator shape for change tracking', () => {
    const dataSource = buildPostsDataSource(
      'https://acn-tempdev2-cosmos.documents.azure.com:443/',
      'readonly-key',
      'acn',
      'posts',
    )

    expect(dataSource).toMatchObject({
      name: 'posts-v1-cosmosdb-ds',
      type: 'cosmosdb',
      connectionString:
        'AccountEndpoint=https://acn-tempdev2-cosmos.documents.azure.com:443/;AccountKey=readonly-key;Database=acn',
      container: {
        name: 'posts',
      },
      dataChangeDetectionPolicy: {
        odatatype:
          '#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy',
        highWaterMarkColumnName: '_ts',
      },
    })
  })
})
