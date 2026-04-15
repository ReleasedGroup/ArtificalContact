param location string
param names object
param tags object = {}

var usersContainerAutoscaleMaxThroughput = 4000
var postsContainerAutoscaleMaxThroughput = 10000

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

resource usersByHandleContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: 'usersByHandle'
  properties: {
    options: {
      autoscaleSettings: {
        maxThroughput: 1000
      }
    }
    resource: {
      id: 'usersByHandle'
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/handle'
        ]
        version: 2
      }
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
      // Cosmos autoscale uses the max RU/s ceiling only, so 4000 yields an effective 400-4000 RU/s range.
      autoscaleSettings: {
        maxThroughput: usersContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource postsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.postsContainer
  properties: {
    resource: {
      id: names.postsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/threadId'
        ]
        version: 2
      }
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 10000 yields an effective 1000-10000 RU/s range.
      autoscaleSettings: {
        maxThroughput: postsContainerAutoscaleMaxThroughput
      }
    }
  }
}

output accountName string = cosmosAccount.name
output databaseName string = sqlDatabase.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output postsContainerName string = postsContainer.name
output usersContainerName string = usersContainer.name
