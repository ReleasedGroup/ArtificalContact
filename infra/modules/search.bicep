param location string
param names object
param tags object = {}

var postsV1IndexName = 'posts-v1'
var hashtagsV1IndexName = 'hashtags-v1'
var usersV1IndexName = 'users-v1'

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

// Azure AI Search schema objects are data-plane resources. Provision them after
// the service exists via the azd postprovision hook rather than ARM child resources.

output endpoint string = 'https://${searchService.name}.search.windows.net'
output resourceId string = searchService.id
output postsIndexName string = postsV1IndexName
output usersIndexName string = usersV1IndexName
output hashtagsIndexName string = hashtagsV1IndexName
