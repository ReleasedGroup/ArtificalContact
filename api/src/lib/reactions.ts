import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'

export const DEFAULT_REACTIONS_CONTAINER_NAME = 'reactions'
export const DEFAULT_REACTION_VALUE_MAX_LENGTH = 2048
export const DEFAULT_EMOJI_VALUE_MAX_LENGTH = 128

let cachedReactionRepository: ReactionRepository | undefined

export type ReactionType = 'like' | 'dislike' | 'emoji' | 'gif'
export type ReactionSentiment = 'like' | 'dislike'

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
