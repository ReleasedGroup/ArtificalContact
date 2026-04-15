targetScope = 'resourceGroup'

param appName string = 'acn'
param environmentName string = 'dev'
param location string = resourceGroup().location

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

module cosmos './modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    names: naming.outputs.names
    tags: tags
  }
}

output cosmosAccountName string = cosmos.outputs.accountName
output cosmosDatabaseName string = cosmos.outputs.databaseName
output cosmosEndpoint string = cosmos.outputs.endpoint
output usersContainerName string = cosmos.outputs.usersContainerName
