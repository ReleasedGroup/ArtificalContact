import type { ReportStatus } from './reports.js'

const HOUR_IN_MS = 60 * 60 * 1000
const DAY_IN_MS = 24 * HOUR_IN_MS

export const ADMIN_METRIC_WINDOWS = {
  last24Hours: DAY_IN_MS,
  last7Days: 7 * DAY_IN_MS,
  last30Days: 30 * DAY_IN_MS,
} as const

export type AdminMetricWindowKey = keyof typeof ADMIN_METRIC_WINDOWS

export interface AdminMetricWindowMap<TValue> {
  last24Hours: TValue
  last7Days: TValue
  last30Days: TValue
}

export interface AdminMetricsStore {
  countRegistrations(): Promise<number>
  countRegistrationsSince(since: string): Promise<number>
  listUserIdsWithPostsSince(since: string): Promise<string[]>
  listUserIdsWithReactionsSince(since: string): Promise<string[]>
  listUserIdsWithFollowsSince(since: string): Promise<string[]>
  listUserIdsWithReportsSince(since: string): Promise<string[]>
  countRootPostsSince(since: string): Promise<number>
  countRepliesSince(since: string): Promise<number>
  countReports(): Promise<number>
  countReportsSince(since: string): Promise<number>
  countReportsByStatus(status: ReportStatus): Promise<number>
  countReportsUpdatedSince(
    since: string,
    status: Extract<ReportStatus, 'triaged' | 'resolved'>,
  ): Promise<number>
  countNotificationsSince(since: string): Promise<number>
}

export interface AdminMetricsSnapshot {
  generatedAt: string
  windowStarts: AdminMetricWindowMap<string>
  registrations: {
    total: number
    last24Hours: number
    last7Days: number
    last30Days: number
  }
  dailyActiveUsers: number
  posts: AdminMetricWindowMap<{
    total: number
    rootPosts: number
    replies: number
  }>
  reports: {
    total: number
    created: AdminMetricWindowMap<number>
    byStatus: Record<ReportStatus, number>
  }
  queueDepth: {
    openReports: number
  }
  moderation: AdminMetricWindowMap<{
    triaged: number
    resolved: number
    reviewed: number
  }>
  notifications: AdminMetricWindowMap<number>
}

