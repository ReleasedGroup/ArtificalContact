param names object
param tags object = {}
param storageHostName string
param customDomainHostName string

var normalizedCustomDomainHostName = toLower(customDomainHostName)
var shouldCreateCustomDomain = !empty(normalizedCustomDomainHostName) && !contains(normalizedCustomDomainHostName, 'placeholder') && !endsWith(normalizedCustomDomainHostName, '.example.com')
var customDomainResourceName = take(replace(normalizedCustomDomainHostName, '.', '-'), 90)

resource frontDoorProfile 'Microsoft.Cdn/profiles@2020-09-01' = {
  name: names.frontDoorProfile
  location: 'global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  tags: tags
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2020-09-01' = {
  parent: frontDoorProfile
  name: names.frontDoorEndpoint
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2020-09-01' = {
  parent: frontDoorProfile
  name: names.frontDoorOriginGroup
  properties: {
    healthProbeSettings: {
      probeIntervalInSeconds: 120
      probePath: '/'
      probeProtocol: 'Https'
      probeRequestType: 'HEAD'
    }
    loadBalancingSettings: {
      additionalLatencyInMilliseconds: 0
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    sessionAffinityState: 'Disabled'
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2020-09-01' = {
  parent: originGroup
  name: names.frontDoorOrigin
  properties: {
    enabledState: 'Enabled'
    hostName: storageHostName
    httpPort: 80
    httpsPort: 443
    originHostHeader: storageHostName
    priority: 1
    weight: 1000
  }
}

resource customDomain 'Microsoft.Cdn/profiles/customDomains@2020-09-01' = if (shouldCreateCustomDomain) {
  parent: frontDoorProfile
  name: customDomainResourceName
  properties: {
    hostName: normalizedCustomDomainHostName
    tlsSettings: {
      certificateType: 'ManagedCertificate'
      minimumTlsVersion: 'TLS12'
    }
  }
}

resource cacheRuleSet 'Microsoft.Cdn/profiles/ruleSets@2020-09-01' = {
  parent: frontDoorProfile
  name: 'storagecacherules'
}

resource immutableAssetsCacheRule 'Microsoft.Cdn/profiles/ruleSets/rules@2020-09-01' = {
  parent: cacheRuleSet
  name: 'immutableassets'
  properties: {
    order: 1
    matchProcessingBehavior: 'Stop'
    conditions: [
      {
        name: 'UrlPath'
        parameters: {
          '@odata.type': '#Microsoft.Azure.Cdn.Models.DeliveryRuleUrlPathMatchConditionParameters'
          operator: 'BeginsWith'
          negateCondition: false
          matchValues: [
            '/images/'
            '/video/'
            '/audio/'
            '/gif/'
          ]
          transforms: [
            'Lowercase'
          ]
        }
      }
    ]
    actions: [
      {
        name: 'CacheExpiration'
        parameters: {
          '@odata.type': '#Microsoft.Azure.Cdn.Models.DeliveryRuleCacheExpirationActionParameters'
          cacheBehavior: 'Override'
          cacheDuration: '7.00:00:00'
          cacheType: 'All'
        }
      }
    ]
  }
}

resource mutableAssetsCacheRule 'Microsoft.Cdn/profiles/ruleSets/rules@2020-09-01' = {
  parent: cacheRuleSet
  name: 'mutableassets'
  properties: {
    order: 2
    matchProcessingBehavior: 'Stop'
    conditions: [
      {
        name: 'UrlPath'
        parameters: {
          '@odata.type': '#Microsoft.Azure.Cdn.Models.DeliveryRuleUrlPathMatchConditionParameters'
          operator: 'BeginsWith'
          negateCondition: false
          matchValues: [
            '/avatars/'
          ]
          transforms: [
            'Lowercase'
          ]
        }
      }
    ]
    actions: [
      {
        name: 'CacheExpiration'
        parameters: {
          '@odata.type': '#Microsoft.Azure.Cdn.Models.DeliveryRuleCacheExpirationActionParameters'
          cacheBehavior: 'Override'
          cacheDuration: '00:05:00'
          cacheType: 'All'
        }
      }
    ]
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2020-09-01' = {
  parent: frontDoorEndpoint
  name: 'storage-route'
  dependsOn: [
    origin
  ]
  properties: {
    customDomains: shouldCreateCustomDomain ? [
      {
        id: customDomain.id
      }
    ] : []
    enabledState: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
    originGroup: {
      id: originGroup.id
    }
    patternsToMatch: [
      '/*'
    ]
    ruleSets: [
      {
        id: cacheRuleSet.id
      }
    ]
    supportedProtocols: [
      'Http'
      'Https'
    ]
  }
}

output customDomainHostName string = customDomainHostName
output customDomainValidationDnsTxtRecordName string = shouldCreateCustomDomain ? '_dnsauth.${customDomain!.properties.hostName}' : ''
output customDomainValidationDnsTxtRecordValue string = shouldCreateCustomDomain ? customDomain!.properties.validationProperties.validationToken : ''
output customDomainValidationExpiry string = shouldCreateCustomDomain ? customDomain!.properties.validationProperties.expirationDate : ''
output endpointHostName string = frontDoorEndpoint.properties.hostName
