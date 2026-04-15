param location string
param names object
param tags object = {}

var postsV1IndexName = '${names.search}-posts-v1'

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

resource postsV1Index 'Microsoft.Search/searchServices/indexes@2024-07-01' = {
  name: postsV1IndexName
  parent: searchService
  properties: {
    fields: [
      {
        name: 'id'
        type: 'Edm.String'
        key: true
        filterable: false
        searchable: false
        sortable: false
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
        type: 'Edm.String'
        searchable: true
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
        collection: true
      }
      {
        name: 'mediaKinds'
        type: 'Edm.String'
        searchable: false
        filterable: true
        sortable: false
        facetable: true
        retrievable: true
        collection: true
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
  }
}

output endpoint string = 'https://${searchService.name}.search.windows.net'
output resourceId string = searchService.id
