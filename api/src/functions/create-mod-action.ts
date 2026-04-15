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
import {
  buildCreateModActionRequestSchema,
  createModActionDocument,
  createModActionRepository,
  mapModActionValidationIssues,
  type CreateModActionRequest,
  type ModActionRepository,
  type ModActionTargetType,
} from '../lib/mod-actions.js'
import type { MutablePostStore, StoredPostDocument } from '../lib/posts.js'
import {
  createReportRepository,
  type ReportDocument,
  type ReportRepository,
} from '../lib/reports.js'
import {
  createUserRepository,
  type MutableUserRepository,
} from '../lib/users.js'
import { withRateLimit } from '../lib/rate-limit.js'

export interface CreateModActionHandlerDependencies {
  idFactory?: () => string
  now?: () => Date
  postStoreFactory?: () => MutablePostStore
  reportRepositoryFactory?: () => ReportRepository
  modActionRepositoryFactory?: () => ModActionRepository
  userRepositoryFactory?: () => MutableUserRepository
}

interface ModerationTargetSummary {
  id: string
  type: ModActionTargetType
  alreadyApplied: boolean
  moderationState?: string
  userStatus?: string
  reportStatus?: string
}

interface ModerationReportSummary {
  id: string
  status: string
  alreadyApplied: boolean
}

let cachedPostStore: CosmosPostStore | undefined

function getPostStore(): CosmosPostStore {
  cachedPostStore ??= CosmosPostStore.fromEnvironment()
  return cachedPostStore
}

function normalizeModerationState(
  value: StoredPostDocument['moderationState'],
): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : 'ok'
}

function getPostTargetType(post: StoredPostDocument): 'post' | 'reply' {
  return post.type === 'reply' ? 'reply' : 'post'
}

function canResolveLinkedReport(
  action: CreateModActionRequest['action'],
  targetId: string,
  report: ReportDocument,
): boolean {
  switch (action) {
    case 'hidePost':
    case 'removePost':
      return (
        (report.targetType === 'post' || report.targetType === 'reply') &&
        report.targetId === targetId
      )
    case 'suspendAccount':
      return report.targetType === 'user' && report.targetId === targetId
    case 'dismissReport':
      return report.id === targetId
  }
}

async function maybeResolveLinkedReport(
  request: CreateModActionRequest,
  reportRepositoryFactory: () => ReportRepository,
  updatedAt: string,
): Promise<
  | { report: ModerationReportSummary | null }
  | { error: HttpResponseInit }
> {
  if (request.reportId === null) {
    return {
      report: null,
    }
  }

  let reportRepository: ReportRepository

  try {
    reportRepository = reportRepositoryFactory()
  } catch {
    return {
      error: createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The report store is not configured.',
      }),
    }
  }

  const report = await reportRepository.getById(request.reportId)
  if (report === null) {
    return {
      error: createErrorResponse(404, {
        code: 'report_not_found',
        message: 'No report exists for the requested report id.',
        field: 'reportId',
      }),
    }
  }

  if (!canResolveLinkedReport(request.action, request.targetId, report)) {
    return {
      error: createErrorResponse(409, {
        code: 'mod_action_conflict',
        message:
          'The linked report does not match the requested moderation target.',
        field: 'reportId',
      }),
    }
  }

  if (report.status === 'resolved') {
    return {
      report: {
        id: report.id,
        status: report.status,
        alreadyApplied: true,
      },
    }
  }

  const updatedReport = await reportRepository.upsert({
    ...report,
    status: 'resolved',
    updatedAt,
  })

  return {
    report: {
      id: updatedReport.id,
      status: updatedReport.status,
      alreadyApplied: false,
    },
  }
}

