param location string
param names object
param tags object = {}
param applicationInsightsConnectionString string
param cosmosAccountName string
param cosmosDatabaseName string
param cosmosEndpoint string
param keyVaultResourceId string
param mediaBaseUrl string
@minValue(0)
@maxValue(7)
param contentSafetyThreshold int = 4
param storageAccountName string
param storageAccountResourceId string
param deploymentContainerName string
param searchEndpoint string
param searchPostsIndexName string
param searchUsersIndexName string
param searchResourceId string

var storageBlobDataOwnerRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
)
var storageQueueDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
)
var storageAccountContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '17d1049b-9a84-46fb-8f53-869881c3d3ab'
)
var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var searchIndexDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7ca7617b-dad8-4a2f-bb0a-67fef9d4f7f0'
)
var blobServiceUri = 'https://${storageAccountName}.blob.${environment().suffixes.storage}'
var deploymentContainerUri = '${blobServiceUri}/${deploymentContainerName}'
var queueServiceUri = 'https://${storageAccountName}.queue.${environment().suffixes.storage}'
var tableServiceUri = 'https://${storageAccountName}.table.${environment().suffixes.storage}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: last(split(keyVaultResourceId, '/'))
}

resource searchService 'Microsoft.Search/searchServices@2023-11-01' existing = {
  id: searchResourceId
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: names.functionPlan
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  tags: tags
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: names.functionApp
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    httpsOnly: true
    serverFarmId: functionPlan.id
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: deploymentContainerUri
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      runtime: {
        name: 'node'
        version: '20'
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 2048
        maximumInstanceCount: 40
      }
    }
    siteConfig: {
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsightsConnectionString
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: blobServiceUri
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: queueServiceUri
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: tableServiceUri
        }
        {
          name: 'COSMOS_DATABASE_NAME'
          value: cosmosDatabaseName
        }
        {
          name: 'COSMOS_CONNECTION__accountEndpoint'
          value: cosmosEndpoint
        }
        {
          name: 'COSMOS_CONNECTION__credential'
          value: 'managedidentity'
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosEndpoint
        }
        {
          name: 'MEDIA_BASE_URL'
          value: mediaBaseUrl
        }
        {
          name: 'MEDIA_CONTAINER_NAME'
          value: names.mediaContainer
        }
        {
          name: 'CONTENT_SAFETY_THRESHOLD'
          value: string(contentSafetyThreshold)
        }
        {
          name: 'SEARCH_ENDPOINT'
          value: searchEndpoint
        }
        {
          name: 'SEARCH_INDEX_POSTS_NAME'
          value: searchPostsIndexName
        }
        {
          name: 'SEARCH_INDEX_USERS_NAME'
          value: searchUsersIndexName
        }
        {
          name: 'AZURE_REGION'
          value: location
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'WEBSITE_CLOUD_ROLENAME'
          value: names.functionApp
        }
      ]
    }
  }
}

resource cosmosDataContributorRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccount.id, functionApp.name, 'cosmos-data-contributor')
  parent: cosmosAccount
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmosAccount.id
  }
}

resource storageBlobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountResourceId, functionApp.name, 'blob-owner')
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataOwnerRoleDefinitionId
  }
}

resource storageQueueRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountResourceId, functionApp.name, 'queue-contributor')
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
  }
}

resource storageAccountRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountResourceId, functionApp.name, 'storage-account-contributor')
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageAccountContributorRoleDefinitionId
  }
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultResourceId, functionApp.name, 'kv-secrets-user')
  scope: keyVault
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
  }
}

resource searchIndexDataContributorRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchResourceId, functionApp.name, 'search-index-data-contributor')
  scope: searchService
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: searchIndexDataContributorRoleDefinitionId
  }
}

output functionAppName string = functionApp.name
output functionAppResourceId string = functionApp.id
