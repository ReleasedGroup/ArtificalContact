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
import { withHttpAuth } from '../lib/http-auth.js'
import {
  buildCreateReportRequestSchema,
  createReportDocument,
  createReportRepository,
  mapReportValidationIssues,
  type ReportRepository,
} from '../lib/reports.js'

export interface CreateReportHandlerDependencies {
  idFactory?: () => string
  now?: () => Date
  repositoryFactory?: () => ReportRepository
}

export function buildCreateReportHandler(
  dependencies: CreateReportHandlerDependencies = {},
) {
  const idFactory = dependencies.idFactory ?? randomUUID
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createReportRepository())
  const requestSchema = buildCreateReportRequestSchema()

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
          'The authenticated user must have an active profile before submitting reports.',
      })
    }

    let repository: ReportRepository

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the report repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The report store is not configured.',
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
        errors: mapReportValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const report = createReportDocument(
        authenticatedUser,
        parsedBody.data,
        now(),
        idFactory,
      )
      const storedReport = await repository.create(report)

      context.log('Created report.', {
        reportId: storedReport.id,
        reporterId: authenticatedUser.id,
        status: storedReport.status,
        targetId: storedReport.targetId,
        targetType: storedReport.targetType,
      })

      return createSuccessResponse(
        {
          report: storedReport,
        },
        201,
      )
    } catch (error) {
      context.log('Failed to create the report.', {
        error:
          error instanceof Error ? error.message : 'Unknown report creation error.',
        reporterId: authenticatedUser.id,
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
