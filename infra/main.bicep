targetScope = 'resourceGroup'

param appName string = 'acn'
param environmentName string = 'dev'
param location string = resourceGroup().location
param frontDoorCustomDomainHostName string = 'cdn-placeholder.example.com'

var tags = {
  application: 'ArtificialContact'
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
  }
}

module functions './modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
    applicationInsightsConnectionString: observability.outputs.applicationInsightsConnectionString
    cosmosDatabaseName: cosmos.outputs.databaseName
    cosmosEndpoint: cosmos.outputs.endpoint
    keyVaultResourceId: observability.outputs.keyVaultId
    storageAccountName: storage.outputs.accountName
    storageAccountResourceId: storage.outputs.accountResourceId
    deploymentContainerName: storage.outputs.deploymentContainerName
  }
}

module staticWebApp './modules/static-web-app.bicep' = {
  name: 'staticWebApp'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
    applicationInsightsConnectionString: observability.outputs.applicationInsightsConnectionString
    functionAppName: functions.outputs.functionAppName
    functionAppResourceId: functions.outputs.functionAppResourceId
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

output applicationInsightsConnectionString string = observability.outputs.applicationInsightsConnectionString
output cosmosEndpoint string = cosmos.outputs.endpoint
output frontDoorCustomDomainHostName string = frontDoor.outputs.customDomainHostName
output frontDoorHostName string = frontDoor.outputs.endpointHostName
output functionAppName string = functions.outputs.functionAppName
output keyVaultUri string = observability.outputs.keyVaultUri
output staticWebAppUrl string = 'https://${staticWebApp.outputs.defaultHostname}'
