import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { pingCosmos, type CosmosPingResult } from './cosmos-ping.js'

export interface ApiError {
  code: string
  message: string
  field?: string
}

export interface ApiEnvelope<TData> {
  data: TData
  errors: ApiError[]
}

export interface HealthPayload {
  service: string
  status: 'ok'
  buildSha: string
  region: string
  timestamp: string
  cosmos: CosmosPingResult
}

export interface HealthDependencies {
  cosmosPing?: (config: EnvironmentConfig) => Promise<CosmosPingResult>
  environment?: EnvironmentConfig
  now?: () => Date
}

export async function createHealthReport(
  dependencies: HealthDependencies = {},
): Promise<ApiEnvelope<HealthPayload>> {
  const environment = dependencies.environment ?? getEnvironmentConfig()
  const now = dependencies.now ?? (() => new Date())
  const cosmosPing = dependencies.cosmosPing ?? pingCosmos

  return {
    data: {
      service: environment.serviceName,
      status: 'ok',
      buildSha: environment.buildSha,
      region: environment.region,
      timestamp: now().toISOString(),
      cosmos: await cosmosPing(environment),
    },
    errors: [],
  }
}
