param location string
param names object
param tags object = {}

var feedsContainerAutoscaleMaxThroughput = 10000
var followersContainerAutoscaleMaxThroughput = 4000
var followsContainerAutoscaleMaxThroughput = 4000
var notificationsContainerAutoscaleMaxThroughput = 4000
var postsContainerAutoscaleMaxThroughput = 10000
var reactionsContainerAutoscaleMaxThroughput = 4000
var usersContainerAutoscaleMaxThroughput = 4000
var mediaContainerThroughput = 400
var modActionsContainerThroughput = 400
var notificationPrefsContainerThroughput = 400
var sqlDatabaseSharedThroughput = 400
var reportsContainerThroughput = 400

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
    options: {
      throughput: sqlDatabaseSharedThroughput
    }
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

resource followsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.followsContainer
  properties: {
    resource: {
      id: names.followsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/followerId'
        ]
        version: 2
      }
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 4000 yields an effective 400-4000 RU/s range.
      autoscaleSettings: {
        maxThroughput: followsContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource followersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.followersContainer
  properties: {
    resource: {
      id: names.followersContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/followedId'
        ]
        version: 2
      }
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 4000 yields an effective 400-4000 RU/s range.
      autoscaleSettings: {
        maxThroughput: followersContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource feedsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.feedsContainer
  properties: {
    resource: {
      id: names.feedsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/feedOwnerId'
        ]
        version: 2
      }
      defaultTtl: 2592000
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 10000 yields an effective 1000-10000 RU/s range.
      autoscaleSettings: {
        maxThroughput: feedsContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource reactionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.reactionsContainer
  properties: {
    resource: {
      id: names.reactionsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/postId'
        ]
        version: 2
      }
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 4000 yields an effective 400-4000 RU/s range.
      autoscaleSettings: {
        maxThroughput: reactionsContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource notificationsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.notificationsContainer
  properties: {
    resource: {
      id: names.notificationsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/targetUserId'
        ]
        version: 2
      }
      defaultTtl: 7776000
    }
    options: {
      // Cosmos autoscale uses the max RU/s ceiling only, so 4000 yields an effective 400-4000 RU/s range.
      autoscaleSettings: {
        maxThroughput: notificationsContainerAutoscaleMaxThroughput
      }
    }
  }
}

resource mediaContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.mediaContainer
  properties: {
    options: {
      throughput: mediaContainerThroughput
    }
    resource: {
      id: names.mediaContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/ownerId'
        ]
        version: 2
      }
    }
  }
}

resource reportsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.reportsContainer
  properties: {
    options: {
      throughput: reportsContainerThroughput
    }
    resource: {
      id: names.reportsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/status'
        ]
        version: 2
      }
    }
  }
}

resource modActionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.modActionsContainer
  properties: {
    options: {
      throughput: modActionsContainerThroughput
    }
    resource: {
      id: names.modActionsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/targetType'
        ]
        version: 2
      }
    }
  }
}

resource notificationPrefsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.notificationPrefsContainer
  properties: {
    options: {
      throughput: notificationPrefsContainerThroughput
    }
    resource: {
      id: names.notificationPrefsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/userId'
        ]
        version: 2
      }
    }
  }
}

resource rateLimitsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.rateLimitsContainer
  properties: {
    resource: {
      id: names.rateLimitsContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/userId'
        ]
        version: 2
      }
      // Enable per-document TTL so token bucket windows can expire automatically.
      defaultTtl: -1
    }
  }
}

resource githubReposContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: sqlDatabase
  name: names.githubReposContainer
  properties: {
    resource: {
      id: names.githubReposContainer
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/id'
        ]
        version: 2
      }
    }
  }
}

output accountName string = cosmosAccount.name
output databaseName string = sqlDatabase.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output feedsContainerName string = feedsContainer.name
output followersContainerName string = followersContainer.name
output followsContainerName string = followsContainer.name
output githubReposContainerName string = githubReposContainer.name
output mediaContainerName string = mediaContainer.name
output modActionsContainerName string = modActionsContainer.name
output notificationPrefsContainerName string = notificationPrefsContainer.name
output notificationsContainerName string = notificationsContainer.name
output postsContainerName string = postsContainer.name
output rateLimitsContainerName string = rateLimitsContainer.name
output reactionsContainerName string = reactionsContainer.name
output reportsContainerName string = reportsContainer.name
output usersContainerName string = usersContainer.name
