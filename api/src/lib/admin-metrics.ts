import type { ApiEnvelope } from './api-envelope.js'

const oneHourMs = 60 * 60 * 1000
const oneDayMs = 24 * oneHourMs

export type AdminMetricsRange = '24h' | '7d' | '30d'
export type AdminMetricsBucket = 'hour' | 'day'

export interface AdminMetricsActorRecord {
  occurredAt: string | null
  userId: string | null
}

export interface AdminMetricsReportRecord {
  createdAt: string | null
  triagedAt: string | null
  status: string | null
  reporterId: string | null
}

export interface AdminMetricsReadStore {
  listRegistrations(
    start: Date,
    end: Date,
  ): Promise<AdminMetricsActorRecord[]>
  listPosts(start: Date, end: Date): Promise<AdminMetricsActorRecord[]>
  listReactions(start: Date, end: Date): Promise<AdminMetricsActorRecord[]>
  listFollows(start: Date, end: Date): Promise<AdminMetricsActorRecord[]>
  listReportTimeline(
    previousStart: Date,
    end: Date,
  ): Promise<AdminMetricsReportRecord[]>
}

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

export interface AdminMetricsPayload {
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

export interface AdminMetricsLookupResult {
  status: 200
  body: ApiEnvelope<AdminMetricsPayload>
}

interface ResolvedRangeConfig {
  range: AdminMetricsRange
  bucket: AdminMetricsBucket
  durationMs: number
  bucketMs: number
}

interface ResolvedWindow {
  generatedAt: Date
  currentStart: Date
  currentEnd: Date
  previousStart: Date
}

interface BucketAccumulator {
  startMs: number
  endMs: number
  registrations: number
  posts: number
  reports: number
  activeUsers: Set<string>
}

const rangeConfigurations: Record<AdminMetricsRange, ResolvedRangeConfig> = {
  '24h': {
    range: '24h',
    bucket: 'hour',
    durationMs: 24 * oneHourMs,
    bucketMs: oneHourMs,
  },
  '7d': {
    range: '7d',
    bucket: 'day',
    durationMs: 7 * oneDayMs,
    bucketMs: oneDayMs,
  },
  '30d': {
    range: '30d',
    bucket: 'day',
    durationMs: 30 * oneDayMs,
    bucketMs: oneDayMs,
  },
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toTimestamp(value: string | null): number | null {
  if (value === null) {
    return null
  }

  const parsedValue = Date.parse(value)
  return Number.isNaN(parsedValue) ? null : parsedValue
}

function normalizeRange(value: string | undefined): AdminMetricsRange | null {
  const normalizedValue = toNullableString(value)?.toLowerCase()

  if (
    normalizedValue === '24h' ||
    normalizedValue === '7d' ||
    normalizedValue === '30d'
  ) {
    return normalizedValue
  }

  return null
}

function alignToNextBucketBoundary(
  date: Date,
  bucket: AdminMetricsBucket,
): Date {
  const aligned = new Date(date)

  if (bucket === 'hour') {
    aligned.setUTCMinutes(0, 0, 0)
    aligned.setUTCHours(aligned.getUTCHours() + 1)
    return aligned
  }

  aligned.setUTCHours(0, 0, 0, 0)
  aligned.setUTCDate(aligned.getUTCDate() + 1)
  return aligned
}

function resolveWindow(
  config: ResolvedRangeConfig,
  generatedAt: Date,
): ResolvedWindow {
  const currentEnd = alignToNextBucketBoundary(generatedAt, config.bucket)
  const currentStart = new Date(currentEnd.getTime() - config.durationMs)
  const previousStart = new Date(currentStart.getTime() - config.durationMs)

  return {
    generatedAt,
    currentStart,
    currentEnd,
    previousStart,
  }
}

function isWithinWindow(
  timestamp: number | null,
  start: Date,
  end: Date,
): boolean {
  if (timestamp === null) {
    return false
  }

  return timestamp >= start.getTime() && timestamp < end.getTime()
}

function calculateChangePercent(
  value: number,
  previousValue: number,
): number | null {
  if (previousValue === 0) {
    return value === 0 ? 0 : null
  }

  return Number((((value - previousValue) / previousValue) * 100).toFixed(1))
}

function createSummaryValue(
  value: number,
  previousValue: number,
): AdminMetricSummaryValue {
  return {
    value,
    previousValue,
    changePercent: calculateChangePercent(value, previousValue),
  }
}

function createCurrentBuckets(window: ResolvedWindow, bucketMs: number) {
  const buckets: BucketAccumulator[] = []
  const currentStartMs = window.currentStart.getTime()

  for (
    let bucketStartMs = currentStartMs;
    bucketStartMs < window.currentEnd.getTime();
    bucketStartMs += bucketMs
  ) {
    buckets.push({
      startMs: bucketStartMs,
      endMs: bucketStartMs + bucketMs,
      registrations: 0,
      posts: 0,
      reports: 0,
      activeUsers: new Set<string>(),
    })
  }

  return buckets
}

function resolveBucketIndex(
  timestamp: number | null,
  buckets: readonly BucketAccumulator[],
  bucketMs: number,
): number | null {
  if (timestamp === null || buckets.length === 0) {
    return null
  }

  const firstBucket = buckets[0]
  if (firstBucket === undefined || timestamp < firstBucket.startMs) {
    return null
  }

  const index = Math.floor((timestamp - firstBucket.startMs) / bucketMs)
  if (index < 0 || index >= buckets.length) {
    return null
  }

  return index
}

function countOpenReportsAt(
  reports: readonly AdminMetricsReportRecord[],
  asOfMs: number,
): number {
  let openCount = 0

  for (const report of reports) {
    const createdAt = toTimestamp(report.createdAt)
    if (createdAt === null || createdAt >= asOfMs) {
      continue
    }

    const triagedAt = toTimestamp(report.triagedAt)
    const normalizedStatus = toNullableString(report.status)?.toLowerCase()

    if (normalizedStatus === 'open') {
      openCount += 1
      continue
    }

    if (triagedAt === null || triagedAt > asOfMs) {
      openCount += 1
    }
  }

  return openCount
}

export function parseAdminMetricsRange(
  value: string | undefined,
): AdminMetricsRange | null {
  if (value === undefined) {
    return '7d'
  }

  return normalizeRange(value)
}

export async function lookupAdminMetrics(
  range: AdminMetricsRange,
  store: AdminMetricsReadStore,
  now: () => Date = () => new Date(),
): Promise<AdminMetricsLookupResult> {
  const config = rangeConfigurations[range]
  const generatedAt = now()
  const window = resolveWindow(config, generatedAt)
  const currentBuckets = createCurrentBuckets(window, config.bucketMs)

  const [registrations, posts, reactions, follows, reportTimeline] =
    await Promise.all([
      store.listRegistrations(window.previousStart, window.generatedAt),
      store.listPosts(window.previousStart, window.generatedAt),
      store.listReactions(window.previousStart, window.generatedAt),
      store.listFollows(window.previousStart, window.generatedAt),
      store.listReportTimeline(window.previousStart, window.generatedAt),
    ])

  let currentRegistrations = 0
  let previousRegistrations = 0
  let currentPosts = 0
  let previousPosts = 0
  let currentReports = 0
  let previousReports = 0
  const activeUserCurrent = new Set<string>()
  const activeUserPrevious = new Set<string>()

  for (const record of registrations) {
    const timestamp = toTimestamp(record.occurredAt)
    const userId = toNullableString(record.userId)

    if (isWithinWindow(timestamp, window.currentStart, window.generatedAt)) {
      currentRegistrations += 1

      if (userId !== null) {
        activeUserCurrent.add(userId)
      }

      const bucketIndex = resolveBucketIndex(
        timestamp,
        currentBuckets,
        config.bucketMs,
      )
      if (bucketIndex !== null) {
        const bucket = currentBuckets[bucketIndex]
        if (bucket !== undefined) {
          bucket.registrations += 1
          if (userId !== null) {
            bucket.activeUsers.add(userId)
          }
        }
      }

      continue
    }

    if (isWithinWindow(timestamp, window.previousStart, window.currentStart)) {
      previousRegistrations += 1

      if (userId !== null) {
        activeUserPrevious.add(userId)
      }
    }
  }

  for (const record of posts) {
    const timestamp = toTimestamp(record.occurredAt)
    const userId = toNullableString(record.userId)

    if (isWithinWindow(timestamp, window.currentStart, window.generatedAt)) {
      currentPosts += 1

      if (userId !== null) {
        activeUserCurrent.add(userId)
      }

      const bucketIndex = resolveBucketIndex(
        timestamp,
        currentBuckets,
        config.bucketMs,
      )
      if (bucketIndex !== null) {
        const bucket = currentBuckets[bucketIndex]
        if (bucket !== undefined) {
          bucket.posts += 1
          if (userId !== null) {
            bucket.activeUsers.add(userId)
          }
        }
      }

      continue
    }

    if (isWithinWindow(timestamp, window.previousStart, window.currentStart)) {
      previousPosts += 1

      if (userId !== null) {
        activeUserPrevious.add(userId)
      }
    }
  }

  for (const record of reactions) {
    const timestamp = toTimestamp(record.occurredAt)
    const userId = toNullableString(record.userId)
    if (userId === null) {
      continue
    }

    if (isWithinWindow(timestamp, window.currentStart, window.generatedAt)) {
      activeUserCurrent.add(userId)

      const bucketIndex = resolveBucketIndex(
        timestamp,
        currentBuckets,
        config.bucketMs,
      )
      if (bucketIndex !== null) {
        currentBuckets[bucketIndex]?.activeUsers.add(userId)
      }
      continue
    }

    if (isWithinWindow(timestamp, window.previousStart, window.currentStart)) {
      activeUserPrevious.add(userId)
    }
  }

  for (const record of follows) {
    const timestamp = toTimestamp(record.occurredAt)
    const userId = toNullableString(record.userId)
    if (userId === null) {
      continue
    }

    if (isWithinWindow(timestamp, window.currentStart, window.generatedAt)) {
      activeUserCurrent.add(userId)

      const bucketIndex = resolveBucketIndex(
        timestamp,
        currentBuckets,
        config.bucketMs,
      )
      if (bucketIndex !== null) {
        currentBuckets[bucketIndex]?.activeUsers.add(userId)
      }
      continue
    }

    if (isWithinWindow(timestamp, window.previousStart, window.currentStart)) {
      activeUserPrevious.add(userId)
    }
  }

  for (const report of reportTimeline) {
    const createdAt = toTimestamp(report.createdAt)
    const reporterId = toNullableString(report.reporterId)

    if (isWithinWindow(createdAt, window.currentStart, window.generatedAt)) {
      currentReports += 1

      if (reporterId !== null) {
        activeUserCurrent.add(reporterId)
      }

      const bucketIndex = resolveBucketIndex(
        createdAt,
        currentBuckets,
        config.bucketMs,
      )
      if (bucketIndex !== null) {
        const bucket = currentBuckets[bucketIndex]
        if (bucket !== undefined) {
          bucket.reports += 1
          if (reporterId !== null) {
            bucket.activeUsers.add(reporterId)
          }
        }
      }
      continue
    }

    if (isWithinWindow(createdAt, window.previousStart, window.currentStart)) {
      previousReports += 1

      if (reporterId !== null) {
        activeUserPrevious.add(reporterId)
      }
    }
  }

  const queueDepthCurrent = countOpenReportsAt(
    reportTimeline,
    window.generatedAt.getTime(),
  )
  const queueDepthPrevious = countOpenReportsAt(
    reportTimeline,
    window.currentStart.getTime(),
  )

  return {
    status: 200,
    body: {
      data: {
        filters: {
          range: config.range,
          bucket: config.bucket,
          startAt: window.currentStart.toISOString(),
          endAt: window.currentEnd.toISOString(),
          generatedAt: window.generatedAt.toISOString(),
        },
        summary: {
          registrations: createSummaryValue(
            currentRegistrations,
            previousRegistrations,
          ),
          activeUsers: createSummaryValue(
            activeUserCurrent.size,
            activeUserPrevious.size,
          ),
          posts: createSummaryValue(currentPosts, previousPosts),
          reports: createSummaryValue(currentReports, previousReports),
          queueDepth: createSummaryValue(
            queueDepthCurrent,
            queueDepthPrevious,
          ),
        },
        series: currentBuckets.map((bucket) => ({
          bucketStart: new Date(bucket.startMs).toISOString(),
          bucketEnd: new Date(bucket.endMs).toISOString(),
          registrations: bucket.registrations,
          activeUsers: bucket.activeUsers.size,
          posts: bucket.posts,
          reports: bucket.reports,
          queueDepth: countOpenReportsAt(
            reportTimeline,
            Math.min(bucket.endMs, window.generatedAt.getTime()),
          ),
        })),
      },
      errors: [],
    },
  }
}
