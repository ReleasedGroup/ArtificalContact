param appName string
param environmentName string

var environmentSlug = toLower(replace(environmentName, '_', '-'))
var uniqueSuffix = take(uniqueString(resourceGroup().id, environmentSlug, appName), 6)
var hyphenBase = '${toLower(appName)}-${environmentSlug}'
var compactBase = toLower(replace('${appName}${environmentSlug}', '-', ''))
var compactWithSuffix = '${compactBase}${uniqueSuffix}'

output names object = {
  applicationInsights: take('${hyphenBase}-appi', 260)
  cosmosAccount: take('${hyphenBase}-cosmos', 44)
  cosmosDatabase: 'acn'
  feedsContainer: 'feeds'
  followersContainer: 'followers'
  followsContainer: 'follows'
  mediaContainer: 'media'
  notificationPrefsContainer: 'notificationPrefs'
  notificationsContainer: 'notifications'
  postsContainer: 'posts'
  reactionsContainer: 'reactions'
  usersContainer: 'users'
  deploymentContainer: take('${hyphenBase}-packages', 63)
  frontDoorEndpoint: take('${hyphenBase}-edge', 50)
  frontDoorOrigin: 'storage-origin'
  frontDoorOriginGroup: 'storage-origin-group'
  frontDoorProfile: take('${hyphenBase}-afd', 90)
  functionApp: take('${hyphenBase}-api', 60)
  functionPlan: take('${hyphenBase}-plan', 40)
  keyVault: take('${compactWithSuffix}kv', 24)
  logAnalytics: take('${hyphenBase}-law', 63)
  search: take('${hyphenBase}-srch', 60)
  staticWebApp: take('${hyphenBase}-web', 40)
  storage: take('${compactWithSuffix}st', 24)
}
