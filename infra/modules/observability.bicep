param location string
param names object
param tags object = {}
param cosmosAccountName string
@secure()
param pagerDutyIntegrationUrl string = ''
param searchEndpoint string

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.logAnalytics
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: names.applicationInsights
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    Flow_Type: 'Bluefield'
    IngestionMode: 'LogAnalytics'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

var pagerDutyActionGroupName = take('${names.applicationInsights}-pd', 260)
var pagerDutyActionGroupShortName = take(replace('acn-pd-${uniqueString(resourceGroup().id)}', '-', ''), 12)
var hasPagerDutyIntegration = !empty(trim(pagerDutyIntegrationUrl))
var cosmosTargetHost = replace(replace(cosmosAccountName, 'https://', ''), '/', '')
var searchTargetHost = replace(replace(replace(searchEndpoint, 'https://', ''), 'http://', ''), '/', '')
var serverErrorRateQuery = '''
let windowStart = ago(5m);
let totalRequests = toscalar(
    AppRequests
    | where TimeGenerated >= windowStart
    | summarize sum(ItemCount)
);
let serverErrors = toscalar(
    AppRequests
    | where TimeGenerated >= windowStart
    | where toint(ResultCode) >= 500 and toint(ResultCode) < 600
    | summarize sum(ItemCount)
);
print ErrorRate = iff(totalRequests <= 0, 0.0, todouble(serverErrors) / todouble(totalRequests))
| where ErrorRate > 0.01
'''
var cosmosRateLimitQuery = '''
let windowStart = ago(5m);
let cosmosDependencies = AppDependencies
    | where TimeGenerated >= windowStart
    | where Target has '${cosmosTargetHost}' or Data has '${cosmosTargetHost}';
let totalDependencies = toscalar(
    cosmosDependencies
    | summarize sum(ItemCount)
);
let throttledDependencies = toscalar(
    cosmosDependencies
    | where ResultCode == '429'
    | summarize sum(ItemCount)
);
print RateLimitedRatio = iff(totalDependencies <= 0, 0.0, todouble(throttledDependencies) / todouble(totalDependencies))
| where RateLimitedRatio > 0.005
'''
var changeFeedLagQuery = '''
AppMetrics
| where TimeGenerated >= ago(5m)
| where Name == 'search.sync.lag_seconds'
| extend LagSeconds = coalesce(Max, iff(ItemCount <= 0, Sum, Sum / todouble(ItemCount)))
| summarize MaxLagSeconds = max(LagSeconds)
| where MaxLagSeconds > 60
'''
var searchLatencyQuery = '''
AppDependencies
| where TimeGenerated >= ago(5m)
| where Target has '${searchTargetHost}' or Data has '${searchTargetHost}'
| summarize DependencyCount = sum(ItemCount), P95DurationMs = percentile(DurationMs, 95)
| where DependencyCount > 0 and P95DurationMs > 500
'''

resource pagerDutyActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (hasPagerDutyIntegration) {
  name: pagerDutyActionGroupName
  location: 'Global'
  tags: tags
  properties: {
    enabled: true
    groupShortName: pagerDutyActionGroupShortName
    webhookReceivers: [
      {
        name: 'pagerduty'
        serviceUri: pagerDutyIntegrationUrl
        useCommonAlertSchema: true
      }
    ]
  }
}

resource serverErrorRateAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (hasPagerDutyIntegration) {
  name: take('${names.applicationInsights}-5xx-rate', 260)
  location: location
  kind: 'LogAlert'
  tags: tags
  properties: {
    actions: {
      actionGroups: [
        pagerDutyActionGroup.id
      ]
      customProperties: {
        concern: 'api-health'
        issue: '#123'
        threshold: '5xx rate > 1% over 5m'
      }
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          operator: 'GreaterThan'
          query: serverErrorRateQuery
          threshold: 0
          timeAggregation: 'Count'
        }
      ]
    }
    description: 'Triggers when the Application Insights 5xx request rate exceeds 1% over five minutes.'
    displayName: 'Application Insights 5xx rate'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      applicationInsights.id
    ]
    severity: 1
    skipQueryValidation: false
    targetResourceTypes: [
      'microsoft.insights/components'
    ]
    windowSize: 'PT5M'
  }
}

resource cosmosRateLimitAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (hasPagerDutyIntegration) {
  name: take('${names.applicationInsights}-cosmos-429-rate', 260)
  location: location
  kind: 'LogAlert'
  tags: tags
  properties: {
    actions: {
      actionGroups: [
        pagerDutyActionGroup.id
      ]
      customProperties: {
        concern: 'cosmos-health'
        issue: '#123'
        threshold: 'Cosmos 429 rate > 0.5% over 5m'
      }
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          operator: 'GreaterThan'
          query: cosmosRateLimitQuery
          threshold: 0
          timeAggregation: 'Count'
        }
      ]
    }
    description: 'Triggers when Application Insights dependency telemetry shows Cosmos DB 429s above 0.5% over five minutes.'
    displayName: 'Cosmos DB 429 rate'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      applicationInsights.id
    ]
    severity: 2
    skipQueryValidation: false
    targetResourceTypes: [
      'microsoft.insights/components'
    ]
    windowSize: 'PT5M'
  }
}

resource changeFeedLagAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (hasPagerDutyIntegration) {
  name: take('${names.applicationInsights}-change-feed-lag', 260)
  location: location
  kind: 'LogAlert'
  tags: tags
  properties: {
    actions: {
      actionGroups: [
        pagerDutyActionGroup.id
      ]
      customProperties: {
        concern: 'search-health'
        issue: '#123'
        threshold: 'Change feed lag > 60s'
      }
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          operator: 'GreaterThan'
          query: changeFeedLagQuery
          threshold: 0
          timeAggregation: 'Count'
        }
      ]
    }
    description: 'Triggers when the search.sync.lag_seconds custom metric rises above sixty seconds over five minutes.'
    displayName: 'Change feed lag'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      applicationInsights.id
    ]
    severity: 2
    skipQueryValidation: false
    targetResourceTypes: [
      'microsoft.insights/components'
    ]
    windowSize: 'PT5M'
  }
}

resource searchLatencyAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (hasPagerDutyIntegration) {
  name: take('${names.applicationInsights}-search-latency', 260)
  location: location
  kind: 'LogAlert'
  tags: tags
  properties: {
    actions: {
      actionGroups: [
        pagerDutyActionGroup.id
      ]
      customProperties: {
        concern: 'search-health'
        issue: '#123'
        threshold: 'AI Search p95 latency > 500ms over 5m'
      }
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          operator: 'GreaterThan'
          query: searchLatencyQuery
          threshold: 0
          timeAggregation: 'Count'
        }
      ]
    }
    description: 'Triggers when Application Insights dependency telemetry shows Azure AI Search p95 latency above 500 ms over five minutes.'
    displayName: 'AI Search query latency p95'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      applicationInsights.id
    ]
    severity: 2
    skipQueryValidation: false
    targetResourceTypes: [
      'microsoft.insights/components'
    ]
    windowSize: 'PT5M'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.keyVault
  location: location
  tags: tags
  properties: {
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
    softDeleteRetentionInDays: 90
    tenantId: tenant().tenantId
  }
}

output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString
output applicationInsightsId string = applicationInsights.id
output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
output pagerDutyActionGroupId string = hasPagerDutyIntegration ? pagerDutyActionGroup.id : ''
