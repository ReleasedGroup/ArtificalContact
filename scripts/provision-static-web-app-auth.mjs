import { execFileSync } from 'node:child_process'

const CLIENT_ID_SETTING_NAME = 'AZURE_CLIENT_ID'
const CLIENT_SECRET_SETTING_NAME = 'AZURE_CLIENT_SECRET'
const SIGN_IN_AUDIENCE = 'AzureADandPersonalMicrosoftAccount'
const SECRET_LIFETIME_YEARS = '1'
const azCommand = 'az'
const windowsShell = 'pwsh.exe'

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function runAz(args) {
  if (process.platform === 'win32') {
    const commandLine = `& ${azCommand} ${args.map(quotePowerShellArg).join(' ')}`
    return execFileSync(
      windowsShell,
      ['-NoLogo', '-NoProfile', '-Command', commandLine],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim()
  }

  return execFileSync(azCommand, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function parseJson(value, description) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Unable to parse ${description}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function readOptionalEnv(name, fallback) {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function getSingleResourceName(resourceGroup, resourceType) {
  const name = runAz([
    'resource',
    'list',
    '--resource-group',
    resourceGroup,
    '--resource-type',
    resourceType,
    '--query',
    '[0].name',
    '-o',
    'tsv',
  ])

  if (!name) {
    throw new Error(
      `Could not find a ${resourceType} resource in resource group ${resourceGroup}.`,
    )
  }

  return name
}

function getTenantId() {
  const tenantId = runAz(['account', 'show', '--query', 'tenantId', '-o', 'tsv'])

  if (!tenantId) {
    throw new Error('Could not determine the active Entra tenant ID.')
  }

  return tenantId
}

function getStaticWebAppOrigin() {
  const rawUrl = readRequiredEnv('staticWebAppUrl')

  try {
    return new URL(rawUrl).origin
  } catch (error) {
    throw new Error(
      `staticWebAppUrl is not a valid URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function getRedirectUris(staticWebAppOrigin) {
  return [
    staticWebAppOrigin,
    `${staticWebAppOrigin}/.auth/login/aad/callback`,
  ]
}

function getAppDisplayName(environmentName) {
  return `ArtificialContact ${environmentName} Static Web App Entra Auth`
}

function getSecretDisplayName(environmentName) {
  return `artificialcontact-${environmentName}-swa-auth`
}

function findExistingApplication(displayName, staticWebAppOrigin) {
  const apps = parseJson(
    runAz(['ad', 'app', 'list', '--display-name', displayName, '-o', 'json']),
    'application list response',
  )

  if (!Array.isArray(apps) || apps.length === 0) {
    return null
  }

  const callbackUri = `${staticWebAppOrigin}/.auth/login/aad/callback`
  const matchingApps = apps.filter((app) => {
    const redirectUris = Array.isArray(app?.web?.redirectUris)
      ? app.web.redirectUris
      : []

    return (
      app?.web?.homePageUrl === staticWebAppOrigin ||
      redirectUris.includes(callbackUri)
    )
  })

  if (matchingApps.length > 1) {
    throw new Error(
      `Found multiple Entra applications for ${displayName} and ${staticWebAppOrigin}.`,
    )
  }

  if (matchingApps.length === 1) {
    return matchingApps[0]
  }

  if (apps.length > 1) {
    throw new Error(
      `Found multiple Entra applications named ${displayName}. Clean them up or make the naming unique.`,
    )
  }

  return apps[0]
}

function createApplication(displayName, staticWebAppOrigin, redirectUris) {
  return parseJson(
    runAz([
      'ad',
      'app',
      'create',
      '--display-name',
      displayName,
      '--sign-in-audience',
      SIGN_IN_AUDIENCE,
      '--web-home-page-url',
      staticWebAppOrigin,
      '--web-redirect-uris',
      ...redirectUris,
      '--requested-access-token-version',
      '2',
      '--enable-id-token-issuance',
      'true',
      '-o',
      'json',
    ]),
    'application create response',
  )
}

function updateApplication(applicationId, staticWebAppOrigin, redirectUris) {
  runAz([
    'ad',
    'app',
    'update',
    '--id',
    applicationId,
    '--requested-access-token-version',
    '2',
    '-o',
    'none',
  ])

  runAz([
    'ad',
    'app',
    'update',
    '--id',
    applicationId,
    '--sign-in-audience',
    SIGN_IN_AUDIENCE,
    '--web-home-page-url',
    staticWebAppOrigin,
    '--web-redirect-uris',
    ...redirectUris,
    '--requested-access-token-version',
    '2',
    '--enable-id-token-issuance',
    'true',
    '-o',
    'none',
  ])
}

function ensureServicePrincipalExists(applicationId) {
  const servicePrincipals = parseJson(
    runAz([
      'ad',
      'sp',
      'list',
      '--filter',
      `appId eq '${applicationId}'`,
      '-o',
      'json',
    ]),
    'service principal list response',
  )

  if (!Array.isArray(servicePrincipals) || servicePrincipals.length === 0) {
    runAz(['ad', 'sp', 'create', '--id', applicationId, '-o', 'none'])
  }
}

function deletePasswordCredentials(applicationId) {
  const application = parseJson(
    runAz(['ad', 'app', 'show', '--id', applicationId, '-o', 'json']),
    'application show response',
  )
  const passwordCredentials = Array.isArray(application?.passwordCredentials)
    ? application.passwordCredentials
    : []

  for (const credential of passwordCredentials) {
    const keyId =
      typeof credential?.keyId === 'string' ? credential.keyId.trim() : ''

    if (!keyId) {
      continue
    }

    runAz([
      'ad',
      'app',
      'credential',
      'delete',
      '--id',
      applicationId,
      '--key-id',
      keyId,
      '-o',
      'none',
    ])
  }
}

function rotateClientSecret(applicationId, environmentName) {
  deletePasswordCredentials(applicationId)

  const credential = parseJson(
    runAz([
      'ad',
      'app',
      'credential',
      'reset',
      '--id',
      applicationId,
      '--display-name',
      getSecretDisplayName(environmentName),
      '--years',
      SECRET_LIFETIME_YEARS,
      '-o',
      'json',
    ]),
    'application credential reset response',
  )

  const password = credential?.password?.trim()
  if (!password) {
    throw new Error('The Entra client secret reset did not return a password.')
  }

  return password
}

function updateStaticWebAppSettings(
  resourceGroup,
  staticWebAppName,
  clientId,
  clientSecret,
) {
  runAz([
    'staticwebapp',
    'appsettings',
    'set',
    '--name',
    staticWebAppName,
    '--resource-group',
    resourceGroup,
    '--setting-names',
    `${CLIENT_ID_SETTING_NAME}=${clientId}`,
    `${CLIENT_SECRET_SETTING_NAME}=${clientSecret}`,
    '-o',
    'none',
  ])
}

function main() {
  const resourceGroup = readRequiredEnv('AZURE_RESOURCE_GROUP')
  const environmentName = readOptionalEnv(
    'AZURE_ENV_NAME',
    resourceGroup.replace(/^rg-/, ''),
  )
  const staticWebAppOrigin = getStaticWebAppOrigin()
  const redirectUris = getRedirectUris(staticWebAppOrigin)
  const tenantId = getTenantId()
  const staticWebAppName = getSingleResourceName(
    resourceGroup,
    'Microsoft.Web/staticSites',
  )
  const displayName = getAppDisplayName(environmentName)

  console.log(
    `Ensuring Microsoft Entra authentication is configured for ${staticWebAppName} in tenant ${tenantId}...`,
  )

  const existingApplication = findExistingApplication(
    displayName,
    staticWebAppOrigin,
  )
  if (existingApplication) {
    deletePasswordCredentials(existingApplication.appId)
  }
  const application =
    existingApplication ??
    createApplication(displayName, staticWebAppOrigin, redirectUris)

  updateApplication(application.appId, staticWebAppOrigin, redirectUris)
  ensureServicePrincipalExists(application.appId)

  console.log('Rotating the Entra client secret and updating Static Web App settings...')
  const clientSecret = rotateClientSecret(application.appId, environmentName)

  updateStaticWebAppSettings(
    resourceGroup,
    staticWebAppName,
    application.appId,
    clientSecret,
  )

  console.log(
    `Microsoft Entra authentication is configured for ${staticWebAppOrigin}.`,
  )
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
