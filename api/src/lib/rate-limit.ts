import type { Container } from '@azure/cosmos'
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions'
import { createJsonEnvelopeResponse } from './api-envelope.js'
import { resolveAuthenticatedPrincipal } from './auth.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import type { HttpHandler } from './http-auth.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

export const DEFAULT_RATE_LIMITS_CONTAINER_NAME = 'rateLimits'
const DEFAULT_RATE_LIMIT_BUCKET_TTL_BUFFER_SECONDS = 60
const DEFAULT_RATE_LIMIT_CONCURRENCY_RETRY_COUNT = 5

export type RateLimitEndpointClass =
  | 'profile'
  | 'posts'
  | 'reactions'
  | 'follows'
  | 'notifications'
  | 'media'
  | 'moderation'
  | 'reports'

export interface RateLimitPolicy {
  capacity: number
  refillPerMinute: number
}

export interface RateLimitBucketDocument {
  id: string
  type: 'rateLimitBucket'
  userId: string
  endpointClass: RateLimitEndpointClass
  capacity: number
  refillPerMinute: number
  tokens: number
  lastRefillAt: string
  createdAt: string
  updatedAt: string
  ttl: number
  _etag?: string
}

export interface RateLimitConsumeRequest {
  userId: string
  endpointClass: RateLimitEndpointClass
  now: Date
  policy: RateLimitPolicy
  tokenCost?: number
}

export type RateLimitConsumeResult =
  | {
      allowed: true
      remainingTokens: number
      retryAfterSeconds: 0
    }
  | {
      allowed: false
      remainingTokens: number
      retryAfterSeconds: number
    }

export interface RateLimitRepository {
  consumeToken(
    request: RateLimitConsumeRequest,
  ): Promise<RateLimitConsumeResult>
}

export type EvaluatedRateLimitBucket =
  | {
      allowed: true
      availableTokens: number
      remainingTokens: number
      retryAfterSeconds: 0
    }
  | {
      allowed: false
      availableTokens: number
      remainingTokens: number
      retryAfterSeconds: number
    }

export interface RateLimitOptions {
  endpointClass: RateLimitEndpointClass
  now?: () => Date
  policy?: RateLimitPolicy
  repositoryFactory?: () => RateLimitRepository
  tokenCost?: number
}

const DEFAULT_RATE_LIMIT_POLICIES: Record<
  RateLimitEndpointClass,
  RateLimitPolicy
> = {
  profile: {
    capacity: 10,
    refillPerMinute: 10,
  },
  posts: {
    capacity: 6,
    refillPerMinute: 6,
  },
  reactions: {
    capacity: 30,
    refillPerMinute: 30,
  },
  follows: {
    capacity: 20,
    refillPerMinute: 20,
  },
  notifications: {
    capacity: 20,
    refillPerMinute: 20,
  },
  media: {
    capacity: 10,
    refillPerMinute: 10,
  },
  moderation: {
    capacity: 20,
    refillPerMinute: 20,
  },
  reports: {
    capacity: 5,
    refillPerMinute: 5,
  },
}

let cachedRateLimitRepository: RateLimitRepository | undefined

