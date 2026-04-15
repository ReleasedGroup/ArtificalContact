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
  type ReactionType,
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

let cachedReactionRepository: MutableReactionRepository | undefined

export type ReactionListType = ReactionType | 'all'
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

export interface ReactionDeletionResult {
  changed: boolean
  deleted: boolean
  reaction: ReactionDocument | null
  emojiValueRemoved: boolean
}

export interface ReactionRepository {
  getByPostAndUser(
    postId: string,
    userId: string,
  ): Promise<ReactionDocument | null>
  create(reaction: ReactionDocument): Promise<ReactionDocument>
  upsert(reaction: ReactionDocument): Promise<ReactionDocument>
  deleteByPostAndUser(postId: string, userId: string): Promise<void>
}

export interface ReactionListRepository {
  listByPostId(
    postId: string,
    options: {
      limit: number
      continuationToken?: string
      type?: ReactionListType
    },
  ): Promise<{
    reactions: ReactionDocument[]
    continuationToken?: string
  }>
}

export type MutableReactionRepository = ReactionRepository &
  ReactionListRepository

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
): MutableReactionRepository {
  function buildListQuery(type: ReactionListType) {
    const parameters: Array<{ name: string; value: string }> = [
      { name: '@type', value: 'reaction' },
    ]

    let filterClause = ''

    switch (type) {
      case 'like':
      case 'dislike':
        filterClause = ' AND c.sentiment = @reactionSentiment'
        parameters.push({
          name: '@reactionSentiment',
          value: type,
        })
        break
      case 'emoji':
        filterClause = ' AND ARRAY_LENGTH(c.emojiValues) > 0'
        break
      case 'gif':
        filterClause = ' AND IS_DEFINED(c.gifValue) AND NOT IS_NULL(c.gifValue)'
        break
      case 'all':
      default:
        break
    }

    return {
      query: `
        SELECT * FROM c
        WHERE c.type = @type${filterClause}
        ORDER BY c.updatedAt DESC, c.id DESC
      `,
      parameters,
    }
  }

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
    async listByPostId(postId, options) {
      const queryIterator = container.items.query<ReactionDocument>(
        buildListQuery(options.type ?? 'all'),
        {
          partitionKey: postId,
          maxItemCount: options.limit,
          enableQueryControl: true,
          ...(options.continuationToken === undefined
            ? {}
            : { continuationToken: options.continuationToken }),
        },
      )

      const { resources, continuationToken } = await queryIterator.fetchNext()

      return {
        reactions: resources ?? [],
        ...(continuationToken === undefined ? {} : { continuationToken }),
      }
    },
    async deleteByPostAndUser(postId, userId) {
      const id = buildReactionDocumentId(postId, userId)

      try {
        await container.item(id, postId).delete()
      } catch (error) {
        if (isExpectedCosmosStatusCode(error, 404)) {
          return
        }

        throw error
      }
    },
  }
}

export function createReactionRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): MutableReactionRepository {
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

export function createReactionRepository(): MutableReactionRepository {
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

export function isReactionDocumentEmpty(reaction: ReactionDocument): boolean {
  return (
    reaction.sentiment === null &&
    reaction.emojiValues.length === 0 &&
    reaction.gifValue === null
  )
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

export function applyReactionDeletion(
  existingReaction: ReactionDocument | null,
  options: {
    now: Date
    emojiValue?: string
  },
): ReactionDeletionResult {
  if (existingReaction === null) {
    return {
      changed: false,
      deleted: false,
      reaction: null,
      emojiValueRemoved: false,
    }
  }

  if (options.emojiValue === undefined) {
    return {
      changed: true,
      deleted: true,
      reaction: null,
      emojiValueRemoved: false,
    }
  }

  if (!existingReaction.emojiValues.includes(options.emojiValue)) {
    return {
      changed: false,
      deleted: false,
      reaction: existingReaction,
      emojiValueRemoved: false,
    }
  }

  const nextReaction: ReactionDocument = {
    ...existingReaction,
    emojiValues: existingReaction.emojiValues.filter(
      (value) => value !== options.emojiValue,
    ),
    updatedAt: options.now.toISOString(),
  }

  if (isReactionDocumentEmpty(nextReaction)) {
    return {
      changed: true,
      deleted: true,
      reaction: null,
      emojiValueRemoved: true,
    }
  }

  return {
    changed: true,
    deleted: false,
    reaction: nextReaction,
    emojiValueRemoved: true,
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