function normalizeUserIds(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

function createWindowStarts(now: Date): AdminMetricWindowMap<string> {
  return {
    last24Hours: new Date(now.getTime() - ADMIN_METRIC_WINDOWS.last24Hours)
      .toISOString(),
    last7Days: new Date(now.getTime() - ADMIN_METRIC_WINDOWS.last7Days)
      .toISOString(),
    last30Days: new Date(now.getTime() - ADMIN_METRIC_WINDOWS.last30Days)
      .toISOString(),
  }
}

export async function loadAdminMetricsSnapshot(
  store: AdminMetricsStore,
  now: Date = new Date(),
): Promise<AdminMetricsSnapshot> {
  const generatedAt = now.toISOString()
  const windowStarts = createWindowStarts(now)

  const [
    totalRegistrations,
    registrationsLast24Hours,
    registrationsLast7Days,
    registrationsLast30Days,
    activePostAuthors,
    activeReactionUsers,
    activeFollowUsers,
    activeReportUsers,
    rootPostsLast24Hours,
    rootPostsLast7Days,
    rootPostsLast30Days,
    repliesLast24Hours,
    repliesLast7Days,
    repliesLast30Days,
    totalReports,
    reportsLast24Hours,
    reportsLast7Days,
    reportsLast30Days,
    openReports,
    triagedReports,
    resolvedReports,
    triagedLast24Hours,
    triagedLast7Days,
    triagedLast30Days,
    resolvedLast24Hours,
    resolvedLast7Days,
    resolvedLast30Days,
    notificationsLast24Hours,
    notificationsLast7Days,
    notificationsLast30Days,
  ] = await Promise.all([
    store.countRegistrations(),
    store.countRegistrationsSince(windowStarts.last24Hours),
    store.countRegistrationsSince(windowStarts.last7Days),
    store.countRegistrationsSince(windowStarts.last30Days),
    store.listUserIdsWithPostsSince(windowStarts.last24Hours),
    store.listUserIdsWithReactionsSince(windowStarts.last24Hours),
    store.listUserIdsWithFollowsSince(windowStarts.last24Hours),
    store.listUserIdsWithReportsSince(windowStarts.last24Hours),
    store.countRootPostsSince(windowStarts.last24Hours),
    store.countRootPostsSince(windowStarts.last7Days),
    store.countRootPostsSince(windowStarts.last30Days),
    store.countRepliesSince(windowStarts.last24Hours),
    store.countRepliesSince(windowStarts.last7Days),
    store.countRepliesSince(windowStarts.last30Days),
    store.countReports(),
    store.countReportsSince(windowStarts.last24Hours),
    store.countReportsSince(windowStarts.last7Days),
    store.countReportsSince(windowStarts.last30Days),
    store.countReportsByStatus('open'),
    store.countReportsByStatus('triaged'),
    store.countReportsByStatus('resolved'),
    store.countReportsUpdatedSince(windowStarts.last24Hours, 'triaged'),
    store.countReportsUpdatedSince(windowStarts.last7Days, 'triaged'),
    store.countReportsUpdatedSince(windowStarts.last30Days, 'triaged'),
    store.countReportsUpdatedSince(windowStarts.last24Hours, 'resolved'),
    store.countReportsUpdatedSince(windowStarts.last7Days, 'resolved'),
    store.countReportsUpdatedSince(windowStarts.last30Days, 'resolved'),
    store.countNotificationsSince(windowStarts.last24Hours),
    store.countNotificationsSince(windowStarts.last7Days),
    store.countNotificationsSince(windowStarts.last30Days),
  ])

  const dailyActiveUsers = normalizeUserIds([
    ...activePostAuthors,
    ...activeReactionUsers,
    ...activeFollowUsers,
    ...activeReportUsers,
  ]).length

  return {
    generatedAt,
    windowStarts,
    registrations: {
      total: totalRegistrations,
      last24Hours: registrationsLast24Hours,
      last7Days: registrationsLast7Days,
      last30Days: registrationsLast30Days,
    },
    dailyActiveUsers,
    posts: {
      last24Hours: {
        total: rootPostsLast24Hours + repliesLast24Hours,
        rootPosts: rootPostsLast24Hours,
        replies: repliesLast24Hours,
      },
      last7Days: {
        total: rootPostsLast7Days + repliesLast7Days,
        rootPosts: rootPostsLast7Days,
        replies: repliesLast7Days,
      },
      last30Days: {
        total: rootPostsLast30Days + repliesLast30Days,
        rootPosts: rootPostsLast30Days,
        replies: repliesLast30Days,
      },
    },
    reports: {
      total: totalReports,
      created: {
        last24Hours: reportsLast24Hours,
        last7Days: reportsLast7Days,
        last30Days: reportsLast30Days,
      },
      byStatus: {
        open: openReports,
        triaged: triagedReports,
        resolved: resolvedReports,
      },
    },
    queueDepth: {
      openReports,
    },
    moderation: {
      last24Hours: {
        triaged: triagedLast24Hours,
        resolved: resolvedLast24Hours,
        reviewed: triagedLast24Hours + resolvedLast24Hours,
      },
      last7Days: {
        triaged: triagedLast7Days,
        resolved: resolvedLast7Days,
        reviewed: triagedLast7Days + resolvedLast7Days,
      },
      last30Days: {
        triaged: triagedLast30Days,
        resolved: resolvedLast30Days,
        reviewed: triagedLast30Days + resolvedLast30Days,
      },
    },
    notifications: {
      last24Hours: notificationsLast24Hours,
      last7Days: notificationsLast7Days,
      last30Days: notificationsLast30Days,
    },
  }
}
