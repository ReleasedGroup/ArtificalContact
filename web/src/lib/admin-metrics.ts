interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export type AdminMetricsRange = '24h' | '7d' | '30d'
export type AdminMetricsBucket = 'hour' | 'day'

export interface AdminMetricSummaryValue {
  value: number
  previousValue: number
  changePercent: number | null
}

export interface AdminMetricsSeriesBucket {
  bucketStart: string
  bucketEnd: string
  registrations: number
  activeUsers: number
  posts: number
  reports: number
  queueDepth: number
}

export interface AdminMetricsData {
  filters: {
    range: AdminMetricsRange
    bucket: AdminMetricsBucket
    startAt: string
    endAt: string
    generatedAt: string
  }
  summary: {
    registrations: AdminMetricSummaryValue
    activeUsers: AdminMetricSummaryValue
    posts: AdminMetricSummaryValue
    reports: AdminMetricSummaryValue
    queueDepth: AdminMetricSummaryValue
  }
  series: AdminMetricsSeriesBucket[]
}

function readErrorMessage(payload: ApiEnvelope<AdminMetricsData> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getAdminMetrics(
  range: AdminMetricsRange,
  signal?: AbortSignal,
): Promise<AdminMetricsData> {
  const requestUrl = new URL('/api/admin/metrics', window.location.origin)
  requestUrl.searchParams.set('range', range)

  const response = await fetch(requestUrl.pathname + requestUrl.search, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  let payload: ApiEnvelope<AdminMetricsData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<AdminMetricsData>
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Admin metrics lookup failed with status ${response.status}.`,
    )
  }

  if (payload?.data === null || payload?.data === undefined) {
    throw new Error('Admin metrics response did not contain a payload.')
  }

  return payload.data
}
