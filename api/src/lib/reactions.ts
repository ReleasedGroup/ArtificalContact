import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'

export const DEFAULT_REACTIONS_CONTAINER_NAME = 'reactions'
export const DEFAULT_REACTION_VALUE_MAX_LENGTH = 2048
export const DEFAULT_EMOJI_VALUE_MAX_LENGTH = 128

let cachedReactionRepository: MutableReactionRepository | undefined

export type ReactionType = 'like' | 'dislike' | 'emoji' | 'gif'
export type ReactionSentiment = 'like' | 'dislike'
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

export type CreateReactionRequest =
  | { type: 'like' }
  | { type: 'dislike' }
  | { type: 'emoji'; value: string }
  | { type: 'gif'; value: string }

export interface ReactionPolicy {
  allowEmojiWithSentiment: boolean
  allowGifWithSentiment: boolean
  allowGifWithEmoji: boolean
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

export const DEFAULT_REACTION_POLICY: ReactionPolicy = {
  allowEmojiWithSentiment: true,
  allowGifWithSentiment: true,
  allowGifWithEmoji: true,
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function toUniqueReactionValues(values: readonly string[]): string[] {
  return [...new Set(values)]
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

  const nextReaction: ReactionDocument = {
    ...baseReaction,
    emojiValues: [...baseReaction.emojiValues],
  }

  let changed = existingReaction === null

  if (
    request.type === 'emoji' &&
    nextReaction.sentiment !== null &&
    !policy.allowEmojiWithSentiment
  ) {
    throw new Error('Emoji reactions cannot be combined with like or dislike.')
  }

  if (
    request.type === 'gif' &&
    nextReaction.sentiment !== null &&
    !policy.allowGifWithSentiment
  ) {
    throw new Error('GIF reactions cannot be combined with like or dislike.')
  }

  if (
    request.type === 'gif' &&
    nextReaction.emojiValues.length > 0 &&
    !policy.allowGifWithEmoji
  ) {
    throw new Error('GIF reactions cannot be combined with emoji reactions.')
  }

  switch (request.type) {
    case 'like':
    case 'dislike': {
      if (nextReaction.sentiment !== request.type) {
        nextReaction.sentiment = request.type
        changed = true
      }
      break
    }
    case 'emoji': {
      if (!nextReaction.emojiValues.includes(request.value)) {
        nextReaction.emojiValues = toUniqueReactionValues([
          ...nextReaction.emojiValues,
          request.value,
        ])
        changed = true
      }
      break
    }
    case 'gif': {
      if (nextReaction.gifValue !== request.value) {
        nextReaction.gifValue = request.value
        changed = true
      }
      break
    }
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
