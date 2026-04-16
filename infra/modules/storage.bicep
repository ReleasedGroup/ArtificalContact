param location string
param names object
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.storage
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: tags
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

var blobHostName = '${storageAccount.name}.blob.${environment().suffixes.storage}'

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            '*'
          ]
          allowedMethods: [
            'OPTIONS'
            'PUT'
          ]
          allowedHeaders: [
            '*'
          ]
          exposedHeaders: [
            'etag'
            'x-ms-request-id'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

var containerNames = [
  'images'
  'video'
  'audio'
  'gif'
  'avatars'
  names.deploymentContainer
]

resource blobContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for containerName in containerNames: {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}]

output accountName string = storageAccount.name
output accountResourceId string = storageAccount.id
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output blobHostName string = blobHostName
output deploymentContainerName string = names.deploymentContainer