export function buildCreateModActionHandler(
  dependencies: CreateModActionHandlerDependencies = {},
) {
  const idFactory = dependencies.idFactory ?? randomUUID
  const now = dependencies.now ?? (() => new Date())
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const reportRepositoryFactory =
    dependencies.reportRepositoryFactory ?? (() => createReportRepository())
  const modActionRepositoryFactory =
    dependencies.modActionRepositoryFactory ??
    (() => createModActionRepository())
  const userRepositoryFactory =
    dependencies.userRepositoryFactory ?? (() => createUserRepository())
  const requestSchema = buildCreateModActionRequestSchema()

  async function createModActionHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const moderatorHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !moderatorHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated moderator must have an active profile before recording moderation actions.',
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
        errors: mapModActionValidationIssues(parsedBody.error.issues),
      })
    }

    const actionRequest = parsedBody.data
    const actionTimestamp = now()
    const updatedAt = actionTimestamp.toISOString()
    let targetSummary: ModerationTargetSummary
    let linkedReport: ModerationReportSummary | null = null

    try {
      switch (actionRequest.action) {
        case 'hidePost':
        case 'removePost': {
          let postStore: MutablePostStore

          try {
            postStore = postStoreFactory()
          } catch (error) {
            context.log('Failed to configure the post store.', {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown post store configuration error.',
            })

            return createErrorResponse(500, {
              code: 'server.configuration_error',
              message: 'The post store is not configured.',
            })
          }

          const post = await postStore.getPostById(actionRequest.targetId)
          if (post === null) {
            return createErrorResponse(404, {
              code: 'post_not_found',
              message: 'No post exists for the requested target id.',
              field: 'targetId',
            })
          }

          const currentModerationState = normalizeModerationState(
            post.moderationState,
          )
          if (
            actionRequest.action === 'hidePost' &&
            currentModerationState === 'removed'
          ) {
            return createErrorResponse(409, {
              code: 'mod_action_conflict',
              message: 'Removed posts cannot be hidden.',
              field: 'action',
            })
          }

          const nextModerationState =
            actionRequest.action === 'hidePost' ? 'hidden' : 'removed'
          const alreadyApplied = currentModerationState === nextModerationState

          if (!alreadyApplied) {
            await postStore.upsertPost({
              ...post,
              moderationState: nextModerationState,
              updatedAt,
            })
          }

          const linkedReportResult = await maybeResolveLinkedReport(
            actionRequest,
            reportRepositoryFactory,
            updatedAt,
          )
          if ('error' in linkedReportResult) {
            return linkedReportResult.error
          }

          linkedReport = linkedReportResult.report
          targetSummary = {
            id: post.id,
            type: getPostTargetType(post),
            alreadyApplied,
            moderationState: alreadyApplied
              ? currentModerationState
              : nextModerationState,
          }
          break
        }

        case 'suspendAccount': {
          let userRepository: MutableUserRepository

          try {
            userRepository = userRepositoryFactory()
          } catch (error) {
            context.log('Failed to configure the user repository.', {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown user repository configuration error.',
            })

            return createErrorResponse(500, {
              code: 'server.configuration_error',
              message: 'The user profile store is not configured.',
            })
          }

          const user = await userRepository.getById(actionRequest.targetId)
          if (user === null) {
            return createErrorResponse(404, {
              code: 'user_not_found',
              message: 'No user exists for the requested target id.',
              field: 'targetId',
            })
          }

          if (user.status === 'deleted') {
            return createErrorResponse(409, {
              code: 'mod_action_conflict',
              message: 'Deleted accounts cannot be suspended.',
              field: 'targetId',
            })
          }

          const alreadyApplied = user.status === 'suspended'
          if (!alreadyApplied) {
            await userRepository.upsert({
              ...user,
              status: 'suspended',
              updatedAt,
            })
          }

          const linkedReportResult = await maybeResolveLinkedReport(
            actionRequest,
            reportRepositoryFactory,
            updatedAt,
          )
          if ('error' in linkedReportResult) {
            return linkedReportResult.error
          }

          linkedReport = linkedReportResult.report
          targetSummary = {
            id: user.id,
            type: 'user',
            alreadyApplied,
            userStatus: alreadyApplied ? user.status : 'suspended',
          }
          break
        }

        case 'dismissReport': {
          let reportRepository: ReportRepository

          try {
            reportRepository = reportRepositoryFactory()
          } catch (error) {
            context.log('Failed to configure the report repository.', {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown report repository configuration error.',
            })

            return createErrorResponse(500, {
              code: 'server.configuration_error',
              message: 'The report store is not configured.',
            })
          }

          const report = await reportRepository.getById(actionRequest.targetId)
          if (report === null) {
            return createErrorResponse(404, {
              code: 'report_not_found',
              message: 'No report exists for the requested target id.',
              field: 'targetId',
            })
          }

          const alreadyApplied = report.status === 'resolved'
          if (!alreadyApplied) {
            await reportRepository.upsert({
              ...report,
              status: 'resolved',
              updatedAt,
            })
          }

          linkedReport = {
            id: report.id,
            status: alreadyApplied ? report.status : 'resolved',
            alreadyApplied,
          }
          targetSummary = {
            id: report.id,
            type: 'report',
            alreadyApplied,
            reportStatus: alreadyApplied ? report.status : 'resolved',
          }
          break
        }
      }

      let modActionRepository: ModActionRepository

      try {
        modActionRepository = modActionRepositoryFactory()
      } catch (error) {
        context.log('Failed to configure the moderation action repository.', {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown moderation action repository configuration error.',
        })

        return createErrorResponse(500, {
          code: 'server.configuration_error',
          message: 'The moderation action store is not configured.',
        })
      }

      const modAction = await modActionRepository.create(
        createModActionDocument(
          authenticatedUser,
          actionRequest,
          targetSummary.type,
          actionTimestamp,
          idFactory,
        ),
      )

      context.log('Created moderation action.', {
        action: actionRequest.action,
        moderatorId: authenticatedUser.id,
        modActionId: modAction.id,
        reportId: linkedReport?.id ?? actionRequest.reportId,
        targetId: targetSummary.id,
        targetType: targetSummary.type,
      })

      return createSuccessResponse(
        {
          modAction,
          target: targetSummary,
          report: linkedReport,
        },
        201,
      )
    } catch (error) {
      context.log('Failed to create the moderation action.', {
        action: actionRequest.action,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown moderation action error.',
        moderatorId: authenticatedUser.id,
        targetId: actionRequest.targetId,
      })

      return createErrorResponse(500, {
        code: 'server.mod_action_failed',
        message: 'Unable to record the moderation action.',
      })
    }
  }

  return withHttpAuth(createModActionHandler, {
    repositoryFactory: userRepositoryFactory,
    requiredRoles: ['moderator'],
  })
}

export const createModActionHandler = withRateLimit(
  buildCreateModActionHandler(),
  {
    endpointClass: 'moderation',
  },
)

export function registerCreateModActionFunction() {
  app.http('createModAction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mod/actions',
    handler: createModActionHandler,
  })
}
