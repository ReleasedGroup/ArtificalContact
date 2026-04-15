param location string
param names object
param tags object = {}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: names.cosmosAccount
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    databaseAccountOfferType: 'Standard'
    disableKeyBasedMetadataWriteAccess: true
    enableAutomaticFailover: false
    enableFreeTier: false
    locations: [
      {
        failoverPriority: 0
        isZoneRedundant: false
        locationName: location
      }
    ]
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: names.cosmosDatabase
  properties: {
    resource: {
      id: names.cosmosDatabase
    }
  }
}

resource usersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.usersContainer
  properties: {
    resource: {
      id: names.usersContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/id'
        ]
        version: 2
      }
    }
    options: {
      // Cosmos autoscale is expressed as the max RU/s ceiling for the container.
      autoscaleSettings: {
        maxThroughput: 4000
      }
    }
  }
}

output accountName string = cosmosAccount.name
output databaseName string = sqlDatabase.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output usersContainerName string = usersContainer.name
