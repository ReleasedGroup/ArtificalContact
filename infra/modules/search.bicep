param location string
param names object
param tags object = {}

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

output endpoint string = 'https://${searchService.name}.search.windows.net'
output resourceId string = searchService.id
