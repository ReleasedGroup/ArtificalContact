import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'
import type { UserDocument } from './users.js'

export const DEFAULT_MOD_ACTIONS_CONTAINER_NAME = 'modActions'
export const DEFAULT_MOD_ACTION_NOTES_MAX_LENGTH = 2000

let cachedModActionRepository: ModActionRepository | undefined

export type ModActionType =
  | 'hidePost'
  | 'removePost'
  | 'suspendAccount'
  | 'dismissReport'

export type ModActionTargetType = 'post' | 'reply' | 'user' | 'report'

export interface ModActionDocument {
  id: string
  type: 'modAction'
  action: ModActionType
  targetType: ModActionTargetType
  targetId: string
  reportId: string | null
  moderatorId: string
  moderatorHandle: string
  notes: string | null
  createdAt: string
}

export interface CreateModActionRequest {
  action: ModActionType
  targetId: string
  reportId: string | null
  notes: string | null
}

export interface ModActionRepository {
  create(action: ModActionDocument): Promise<ModActionDocument>
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

function createModActionRepositoryForContainer(
  container: Container,
): ModActionRepository {
  return {
    async create(action) {
      const response = await container.items.create<ModActionDocument>(action)
      return response.resource ?? action
    },
  }
}

export function buildCreateModActionRequestSchema() {
  return z
    .object({
      action: z.enum([
        'hidePost',
        'removePost',
        'suspendAccount',
        'dismissReport',
      ]),
      targetId: z.preprocess(normalizeRequiredString, z.string().min(1)),
      reportId: z.preprocess(
        normalizeOptionalString,
        z.string().min(1).optional(),
      ),
      notes: z.preprocess(
        normalizeOptionalString,
        z.string().max(DEFAULT_MOD_ACTION_NOTES_MAX_LENGTH).optional(),
      ),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.action === 'dismissReport' && value.reportId !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'dismissReport uses targetId as the report id; omit reportId.',
          path: ['reportId'],
        })
      }
    })
    .transform(
      (value): CreateModActionRequest => ({
        action: value.action,
        targetId: value.targetId,
        reportId: value.reportId ?? null,
        notes: value.notes ?? null,
      }),
    )
}

export function mapModActionValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_mod_action',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function createModActionDocument(
  moderator: UserDocument,
  request: CreateModActionRequest,
  targetType: ModActionTargetType,
  createdAt: Date,
  idFactory: () => string,
): ModActionDocument {
  return {
    id: idFactory(),
    type: 'modAction',
    action: request.action,
    targetType,
    targetId: request.targetId,
    reportId: request.reportId,
    moderatorId: moderator.id,
    moderatorHandle: moderator.handle ?? moderator.handleLower ?? '',
    notes: request.notes,
    createdAt: createdAt.toISOString(),
  }
}

export function createModActionRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): ModActionRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve moderation actions.')
  }

  const modActionsContainerName =
    readOptionalValue(env.MOD_ACTIONS_CONTAINER_NAME) ??
    DEFAULT_MOD_ACTIONS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(modActionsContainerName)

  return createModActionRepositoryForContainer(container)
}

export function createModActionRepository(): ModActionRepository {
  cachedModActionRepository ??= createModActionRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedModActionRepository
}
