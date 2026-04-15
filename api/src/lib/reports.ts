import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import type { PostStore, StoredPostMediaDocument } from './posts.js'
import { readOptionalValue } from './strings.js'
import type { UserDocument, UserRepository } from './users.js'

export const DEFAULT_REPORTS_CONTAINER_NAME = 'reports'
export const DEFAULT_REPORT_DETAILS_MAX_LENGTH = 500

export const reportTargetTypes = ['post', 'reply', 'media', 'user'] as const
export const reportReasonCodes = [
  'spam',
  'harassment',
  'misinformation',
  'impersonation',
  'nsfw',
  'other',
] as const

export type ReportTargetType = (typeof reportTargetTypes)[number]
export type ReportReasonCode = (typeof reportReasonCodes)[number]
export type ReportStatus = 'open' | 'triaged' | 'resolved'

let cachedReportRepository: MutableReportRepository | undefined

export interface ReportDocument {
  id: string
  type: 'report'
  status: ReportStatus
  reporterId: string
  reporterHandle: string
  reporterDisplayName: string
  targetType: ReportTargetType
  targetId: string
  targetPostId: string | null
  targetAuthorId: string | null
  targetAuthorHandle: string | null
  targetProfileHandle: string | null
  reasonCode: ReportReasonCode
  details: string | null
  mediaUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatedReport {
  id: string
  status: ReportStatus
  targetType: ReportTargetType
  targetId: string
  reasonCode: ReportReasonCode
  createdAt: string
}

export interface ReportRepository {
  create(report: ReportDocument): Promise<ReportDocument>
  getById(reportId: string): Promise<ReportDocument | null>
  upsert(report: ReportDocument): Promise<ReportDocument>
}

export type MutableReportRepository = ReportRepository

export interface CreateReportRequest {
  targetType: ReportTargetType
  targetId: string
  targetPostId: string | null
  reasonCode: ReportReasonCode
  details: string | null
  mediaUrl: string | null
  targetProfileHandle: string | null
}

interface ResolvedReportTarget {
  targetPostId: string | null
  targetAuthorId: string | null
  targetAuthorHandle: string | null
  targetProfileHandle: string | null
  mediaUrl: string | null
}

function normalizeTrimmedText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim()
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function createReportRepositoryForContainer(
  container: Container,
): MutableReportRepository {
  return {
    async create(report: ReportDocument) {
      const response = await container.items.create<ReportDocument>(report)
      return response.resource ?? report
    },
    async getById(reportId) {
      const response = await container.items
        .query<ReportDocument>({
          query: 'SELECT TOP 1 * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: reportId }],
        })
        .fetchAll()

      return response.resources[0] ?? null
    },
    async upsert(report) {
      const response = await container.items.upsert<ReportDocument>(report)
      return response.resource ?? report
    },
  }
}

function buildReportSchema(maxDetailsLength: number) {
  return z
    .object({
      targetType: z.enum(reportTargetTypes),
      targetId: z.preprocess(normalizeTrimmedText, z.string().min(1).max(2048)),
      targetPostId: z
        .preprocess(normalizeTrimmedText, z.string().min(1).max(255))
        .nullable()
        .optional(),
      reasonCode: z.enum(reportReasonCodes),
      details: z
        .preprocess(
          normalizeTrimmedText,
          z.string().max(maxDetailsLength).optional(),
        )
        .nullable()
        .optional(),
      mediaUrl: z
        .preprocess(normalizeTrimmedText, z.string().url().max(2048).optional())
        .nullable()
        .optional(),
      targetProfileHandle: z
        .preprocess(normalizeTrimmedText, z.string().min(1).max(64).optional())
        .nullable()
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.targetType === 'media' && !value.targetPostId) {
        context.addIssue({
          code: 'custom',
          message: 'Media reports must include the parent post id.',
          path: ['targetPostId'],
        })
      }
    })
    .transform(
      (value): CreateReportRequest => ({
        targetType: value.targetType,
        targetId: value.targetId,
        targetPostId: value.targetPostId ?? null,
        reasonCode: value.reasonCode,
        details: value.details ?? null,
        mediaUrl: value.mediaUrl ?? null,
        targetProfileHandle: value.targetProfileHandle ?? null,
      }),
    )
}

