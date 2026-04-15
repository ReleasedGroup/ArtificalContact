import type { ApiEnvelope } from './api-envelope.js'

export const DEFAULT_REPORTS_CONTAINER_NAME = 'reports'
export const DEFAULT_MODERATION_QUEUE_STATUS_LIMIT = 50

export type ReportStatus = 'open' | 'triaged' | 'resolved'
export type ModerationQueueStatus = Extract<ReportStatus, 'open' | 'triaged'>
export type ReportTargetType = 'post' | 'reply' | 'media' | 'user'
export type ReportSeverity = 'low' | 'medium' | 'high'

export interface StoredReportDocument {
  id?: string | null
  type?: string | null
  status?: string | null
  reason?: string | null
  category?: string | null
  details?: string | null
  description?: string | null
  severity?: string | null
  reporterUserId?: string | null
  reporterHandle?: string | null
  reporterDisplayName?: string | null
  targetType?: string | null
  targetId?: string | null
  targetHandle?: string | null
  targetExcerpt?: string | null
  targetUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  triagedAt?: string | null
  triagedByUserId?: string | null
  reporter?: {
    userId?: string | null
    handle?: string | null
    displayName?: string | null
  } | null
  target?: {
    type?: string | null
    id?: string | null
    handle?: string | null
    excerpt?: string | null
    url?: string | null
  } | null
}

export interface ModerationQueueReporter {
  userId: string | null
  handle: string | null
  displayName: string | null
}

export interface ModerationQueueTarget {
  type: ReportTargetType
  id: string
  handle: string | null
  excerpt: string | null
  url: string | null
}

export interface ModerationQueueEntry {
  id: string
  status: ModerationQueueStatus
  reason: string | null
  details: string | null
  severity: ReportSeverity | null
  reporter: ModerationQueueReporter
  target: ModerationQueueTarget
  createdAt: string | null
  updatedAt: string | null
  triagedAt: string | null
  triagedByUserId: string | null
}

export interface ModerationQueueSummary {
  open: number
  triaged: number
}

export interface ModerationQueuePage {
  openReports: ModerationQueueEntry[]
  triagedReports: ModerationQueueEntry[]
  counts: ModerationQueueSummary
}

export interface ModerationQueueReadStore {
  listReportsByStatus(
    status: ModerationQueueStatus,
    limit: number,
  ): Promise<StoredReportDocument[]>
  countReportsByStatus(status: ModerationQueueStatus): Promise<number>
}

export interface ModerationQueueLookupResult {
  status: 200
  body: ApiEnvelope<ModerationQueuePage>
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeStatus(value: unknown): ModerationQueueStatus | null {
  const normalized = toNonEmptyString(value)?.toLowerCase()
  if (normalized === 'open' || normalized === 'triaged') {
    return normalized
  }

  return null
}

function normalizeTargetType(value: unknown): ReportTargetType | null {
  const normalized = toNonEmptyString(value)?.toLowerCase()
  if (
    normalized === 'post' ||
    normalized === 'reply' ||
    normalized === 'media' ||
    normalized === 'user'
  ) {
    return normalized
  }

  if (normalized === 'account' || normalized === 'profile') {
    return 'user'
  }

  return null
}

function normalizeSeverity(value: unknown): ReportSeverity | null {
  const normalized = toNonEmptyString(value)?.toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }

  if (normalized === 'med') {
    return 'medium'
  }

  return null
}

function compareByNewestCreatedAt(
  left: ModerationQueueEntry,
  right: ModerationQueueEntry,
): number {
  const leftCreatedAt = left.createdAt ?? ''
  const rightCreatedAt = right.createdAt ?? ''

  if (leftCreatedAt === rightCreatedAt) {
    return right.id.localeCompare(left.id)
  }

  return rightCreatedAt.localeCompare(leftCreatedAt)
}

export function toModerationQueueEntry(
  document: StoredReportDocument,
): ModerationQueueEntry | null {
  const id = toNonEmptyString(document.id)
  const status = normalizeStatus(document.status)
  const targetType =
    normalizeTargetType(document.targetType) ??
    normalizeTargetType(document.target?.type)
  const targetId =
    toNonEmptyString(document.targetId) ?? toNonEmptyString(document.target?.id)

  if (id === null || status === null || targetType === null || targetId === null) {
    return null
  }

  return {
    id,
    status,
    reason:
      toNonEmptyString(document.reason) ?? toNonEmptyString(document.category),
    details:
      toNonEmptyString(document.details) ??
      toNonEmptyString(document.description),
    severity: normalizeSeverity(document.severity),
    reporter: {
      userId:
        toNonEmptyString(document.reporterUserId) ??
        toNonEmptyString(document.reporter?.userId),
      handle:
        toNonEmptyString(document.reporterHandle) ??
        toNonEmptyString(document.reporter?.handle),
      displayName: toNonEmptyString(
        document.reporterDisplayName,
      ) ?? toNonEmptyString(document.reporter?.displayName),
    },
    target: {
      type: targetType,
      id: targetId,
      handle:
        toNonEmptyString(document.targetHandle) ??
        toNonEmptyString(document.target?.handle),
      excerpt:
        toNonEmptyString(document.targetExcerpt) ??
        toNonEmptyString(document.target?.excerpt),
      url:
        toNonEmptyString(document.targetUrl) ??
        toNonEmptyString(document.target?.url),
    },
    createdAt: toNonEmptyString(document.createdAt),
    updatedAt: toNonEmptyString(document.updatedAt),
    triagedAt: toNonEmptyString(document.triagedAt),
    triagedByUserId: toNonEmptyString(document.triagedByUserId),
  }
}

export async function lookupModerationQueue(
  store: ModerationQueueReadStore,
  limit = DEFAULT_MODERATION_QUEUE_STATUS_LIMIT,
): Promise<ModerationQueueLookupResult> {
  const [openDocuments, triagedDocuments, openCount, triagedCount] =
    await Promise.all([
      store.listReportsByStatus('open', limit),
      store.listReportsByStatus('triaged', limit),
      store.countReportsByStatus('open'),
      store.countReportsByStatus('triaged'),
    ])

  return {
    status: 200,
    body: {
      data: {
        openReports: openDocuments
          .map((document) => toModerationQueueEntry(document))
          .filter((entry): entry is ModerationQueueEntry => entry !== null)
          .sort(compareByNewestCreatedAt),
        triagedReports: triagedDocuments
          .map((document) => toModerationQueueEntry(document))
          .filter((entry): entry is ModerationQueueEntry => entry !== null)
          .sort(compareByNewestCreatedAt),
        counts: {
          open: openCount,
          triaged: triagedCount,
        },
      },
      errors: [],
    },
  }
}