function getErrorStatusCode(error: unknown): number | undefined {
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

function isExpectedCosmosStatusCode(error: unknown, statusCode: number): boolean {
  return getErrorStatusCode(error) === statusCode
}

function readPositiveInteger(
  value: string | undefined,
  defaultValue: number,
): number {
  const normalizedValue = readOptionalValue(value)
  if (normalizedValue === undefined) {
    return defaultValue
  }

  const parsedValue = Number.parseInt(normalizedValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return defaultValue
  }

  return parsedValue
}

function roundTokenCount(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function assertValidRateLimitPolicy(
  policy: RateLimitPolicy,
  tokenCost: number,
): void {
  if (!Number.isFinite(policy.capacity) || policy.capacity <= 0) {
    throw new Error('Rate limit capacity must be a positive number.')
  }

  if (
    !Number.isFinite(policy.refillPerMinute) ||
    policy.refillPerMinute <= 0
  ) {
    throw new Error('Rate limit refillPerMinute must be a positive number.')
  }

  if (!Number.isFinite(tokenCost) || tokenCost <= 0) {
    throw new Error('Rate limit tokenCost must be a positive number.')
  }

  if (policy.capacity < tokenCost) {
    throw new Error(
      'Rate limit capacity must be greater than or equal to tokenCost.',
    )
  }
}

function getPolicyEnvironmentPrefix(
  endpointClass: RateLimitEndpointClass,
): string {
  return endpointClass.toUpperCase()
}

export function resolveRateLimitPolicy(
  endpointClass: RateLimitEndpointClass,
  env: NodeJS.ProcessEnv = process.env,
): RateLimitPolicy {
  const defaults = DEFAULT_RATE_LIMIT_POLICIES[endpointClass]
  const prefix = getPolicyEnvironmentPrefix(endpointClass)

  return {
    capacity: readPositiveInteger(
      env[`RATE_LIMIT_${prefix}_CAPACITY`],
      defaults.capacity,
    ),
    refillPerMinute: readPositiveInteger(
      env[`RATE_LIMIT_${prefix}_REFILL_PER_MINUTE`],
      defaults.refillPerMinute,
    ),
  }
}

export function buildRateLimitBucketId(
  userId: string,
  endpointClass: RateLimitEndpointClass,
): string {
  return `${userId}:${endpointClass}`
}

export function calculateRateLimitBucketTtlSeconds(
  policy: RateLimitPolicy,
  remainingTokens: number,
): number {
  const clampedRemainingTokens = Math.max(
    0,
    Math.min(policy.capacity, remainingTokens),
  )
  const missingTokens = policy.capacity - clampedRemainingTokens
  const secondsUntilFull =
    missingTokens <= 0
      ? 0
      : Math.ceil((missingTokens / policy.refillPerMinute) * 60)

  return Math.max(
    DEFAULT_RATE_LIMIT_BUCKET_TTL_BUFFER_SECONDS,
    secondsUntilFull + DEFAULT_RATE_LIMIT_BUCKET_TTL_BUFFER_SECONDS,
  )
}

export function evaluateRateLimitBucket(
  bucket: Pick<RateLimitBucketDocument, 'lastRefillAt' | 'tokens'>,
  policy: RateLimitPolicy,
  now: Date,
  tokenCost = 1,
): EvaluatedRateLimitBucket {
  assertValidRateLimitPolicy(policy, tokenCost)

  const elapsedMilliseconds = Math.max(
    0,
    now.getTime() - Date.parse(bucket.lastRefillAt),
  )
  const refilledTokens =
    bucket.tokens + (elapsedMilliseconds / 60_000) * policy.refillPerMinute
  const availableTokens = roundTokenCount(
    Math.min(policy.capacity, Math.max(0, refilledTokens)),
  )

  if (availableTokens >= tokenCost) {
    return {
      allowed: true,
      availableTokens,
      remainingTokens: roundTokenCount(availableTokens - tokenCost),
      retryAfterSeconds: 0,
    }
  }

  return {
    allowed: false,
    availableTokens,
    remainingTokens: availableTokens,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(((tokenCost - availableTokens) / policy.refillPerMinute) * 60),
    ),
  }
}

function createInitialBucket(
  request: RateLimitConsumeRequest,
  tokenCost: number,
): RateLimitBucketDocument {
  const timestamp = request.now.toISOString()
  const remainingTokens = roundTokenCount(request.policy.capacity - tokenCost)

  return {
    id: buildRateLimitBucketId(request.userId, request.endpointClass),
    type: 'rateLimitBucket',
    userId: request.userId,
    endpointClass: request.endpointClass,
    capacity: request.policy.capacity,
    refillPerMinute: request.policy.refillPerMinute,
    tokens: remainingTokens,
    lastRefillAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ttl: calculateRateLimitBucketTtlSeconds(request.policy, remainingTokens),
  }
}

function createCosmosRateLimitRepository(
  container: Container,
): RateLimitRepository {
  return {
    async consumeToken(
      request: RateLimitConsumeRequest,
    ): Promise<RateLimitConsumeResult> {
      const tokenCost = request.tokenCost ?? 1
      assertValidRateLimitPolicy(request.policy, tokenCost)

      for (
        let attempt = 0;
        attempt < DEFAULT_RATE_LIMIT_CONCURRENCY_RETRY_COUNT;
        attempt += 1
      ) {
        const bucketId = buildRateLimitBucketId(
          request.userId,
          request.endpointClass,
        )
        const item = container.item(bucketId, request.userId)

        let existingBucket: RateLimitBucketDocument | null = null

        try {
          const response =
            await item.read<RateLimitBucketDocument>()
          existingBucket = response.resource ?? null
        } catch (error) {
          if (!isExpectedCosmosStatusCode(error, 404)) {
            throw error
          }
        }

        if (existingBucket === null) {
          const initialBucket = createInitialBucket(request, tokenCost)

          try {
            await container.items.create<RateLimitBucketDocument>(initialBucket)
            return {
              allowed: true,
              remainingTokens: initialBucket.tokens,
              retryAfterSeconds: 0,
            }
          } catch (error) {
            if (isExpectedCosmosStatusCode(error, 409)) {
              continue
            }

            throw error
          }
        }

        const evaluation = evaluateRateLimitBucket(
          existingBucket,
          request.policy,
          request.now,
          tokenCost,
        )

        if (!evaluation.allowed) {
          return evaluation
        }

        const timestamp = request.now.toISOString()
        const updatedBucket: RateLimitBucketDocument = {
          ...existingBucket,
          capacity: request.policy.capacity,
          refillPerMinute: request.policy.refillPerMinute,
          tokens: evaluation.remainingTokens,
          lastRefillAt: timestamp,
          updatedAt: timestamp,
          ttl: calculateRateLimitBucketTtlSeconds(
            request.policy,
            evaluation.remainingTokens,
          ),
        }

        try {
          await item.replace(updatedBucket, {
            accessCondition: {
              type: 'IfMatch',
              condition: existingBucket._etag ?? '',
            },
          })

          return {
            allowed: true,
            remainingTokens: evaluation.remainingTokens,
            retryAfterSeconds: 0,
          }
        } catch (error) {
          if (
            isExpectedCosmosStatusCode(error, 409) ||
            isExpectedCosmosStatusCode(error, 412)
          ) {
            continue
          }

          throw error
        }
      }

      throw new Error(
        'Rate limit bucket update could not be completed after repeated retries.',
      )
    },
  }
}

export function createRateLimitRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): RateLimitRepository {
  const databaseName = config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
  const rateLimitsContainerName =
    readOptionalValue(env.RATE_LIMITS_CONTAINER_NAME) ??
    DEFAULT_RATE_LIMITS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(databaseName)
    .container(rateLimitsContainerName)

  return createCosmosRateLimitRepository(container)
}

