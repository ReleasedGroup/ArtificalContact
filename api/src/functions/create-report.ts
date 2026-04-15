import { randomUUID } from 'node:crypto'
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createJsonEnvelopeResponse,
  createSuccessResponse,
} from '../lib/api-envelope.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { withHttpAuth } from '../lib/http-auth.js'
import type { PostStore } from '../lib/posts.js'
import {
  buildCreateReportRequestSchema,
  createReportDocument,
  createReportRepository,
  mapCreateReportValidationIssues,
  toCreatedReport,
  validateReportTarget,
  type MutableReportRepository,
} from '../lib/reports.js'
import { createUserRepository, type UserRepository } from '../lib/users.js'

export interface CreateReportHandlerDependencies {
  idFactory?: () => string
  now?: () => Date
  maxDetailsLength?: number
  reportRepositoryFactory?: () => MutableReportRepository
  postStoreFactory?: () => PostStore
  userRepositoryFactory?: () => UserRepository
}

function getPostStore(): PostStore {
  return CosmosPostStore.fromEnvironment()
}

export function buildCreateReportHandler(
  dependencies: CreateReportHandlerDependencies = {},
) {
  const idFactory = dependencies.idFactory ?? randomUUID
  const now = dependencies.now ?? (() => new Date())
  const requestSchema = buildCreateReportRequestSchema(
    dependencies.maxDetailsLength,
  )
  const reportRepositoryFactory =
    dependencies.reportRepositoryFactory ?? (() => createReportRepository())
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const userRepositoryFactory =
    dependencies.userRepositoryFactory ?? (() => createUserRepository())

  return async function createReportHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const reporterHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !reporterHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before reporting content.',
      })
    }

    let reportRepository: MutableReportRepository
    let postStore: PostStore
    let userRepository: UserRepository

    try {
      reportRepository = reportRepositoryFactory()
      postStore = postStoreFactory()
      userRepository = userRepositoryFactory()
    } catch (error) {
      context.log('Failed to configure the report flow repositories.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The report flow is not configured.',
      })
    }

    let requestBody: unknown

    try {
      requestBody = await request.json()
    } catch {
      return createErrorResponse(400, {
        code: 'invalid_json',
        message: 'The request body must be valid JSON.',
      })
    }

    const parsedBody = requestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapCreateReportValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const resolvedTarget = await validateReportTarget(parsedBody.data, {
        postStore,
        userRepository,
      })

      if (resolvedTarget === null) {
        return createErrorResponse(404, {
          code: 'report_target_not_found',
          message: 'The reported target could not be found.',
          field: 'targetId',
        })
      }

      const report = createReportDocument(
        authenticatedUser,
        parsedBody.data,
        resolvedTarget,
        now(),
        idFactory,
      )
      const storedReport = await reportRepository.create(report)

      context.log('Created moderation report.', {
        reportId: storedReport.id,
        reporterId: authenticatedUser.id,
        targetType: storedReport.targetType,
        targetId: storedReport.targetId,
      })

      return createSuccessResponse(
        {
          report: toCreatedReport(storedReport),
        },
        201,
      )
    } catch (error) {
      context.log('Failed to create a moderation report.', {
        error:
          error instanceof Error ? error.message : 'Unknown report creation error.',
        reporterId: authenticatedUser.id,
        targetType: parsedBody.data.targetType,
        targetId: parsedBody.data.targetId,
      })

      return createErrorResponse(500, {
        code: 'server.report_create_failed',
        message: 'Unable to submit the report.',
      })
    }
  }
}

export const createReportHandler = withHttpAuth(buildCreateReportHandler())

export function registerCreateReportFunction() {
  app.http('createReport', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'reports',
    handler: createReportHandler,
  })
}
