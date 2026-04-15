import { TelemetryClient } from 'applicationinsights'

const authSigninEventName = 'auth.signin'

let cachedTelemetryClient: TelemetryClient | null | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getTelemetryClient(
  env: NodeJS.ProcessEnv = process.env,
): TelemetryClient | null {
  if (cachedTelemetryClient !== undefined) {
    return cachedTelemetryClient
  }

  const connectionString = readOptionalValue(
    env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  )

  if (!connectionString) {
    cachedTelemetryClient = null
    return cachedTelemetryClient
  }

  const client = new TelemetryClient(connectionString)
  client.setAutoPopulateAzureProperties()

  const cloudRoleName = readOptionalValue(env.WEBSITE_CLOUD_ROLENAME)
  if (cloudRoleName) {
    client.context.tags[client.context.keys.cloudRole] = cloudRoleName
  }

  cachedTelemetryClient = client
  return cachedTelemetryClient
}

export interface AuthSigninTelemetryEvent {
  identityProvider: string
  isNewUser: boolean
}

export interface TelemetryMetricProperties {
  [key: string]: boolean | number | string
}

export function trackAuthSigninEvent(event: AuthSigninTelemetryEvent): void {
  const client = getTelemetryClient()
  if (client === null) {
    return
  }

  client.trackEvent({
    name: authSigninEventName,
    properties: {
      idp: event.identityProvider.trim().toLowerCase(),
      isNewUser: event.isNewUser,
    },
  })
}

export function trackMetric(
  name: string,
  value: number,
  properties: TelemetryMetricProperties = {},
): void {
  const client = getTelemetryClient()
  if (client === null) {
    return
  }

  client.trackMetric({
    name,
    value,
    properties,
  })
}