export function createRateLimitRepository(): RateLimitRepository {
  cachedRateLimitRepository ??= createRateLimitRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedRateLimitRepository
}

function resolveRateLimitSubject(
  request: HttpRequest,
  context: InvocationContext,
): string | null {
  const resolvedSubject =
    context.auth?.user?.id ?? context.auth?.principal?.subject ?? null

  if (resolvedSubject) {
    return resolvedSubject
  }

  const principalResult = resolveAuthenticatedPrincipal(request)
  return principalResult.ok ? principalResult.principal.subject : null
}

function createRateLimitedResponse(
  endpointClass: RateLimitEndpointClass,
  retryAfterSeconds: number,
): HttpResponseInit {
  return createJsonEnvelopeResponse(
    429,
    {
      data: null,
      errors: [
        {
          code: 'rate_limit.exceeded',
          message: `Too many ${endpointClass} write requests. Retry later.`,
        },
      ],
    },
    {
      'retry-after': String(retryAfterSeconds),
    },
  )
}

export function withRateLimit(
  handler: HttpHandler,
  options: RateLimitOptions,
): HttpHandler {
  const now = options.now ?? (() => new Date())
  const tokenCost = options.tokenCost ?? 1
  const repositoryFactory =
    options.repositoryFactory ?? createRateLimitRepository
  let cachedRepository: RateLimitRepository | undefined

  function getRepository(): RateLimitRepository {
    cachedRepository ??= repositoryFactory()
    return cachedRepository
  }

  return async function rateLimitedHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const subject = resolveRateLimitSubject(request, context)
    if (subject === null) {
      return handler(request, context)
    }

    const policy = options.policy ?? resolveRateLimitPolicy(options.endpointClass)

    let repository: RateLimitRepository

    try {
      repository = getRepository()
    } catch (error) {
      context.log('Failed to configure the rate limit repository.', {
        endpointClass: options.endpointClass,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown rate limit repository configuration error.',
      })

      return createJsonEnvelopeResponse(500, {
        data: null,
        errors: [
          {
            code: 'server.configuration_error',
            message: 'The rate limit store is not configured.',
          },
        ],
      })
    }

    try {
      const result = await repository.consumeToken({
        userId: subject,
        endpointClass: options.endpointClass,
        now: now(),
        policy,
        tokenCost,
      })

      if (!result.allowed) {
        context.log('Rate limit rejected the request.', {
          endpointClass: options.endpointClass,
          retryAfterSeconds: result.retryAfterSeconds,
          userId: subject,
        })

        return createRateLimitedResponse(
          options.endpointClass,
          result.retryAfterSeconds,
        )
      }
    } catch (error) {
      context.log('Failed to evaluate the rate limit bucket.', {
        endpointClass: options.endpointClass,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown rate limit evaluation error.',
        userId: subject,
      })

      return createJsonEnvelopeResponse(500, {
        data: null,
        errors: [
          {
            code: 'server.rate_limit_failed',
            message: 'Unable to evaluate the request rate limit.',
          },
        ],
      })
    }

    return handler(request, context)
  }
}
