param appName string
param environmentName string

var environmentSlug = toLower(replace(environmentName, '_', '-'))
var hyphenBase = '${toLower(appName)}-${environmentSlug}'

output names object = {
  cosmosAccount: take('${hyphenBase}-cosmos', 44)
  cosmosDatabase: 'acn'
  usersContainer: 'users'
}
