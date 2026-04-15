param backendLocation string
param location string
param names object
param tags object = {}
param applicationInsightsConnectionString string
param functionAppName string
param functionAppResourceId string

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: names.staticWebApp
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  tags: tags
  properties: {
    allowConfigFileUpdates: true
    enterpriseGradeCdnStatus: 'Disabled'
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    VITE_APPINSIGHTS_CONNECTION_STRING: applicationInsightsConnectionString
    VITE_APPINSIGHTS_ROLE_NAME: staticWebApp.name
  }
}

resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2024-04-01' = {
  parent: staticWebApp
  name: functionAppName
  properties: {
    backendResourceId: functionAppResourceId
    region: backendLocation
  }
}

output defaultHostname string = staticWebApp.properties.defaultHostname
output location string = staticWebApp.location
output resourceId string = staticWebApp.id
