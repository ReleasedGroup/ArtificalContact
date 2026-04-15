import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  applyReactionRequestToState,
  DEFAULT_REACTION_POLICY,
  type CreateReactionRequest,
  type ReactionPolicy,
  type ReactionSentiment,
} from './reaction-rules.js'
import { readOptionalValue } from './strings.js'

export {
  DEFAULT_REACTION_POLICY,
  ReactionPolicyConflictError,
} from './reaction-rules.js'
export type {
  ApplyReactionPlan,
  CreateReactionRequest,
  ReactionPolicy,
  ReactionPolicyConfig,
  ReactionSelection,
  ReactionSentiment,
  ReactionState,
  ReactionType,
  RemoveReactionPlan,
  RemoveReactionRequest,
} from './reaction-rules.js'

export const DEFAULT_REACTIONS_CONTAINER_NAME = 'reactions'
export const DEFAULT_REACTION_VALUE_MAX_LENGTH = 2048
export const DEFAULT_EMOJI_VALUE_MAX_LENGTH = 128

let cachedReactionRepository: ReactionRepository | undefined

export interface ReactionDocument {
  id: string
  type: 'reaction'
  postId: string
  userId: string
  sentiment: ReactionSentiment | null
  emojiValues: string[]
  gifValue: string | null
  createdAt: string
  updatedAt: string
}

export interface ReactionMutationResult {
  created: boolean
  changed: boolean
  reaction: ReactionDocument
}

export interface ReactionRepository {
  getByPostAndUser(
    postId: string,
    userId: string,
  ): Promise<ReactionDocument | null>
  create(reaction: ReactionDocument): Promise<ReactionDocument>
  upsert(reaction: ReactionDocument): Promise<ReactionDocument>
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function buildReactionRequestBaseSchema() {
  return z
    .object({
      type: z.enum(['like', 'dislike', 'emoji', 'gif']),
      value: z.preprocess(
        normalizeOptionalString,
        z.string().max(DEFAULT_REACTION_VALUE_MAX_LENGTH).optional(),
      ),
    })
    .strict()
}

export function buildCreateReactionRequestSchema() {
  return buildReactionRequestBaseSchema()
    .superRefine((value, context) => {
      if (value.type === 'emoji') {
        if (!value.value) {
          context.addIssue({
            code: 'custom',
            message: 'Emoji reactions require a value.',
            path: ['value'],
          })
          return
        }

        if (value.value.length > DEFAULT_EMOJI_VALUE_MAX_LENGTH) {
          context.addIssue({
            code: 'custom',
            message: `Emoji reactions must be ${DEFAULT_EMOJI_VALUE_MAX_LENGTH} characters or fewer.`,
            path: ['value'],
          })
        }

        return
      }

      if (value.type === 'gif') {
        if (!value.value) {
          context.addIssue({
            code: 'custom',
            message: 'GIF reactions require a value.',
            path: ['value'],
          })
        }

        return
      }

      if (value.value !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Like and dislike reactions do not accept a value.',
          path: ['value'],
        })
      }
    })
    .transform((value): CreateReactionRequest => {
      if (value.type === 'emoji' || value.type === 'gif') {
        return {
          type: value.type,
          value: value.value!,
        }
      }

      return {
        type: value.type,
      }
    })
}

export function mapReactionValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_reaction',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function buildReactionDocumentId(
  postId: string,
  userId: string,
): string {
  return `${postId}:${userId}`
}

function createReactionRepositoryForContainer(
  container: Container,
): ReactionRepository {
  return {
    async getByPostAndUser(postId, userId) {
      const id = buildReactionDocumentId(postId, userId)

      try {
        const response = await container
          .item(id, postId)
          .read<ReactionDocument>()
        return response.resource ?? null
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return null
        }

        throw error
      }
    },
    async create(reaction) {
      const response = await container.items.create<ReactionDocument>(reaction)
      return response.resource ?? reaction
    },
    async upsert(reaction) {
      const response = await container.items.upsert<ReactionDocument>(reaction)
      return response.resource ?? reaction
    },
  }
}

export function createReactionRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): ReactionRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve reactions.')
  }

  const reactionsContainerName =
    readOptionalValue(env.REACTIONS_CONTAINER_NAME) ??
    DEFAULT_REACTIONS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(reactionsContainerName)

  return createReactionRepositoryForContainer(container)
}

export function createReactionRepository(): ReactionRepository {
  cachedReactionRepository ??= createReactionRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedReactionRepository
}

function createBaseReactionDocument(
  postId: string,
  userId: string,
  now: Date,
): ReactionDocument {
  const timestamp = now.toISOString()

  return {
    id: buildReactionDocumentId(postId, userId),
    type: 'reaction',
    postId,
    userId,
    sentiment: null,
    emojiValues: [],
    gifValue: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function applyReactionMutation(
  existingReaction: ReactionDocument | null,
  request: CreateReactionRequest,
  options: {
    postId: string
    userId: string
    now: Date
    policy?: ReactionPolicy
  },
): ReactionMutationResult {
  const policy = options.policy ?? DEFAULT_REACTION_POLICY
  const baseReaction =
    existingReaction ??
    createBaseReactionDocument(options.postId, options.userId, options.now)

  const plan = applyReactionRequestToState(
    {
      sentiment: baseReaction.sentiment,
      emojiValues: baseReaction.emojiValues,
      gifValue: baseReaction.gifValue,
    },
    request,
    policy,
  )

  const changed = existingReaction === null || plan.changed
  const nextReaction: ReactionDocument = {
    ...baseReaction,
    sentiment: plan.nextState.sentiment,
    emojiValues: [...plan.nextState.emojiValues],
    gifValue: plan.nextState.gifValue,
  }

  if (changed) {
    nextReaction.updatedAt = options.now.toISOString()
  }

  return {
    created: existingReaction === null,
    changed,
    reaction: nextReaction,
  }
}

export function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const record = error as Record<string, unknown>
  const statusCode = record.statusCode
  if (typeof statusCode === 'number') {
    return statusCode
  }

  const code = record.code
  if (typeof code === 'number') {
    return code
  }

  if (typeof code === 'string') {
    const parsedValue = Number.parseInt(code, 10)
    return Number.isNaN(parsedValue) ? undefined : parsedValue
  }

  return undefined
}

function isExpectedCosmosStatusCode(
  error: unknown,
  statusCode: number,
): boolean {
  return getErrorStatusCode(error) === statusCode
}
