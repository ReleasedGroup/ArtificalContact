targetScope = 'resourceGroup'

param appName string = 'acn'
param environmentName string = 'dev'
param location string = resourceGroup().location
@description('Optional override for the Azure Static Web App region. When omitted, the deployment uses the primary location if supported by Static Web Apps, otherwise it falls back to eastasia.')
param staticWebAppLocation string = ''
param frontDoorCustomDomainHostName string = 'cdn-placeholder.example.com'
@minValue(0)
@maxValue(7)
param contentSafetyThreshold int = 4

var supportedStaticWebAppLocations = [
  'centralus'
  'eastasia'
  'eastus2'
  'westeurope'
  'westus2'
]
var normalizedLocation = toLower(replace(location, ' ', ''))
var normalizedStaticWebAppLocation = empty(staticWebAppLocation) ? '' : toLower(replace(staticWebAppLocation, ' ', ''))
var resolvedStaticWebAppLocation = !empty(normalizedStaticWebAppLocation)
  ? normalizedStaticWebAppLocation
  : (contains(supportedStaticWebAppLocations, normalizedLocation) ? normalizedLocation : 'eastasia')

var tags = {
  application: 'ArtificialContact'
  'azd-env-name': environmentName
  environment: environmentName
  managedBy: 'bicep'
  repository: 'ReleasedGroup/ArtificalContact'
}

module naming './modules/naming.bicep' = {
  name: 'naming'
  params: {
    appName: appName
    environmentName: environmentName
  }
}

module observability './modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
  }
}

module cosmos './modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
  }
}

module search './modules/search.bicep' = {
  name: 'search'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
    cosmosAccountName: cosmos.outputs.accountName
    cosmosDatabaseName: cosmos.outputs.databaseName
    cosmosPostsContainerName: cosmos.outputs.postsContainerName
  }
}

module frontDoor './modules/frontdoor.bicep' = {
  name: 'frontDoor'
  params: {
    names: naming.outputs.names
    tags: tags
    storageHostName: storage.outputs.blobHostName
    customDomainHostName: frontDoorCustomDomainHostName
  }
}

module functions './modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    names: naming.outputs.names
    tags: union(tags, {
      'azd-service-name': 'api'
    })
    applicationInsightsConnectionString: observability.outputs.applicationInsightsConnectionString
    cosmosAccountName: cosmos.outputs.accountName
    cosmosDatabaseName: cosmos.outputs.databaseName
    cosmosEndpoint: cosmos.outputs.endpoint
    keyVaultResourceId: observability.outputs.keyVaultId
    contentSafetyThreshold: contentSafetyThreshold
    mediaBaseUrl: 'https://${frontDoor.outputs.endpointHostName}'
    storageAccountName: storage.outputs.accountName
    storageAccountResourceId: storage.outputs.accountResourceId
    deploymentContainerName: storage.outputs.deploymentContainerName
    searchEndpoint: search.outputs.endpoint
    searchPostsIndexName: search.outputs.postsIndexName
    searchUsersIndexName: search.outputs.usersIndexName
    searchResourceId: search.outputs.resourceId
  }
  dependsOn: [
    search
  ]
}

module staticWebApp './modules/static-web-app.bicep' = {
  name: 'staticWebApp'
  params: {
    backendLocation: location
    location: resolvedStaticWebAppLocation
    names: naming.outputs.names
    tags: union(tags, {
      'azd-service-name': 'web'
    })
    applicationInsightsConnectionString: observability.outputs.applicationInsightsConnectionString
    functionAppName: functions.outputs.functionAppName
    functionAppResourceId: functions.outputs.functionAppResourceId
  }
}

output applicationInsightsConnectionString string = observability.outputs.applicationInsightsConnectionString
output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosFeedsContainerName string = cosmos.outputs.feedsContainerName
output cosmosFollowersContainerName string = cosmos.outputs.followersContainerName
output cosmosFollowsContainerName string = cosmos.outputs.followsContainerName
output cosmosMediaContainerName string = cosmos.outputs.mediaContainerName
output cosmosModActionsContainerName string = cosmos.outputs.modActionsContainerName
output cosmosNotificationPrefsContainerName string = cosmos.outputs.notificationPrefsContainerName
output cosmosNotificationsContainerName string = cosmos.outputs.notificationsContainerName
output cosmosPostsContainerName string = cosmos.outputs.postsContainerName
output cosmosReactionsContainerName string = cosmos.outputs.reactionsContainerName
output cosmosReportsContainerName string = cosmos.outputs.reportsContainerName
output cosmosUsersContainerName string = cosmos.outputs.usersContainerName
output frontDoorCustomDomainHostName string = frontDoor.outputs.customDomainHostName
output frontDoorCustomDomainValidationDnsTxtRecordName string = frontDoor.outputs.customDomainValidationDnsTxtRecordName
output frontDoorCustomDomainValidationDnsTxtRecordValue string = frontDoor.outputs.customDomainValidationDnsTxtRecordValue
output frontDoorCustomDomainValidationExpiry string = frontDoor.outputs.customDomainValidationExpiry
output frontDoorHostName string = frontDoor.outputs.endpointHostName
output functionAppName string = functions.outputs.functionAppName
output keyVaultUri string = observability.outputs.keyVaultUri
output staticWebAppLocation string = staticWebApp.outputs.location
output staticWebAppUrl string = 'https://${staticWebApp.outputs.defaultHostname}'
