import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'
import type { UserDocument } from './users.js'

export const DEFAULT_REPORTS_CONTAINER_NAME = 'reports'
export const DEFAULT_REPORT_REASON_MAX_LENGTH = 100
export const DEFAULT_REPORT_DETAILS_MAX_LENGTH = 2000

let cachedReportRepository: ReportRepository | undefined

export type ReportTargetType = 'post' | 'reply' | 'media' | 'user'
export type ReportStatus = 'open' | 'triaged' | 'resolved'

export interface ReportDocument {
  id: string
  type: 'report'
  status: ReportStatus
  targetType: ReportTargetType
  targetId: string
  reporterId: string
  reporterHandle: string
  reason: string
  details: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateReportRequest {
  targetType: ReportTargetType
  targetId: string
  reason: string
  details: string | null
}

export interface ReportRepository {
  create(report: ReportDocument): Promise<ReportDocument>
}

function normalizeRequiredString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim()
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function createReportRepositoryForContainer(container: Container): ReportRepository {
  return {
    async create(report) {
      const response = await container.items.create<ReportDocument>(report)
      return response.resource ?? report
    },
  }
}

export function buildCreateReportRequestSchema() {
  return z
    .object({
      targetType: z.enum(['post', 'reply', 'media', 'user']),
      targetId: z.preprocess(normalizeRequiredString, z.string().min(1)),
      reason: z.preprocess(
        normalizeRequiredString,
        z.string().min(1).max(DEFAULT_REPORT_REASON_MAX_LENGTH),
      ),
      details: z.preprocess(
        normalizeOptionalString,
        z.string().max(DEFAULT_REPORT_DETAILS_MAX_LENGTH).optional(),
      ),
    })
    .strict()
    .transform(
      (value): CreateReportRequest => ({
        targetType: value.targetType,
        targetId: value.targetId,
        reason: value.reason,
        details: value.details ?? null,
      }),
    )
}

export function mapReportValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_report',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function createReportDocument(
  user: UserDocument,
  request: CreateReportRequest,
  createdAt: Date,
  idFactory: () => string,
): ReportDocument {
  const reporterHandle = user.handle ?? user.handleLower ?? ''
  const timestamp = createdAt.toISOString()

  return {
    id: idFactory(),
    type: 'report',
    status: 'open',
    targetType: request.targetType,
    targetId: request.targetId,
    reporterId: user.id,
    reporterHandle,
    reason: request.reason,
    details: request.details,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createReportRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): ReportRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve reports.')
  }

  const reportsContainerName =
    readOptionalValue(env.REPORTS_CONTAINER_NAME) ?? DEFAULT_REPORTS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(reportsContainerName)

  return createReportRepositoryForContainer(container)
}

export function createReportRepository(): ReportRepository {
  cachedReportRepository ??= createReportRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedReportRepository
}
