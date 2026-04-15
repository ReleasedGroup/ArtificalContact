export interface CosmosStatus {
  status: 'ok' | 'skipped' | 'error'
  databaseName?: string
  details?: string
}

export interface HealthPayload {
  service: string
  status: 'ok'
  buildSha: string
  region: string
  timestamp: string
  cosmos: CosmosStatus
}

interface HealthEnvelope {
  data: HealthPayload
  errors: Array<{ code: string; message: string; field?: string }>
}

export async function getHealth(signal?: AbortSignal): Promise<HealthPayload> {
  const response = await fetch('/api/health', {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as HealthEnvelope

  if (!payload.data) {
    throw new Error('Health response did not contain a payload.')
  }

  return payload.data
}
