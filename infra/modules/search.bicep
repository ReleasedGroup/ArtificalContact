param location string
param names object
param tags object = {}
param cosmosAccountName string
param cosmosDatabaseName string
param cosmosPostsContainerName string

var postsV1IndexName = 'posts-v1'
var usersV1IndexName = 'users-v1'
var postsV1DataSourceName = 'posts-v1-cosmosdb-ds'
var postsV1IndexerName = 'posts-v1-cosmosdb-idx'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: names.search
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'basic'
  }
  tags: tags
  properties: {
    hostingMode: 'default'
    partitionCount: 1
    publicNetworkAccess: 'enabled'
    replicaCount: 1
  }
}

#disable-next-line BCP081
resource postsV1Index 'Microsoft.Search/searchServices/indexes@2024-07-01' = {
  name: postsV1IndexName
  parent: searchService
  properties: {
    defaultScoringProfile: 'recencyAndEngagement'
    fields: [
      {
        name: 'id'
        type: 'Edm.String'
        key: true
        filterable: true
        searchable: false
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'authorId'
        type: 'Edm.String'
        filterable: true
        searchable: false
        sortable: false
        facetable: false
        retrievable: true
      }
      {
        name: 'authorHandle'
        type: 'Edm.String'
        filterable: true
        searchable: true
        sortable: false
        facetable: false
        retrievable: true
        analyzerName: 'keyword'
      }
      {
        name: 'text'
        type: 'Edm.String'
        searchable: true
        filterable: false
        sortable: false
        facetable: false
        retrievable: true
        analyzerName: 'en.lucene'
      }
      {
        name: 'hashtags'
        type: 'Collection(Edm.String)'
        searchable: true
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'mediaKinds'
        type: 'Collection(Edm.String)'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'createdAt'
        type: 'Edm.DateTimeOffset'
        searchable: false
        filterable: true
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'visibility'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: false
        retrievable: true
      }
      {
        name: 'moderationState'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: false
        retrievable: true
      }
      {
        name: 'likeCount'
        type: 'Edm.Int32'
        searchable: false
        filterable: true
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'replyCount'
        type: 'Edm.Int32'
        searchable: false
        filterable: true
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'kind'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'githubEventType'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'githubRepo'
        type: 'Edm.String'
        searchable: true
        filterable: true
        sortable: false
        facetable: false
        retrievable: true
      }
    ]
    scoringProfiles: [
      {
        name: 'recencyAndEngagement'
        functionAggregation: 'sum'
        functions: [
          {
            type: 'freshness'
            boost: 12
            fieldName: 'createdAt'
            freshness: {
              boostingDuration: 'P7D'
              interpolation: 'exponential'
            }
          }
          {
            type: 'magnitude'
            boost: 3
            fieldName: 'likeCount'
            magnitude: {
              boostingRangeStart: 0
              boostingRangeEnd: 250
              interpolation: 'linear'
              constantBoostBeyondRange: true
            }
          }
          {
            type: 'magnitude'
            boost: 2
            fieldName: 'replyCount'
            magnitude: {
              boostingRangeStart: 0
              boostingRangeEnd: 100
              interpolation: 'linear'
              constantBoostBeyondRange: true
            }
          }
        ]
      }
    ]
  }
}

#disable-next-line BCP081
resource usersV1Index 'Microsoft.Search/searchServices/indexes@2024-07-01' = {
  name: usersV1IndexName
  parent: searchService
  properties: {
    fields: [
      {
        name: 'id'
        type: 'Edm.String'
        key: true
        filterable: true
        searchable: false
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'handle'
        type: 'Edm.String'
        searchable: true
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
        analyzerName: 'keyword'
      }
      {
        name: 'handleLower'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'displayName'
        type: 'Edm.String'
        searchable: true
        filterable: false
        sortable: false
        facetable: false
        retrievable: true
        analyzerName: 'en.lucene'
      }
      {
        name: 'bio'
        type: 'Edm.String'
        searchable: true
        filterable: false
        sortable: false
        facetable: false
        retrievable: true
        analyzerName: 'en.lucene'
      }
      {
        name: 'expertise'
        type: 'Collection(Edm.String)'
        searchable: true
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
      {
        name: 'followerCount'
        type: 'Edm.Int32'
        searchable: false
        filterable: true
        sortable: true
        facetable: false
        retrievable: true
      }
      {
        name: 'status'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
      }
    ]
  }
}

resource postsV1DataSource 'Microsoft.Search/searchServices/dataSources@2024-07-01' = {
  name: postsV1DataSourceName
  parent: searchService
  properties: {
    type: 'cosmosdb'
    credentials: {
      connectionString: 'AccountEndpoint=${cosmosAccount.properties.documentEndpoint};AccountKey=${cosmosAccount.listKeys().primaryReadonlyMasterKey};Database=${cosmosDatabaseName}'
    }
    container: {
      name: cosmosPostsContainerName
    }
    dataChangeDetectionPolicy: {
      '@odata.type': '#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy'
      highWaterMarkColumnName: '_ts'
    }
  }
}

resource postsV1Indexer 'Microsoft.Search/searchServices/indexers@2024-07-01' = {
  name: postsV1IndexerName
  parent: searchService
  properties: {
    dataSourceName: postsV1DataSource.name
    targetIndexName: postsV1Index.name
    schedule: {
      interval: 'PT5M'
    }
  }
}

output endpoint string = 'https://${searchService.name}.search.windows.net'
output resourceId string = searchService.id
output postsIndexName string = postsV1IndexName
output usersIndexName string = usersV1IndexName