function mediaMatchesTarget(
  media: StoredPostMediaDocument,
  targetId: string,
  mediaUrl: string | null,
): boolean {
  const mediaId = toNullableString(media.id)
  if (mediaId === targetId) {
    return true
  }

  if (mediaUrl === null) {
    return false
  }

  return (
    toNullableString(media.url) === mediaUrl ||
    toNullableString(media.thumbUrl) === mediaUrl
  )
}

async function resolveReportTarget(
  request: CreateReportRequest,
  dependencies: {
    postStore: PostStore
    userRepository: UserRepository
  },
): Promise<ResolvedReportTarget | null> {
  if (request.targetType === 'user') {
    const user = await dependencies.userRepository.getById(request.targetId)
    if (user === null) {
      return null
    }

    return {
      targetPostId: null,
      targetAuthorId: user.id,
      targetAuthorHandle: user.handle ?? user.handleLower ?? null,
      targetProfileHandle:
        request.targetProfileHandle ?? user.handle ?? user.handleLower ?? null,
      mediaUrl: null,
    }
  }

  const targetPostId =
    request.targetType === 'media' ? request.targetPostId : request.targetId
  const post = await dependencies.postStore.getPostById(targetPostId ?? '')
  if (post === null) {
    return null
  }

  if (request.targetType === 'post' || request.targetType === 'reply') {
    const targetType = toNullableString(post.type) === 'reply' ? 'reply' : 'post'
    if (targetType !== request.targetType) {
      return null
    }

    return {
      targetPostId: post.id,
      targetAuthorId: toNullableString(post.authorId),
      targetAuthorHandle: toNullableString(post.authorHandle),
      targetProfileHandle: toNullableString(post.authorHandle),
      mediaUrl: null,
    }
  }

  const matchedMedia = (post.media ?? []).find((media) =>
    mediaMatchesTarget(media, request.targetId, request.mediaUrl),
  )
  if (!matchedMedia) {
    return null
  }

  return {
    targetPostId: post.id,
    targetAuthorId: toNullableString(post.authorId),
    targetAuthorHandle: toNullableString(post.authorHandle),
    targetProfileHandle: toNullableString(post.authorHandle),
    mediaUrl:
      request.mediaUrl ??
      toNullableString(matchedMedia.url) ??
      toNullableString(matchedMedia.thumbUrl),
  }
}

export function buildCreateReportRequestSchema(
  maxDetailsLength = DEFAULT_REPORT_DETAILS_MAX_LENGTH,
) {
  return buildReportSchema(maxDetailsLength)
}

export function mapCreateReportValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_report',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function createReportDocument(
  reporter: UserDocument,
  request: CreateReportRequest,
  resolvedTarget: ResolvedReportTarget,
  createdAt: Date,
  idFactory: () => string,
): ReportDocument {
  const timestamp = createdAt.toISOString()

  return {
    id: idFactory(),
    type: 'report',
    status: 'open',
    reporterId: reporter.id,
    reporterHandle: reporter.handle ?? reporter.handleLower ?? '',
    reporterDisplayName: reporter.displayName,
    targetType: request.targetType,
    targetId: request.targetId,
    targetPostId: resolvedTarget.targetPostId,
    targetAuthorId: resolvedTarget.targetAuthorId,
    targetAuthorHandle: resolvedTarget.targetAuthorHandle,
    targetProfileHandle: resolvedTarget.targetProfileHandle,
    reasonCode: request.reasonCode,
    details: request.details,
    mediaUrl: resolvedTarget.mediaUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function toCreatedReport(report: ReportDocument): CreatedReport {
  return {
    id: report.id,
    status: report.status,
    targetType: report.targetType,
    targetId: report.targetId,
    reasonCode: report.reasonCode,
    createdAt: report.createdAt,
  }
}

export async function validateReportTarget(
  request: CreateReportRequest,
  dependencies: {
    postStore: PostStore
    userRepository: UserRepository
  },
): Promise<ResolvedReportTarget | null> {
  return resolveReportTarget(request, dependencies)
}

export function createReportRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): MutableReportRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve reports.')
  }

  const reportsContainerName =
    readOptionalValue(env.REPORTS_CONTAINER_NAME) ??
    DEFAULT_REPORTS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(reportsContainerName)

  return createReportRepositoryForContainer(container)
}

export function createReportRepository(): MutableReportRepository {
  cachedReportRepository ??= createReportRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedReportRepository
}
