import type { Container, SqlQuerySpec } from '@azure/cosmos'
import {
  type AdminMetricsActiveUserBucketRecord,
  type AdminMetricsBucket,
  type AdminMetricsCountBucketRecord,
  type AdminMetricsReadStore,
  type AdminMetricsReportRecord,
} from './admin-metrics.js'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from './follows.js'
import { DEFAULT_POSTS_CONTAINER_NAME } from './posts.js'
import { DEFAULT_REACTIONS_CONTAINER_NAME } from './reactions.js'
import { DEFAULT_REPORTS_CONTAINER_NAME } from './reports.js'
import { readOptionalValue } from './strings.js'

const DEFAULT_USERS_CONTAINER_NAME = 'users'

let cachedAdminMetricsStore: CosmosAdminMetricsStore | undefined

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getBucketPrefixLength(bucket: AdminMetricsBucket): number {
  return bucket === 'hour' ? 13 : 10
}

async function fetchScalarValue<T>(
  container: Container,
  querySpec: SqlQuerySpec,
): Promise<T | undefined> {
  const response = await container.items
    .query<T>(querySpec, {
      enableQueryControl: true,
      maxItemCount: 1,
    })
    .fetchNext()

  return response.resources?.[0]
}

async function fetchCountValue(
  container: Container,
  querySpec: SqlQuerySpec,
): Promise<number> {
  return toCount(await fetchScalarValue<number>(container, querySpec))
}

async function fetchRows<T>(
  container: Container,
  querySpec: SqlQuerySpec,
): Promise<T[]> {
  const queryIterator = container.items.query<T>(querySpec, {
    enableQueryControl: true,
  })
  const rows: T[] = []

  while (queryIterator.hasMoreResults()) {
    const response = await queryIterator.fetchNext()
    rows.push(...(response.resources ?? []))
  }

  return rows
}

function createCountWindowQuery(
  occurredAtFieldName: string,
  start: Date,
  end: Date,
  extraFilter = '',
  extraParameters: Array<{ name: string; value: string }> = [],
): SqlQuerySpec {
  return {
    query: `
      SELECT VALUE COUNT(1)
      FROM c
      WHERE ${occurredAtFieldName} >= @start
        AND ${occurredAtFieldName} < @end${extraFilter}
    `,
    parameters: [
      { name: '@start', value: start.toISOString() },
      { name: '@end', value: end.toISOString() },
      ...extraParameters,
    ],
  }
}

function createDistinctActorWindowQuery(
  userFieldName: string,
  occurredAtFieldName: string,
  start: Date,
  end: Date,
  extraFilter = '',
  extraParameters: Array<{ name: string; value: string }> = [],
): SqlQuerySpec {
  return {
    query: `
      SELECT DISTINCT VALUE ${userFieldName}
      FROM c
      WHERE ${occurredAtFieldName} >= @start
        AND ${occurredAtFieldName} < @end
        AND IS_DEFINED(${userFieldName})
        AND NOT IS_NULL(${userFieldName})${extraFilter}
    `,
    parameters: [
      { name: '@start', value: start.toISOString() },
      { name: '@end', value: end.toISOString() },
      ...extraParameters,
    ],
  }
}

function createBucketedCountQuery(
  occurredAtFieldName: string,
  bucket: AdminMetricsBucket,
  start: Date,
  end: Date,
  extraFilter = '',
  extraParameters: Array<{ name: string; value: string }> = [],
): SqlQuerySpec {
  const prefixLength = getBucketPrefixLength(bucket)
  const bucketExpression = `SUBSTRING(${occurredAtFieldName}, 0, ${prefixLength})`

  return {
    query: `
      SELECT ${bucketExpression} AS bucketKey, COUNT(1) AS count
      FROM c
      WHERE ${occurredAtFieldName} >= @start
        AND ${occurredAtFieldName} < @end${extraFilter}
      GROUP BY ${bucketExpression}
    `,
    parameters: [
      { name: '@start', value: start.toISOString() },
      { name: '@end', value: end.toISOString() },
      ...extraParameters,
    ],
  }
}

function createBucketedDistinctActorQuery(
  userFieldName: string,
  occurredAtFieldName: string,
  bucket: AdminMetricsBucket,
  start: Date,
  end: Date,
  extraFilter = '',
  extraParameters: Array<{ name: string; value: string }> = [],
): SqlQuerySpec {
  const prefixLength = getBucketPrefixLength(bucket)
  const bucketExpression = `SUBSTRING(${occurredAtFieldName}, 0, ${prefixLength})`

  return {
    query: `
      SELECT ${bucketExpression} AS bucketKey, ${userFieldName} AS userId
      FROM c
      WHERE ${occurredAtFieldName} >= @start
        AND ${occurredAtFieldName} < @end
        AND IS_DEFINED(${userFieldName})
        AND NOT IS_NULL(${userFieldName})${extraFilter}
      GROUP BY ${bucketExpression}, ${userFieldName}
    `,
    parameters: [
      { name: '@start', value: start.toISOString() },
      { name: '@end', value: end.toISOString() },
      ...extraParameters,
    ],
  }
}

export class CosmosAdminMetricsStore implements AdminMetricsReadStore {
  constructor(
    private readonly usersContainer: Container,
    private readonly postsContainer: Container,
    private readonly reactionsContainer: Container,
    private readonly followsContainer: Container,
    private readonly reportsContainer: Container,
  ) {}

  static fromEnvironment(): CosmosAdminMetricsStore {
    const config = getEnvironmentConfig()
    const databaseName = readOptionalValue(config.cosmosDatabaseName)

    if (!databaseName) {
      throw new Error('COSMOS_DATABASE_NAME is required to resolve admin metrics.')
    }

    const client = createCosmosClient(config)
    const database = client.database(databaseName)

    return new CosmosAdminMetricsStore(
      database.container(
        readOptionalValue(process.env.USERS_CONTAINER_NAME) ??
          DEFAULT_USERS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
          DEFAULT_POSTS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.REACTIONS_CONTAINER_NAME) ??
          DEFAULT_REACTIONS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.FOLLOWS_CONTAINER_NAME) ??
          DEFAULT_FOLLOWS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.REPORTS_CONTAINER_NAME) ??
          DEFAULT_REPORTS_CONTAINER_NAME,
      ),
    )
  }

  countRegistrations(start: Date, end: Date): Promise<number> {
    return fetchCountValue(
      this.usersContainer,
      createCountWindowQuery(
        'c.createdAt',
        start,
        end,
        `
        AND (
          NOT IS_DEFINED(c.type)
          OR IS_NULL(c.type)
          OR c.type = @type
        )
      `,
        [{ name: '@type', value: 'user' }],
      ),
    )
  }

  countPosts(start: Date, end: Date): Promise<number> {
    return fetchCountValue(
      this.postsContainer,
      createCountWindowQuery(
        'c.createdAt',
        start,
        end,
        `
        AND (
          c.type = @postType
          OR c.type = @replyType
        )
        AND (
          NOT IS_DEFINED(c.kind)
          OR IS_NULL(c.kind)
          OR c.kind = @kind
        )
      `,
        [
          { name: '@postType', value: 'post' },
          { name: '@replyType', value: 'reply' },
          { name: '@kind', value: 'user' },
        ],
      ),
    )
  }

  async listActiveUsers(start: Date, end: Date): Promise<string[]> {
    const [registrations, posts, reactions, follows, reports] =
      await Promise.all([
        fetchRows<string>(
          this.usersContainer,
          createDistinctActorWindowQuery(
            'c.id',
            'c.createdAt',
            start,
            end,
            `
            AND (
              NOT IS_DEFINED(c.type)
              OR IS_NULL(c.type)
              OR c.type = @type
            )
          `,
            [{ name: '@type', value: 'user' }],
          ),
        ),
        fetchRows<string>(
          this.postsContainer,
          createDistinctActorWindowQuery(
            'c.authorId',
            'c.createdAt',
            start,
            end,
            `
            AND (
              c.type = @postType
              OR c.type = @replyType
            )
            AND (
              NOT IS_DEFINED(c.kind)
              OR IS_NULL(c.kind)
              OR c.kind = @kind
            )
          `,
            [
              { name: '@postType', value: 'post' },
              { name: '@replyType', value: 'reply' },
              { name: '@kind', value: 'user' },
            ],
          ),
        ),
        fetchRows<string>(
          this.reactionsContainer,
          createDistinctActorWindowQuery(
            'c.userId',
            'c.updatedAt',
            start,
            end,
            `
            AND c.type = @type
          `,
            [{ name: '@type', value: 'reaction' }],
          ),
        ),
        fetchRows<string>(
          this.followsContainer,
          createDistinctActorWindowQuery(
            'c.followerId',
            'c.createdAt',
            start,
            end,
            `
            AND c.type = @type
          `,
            [{ name: '@type', value: 'follow' }],
          ),
        ),
        fetchRows<string>(
          this.reportsContainer,
          createDistinctActorWindowQuery(
            'c.reporterId',
            'c.createdAt',
            start,
            end,
            `
            AND (
              NOT IS_DEFINED(c.type)
              OR IS_NULL(c.type)
              OR c.type = @type
            )
          `,
            [{ name: '@type', value: 'report' }],
          ),
        ),
      ])

    return [
      ...new Set(
        [...registrations, ...posts, ...reactions, ...follows, ...reports]
          .map((value) => toTrimmedString(value))
          .filter((value): value is string => value !== null),
      ),
    ]
  }

  listRegistrationBuckets(
    start: Date,
    end: Date,
    bucket: AdminMetricsBucket,
  ): Promise<AdminMetricsCountBucketRecord[]> {
    return fetchRows<AdminMetricsCountBucketRecord>(
      this.usersContainer,
      createBucketedCountQuery(
        'c.createdAt',
        bucket,
        start,
        end,
        `
        AND (
          NOT IS_DEFINED(c.type)
          OR IS_NULL(c.type)
          OR c.type = @type
        )
      `,
        [{ name: '@type', value: 'user' }],
      ),
    )
  }

  listPostBuckets(
    start: Date,
    end: Date,
    bucket: AdminMetricsBucket,
  ): Promise<AdminMetricsCountBucketRecord[]> {
    return fetchRows<AdminMetricsCountBucketRecord>(
      this.postsContainer,
      createBucketedCountQuery(
        'c.createdAt',
        bucket,
        start,
        end,
        `
        AND (
          c.type = @postType
          OR c.type = @replyType
        )
        AND (
          NOT IS_DEFINED(c.kind)
          OR IS_NULL(c.kind)
          OR c.kind = @kind
        )
      `,
        [
          { name: '@postType', value: 'post' },
          { name: '@replyType', value: 'reply' },
          { name: '@kind', value: 'user' },
        ],
      ),
    )
  }

  async listActiveUserBuckets(
    start: Date,
    end: Date,
    bucket: AdminMetricsBucket,
  ): Promise<AdminMetricsActiveUserBucketRecord[]> {
    const [registrations, posts, reactions, follows, reports] =
      await Promise.all([
        fetchRows<AdminMetricsActiveUserBucketRecord>(
          this.usersContainer,
          createBucketedDistinctActorQuery(
            'c.id',
            'c.createdAt',
            bucket,
            start,
            end,
            `
            AND (
              NOT IS_DEFINED(c.type)
              OR IS_NULL(c.type)
              OR c.type = @type
            )
          `,
            [{ name: '@type', value: 'user' }],
          ),
        ),
        fetchRows<AdminMetricsActiveUserBucketRecord>(
          this.postsContainer,
          createBucketedDistinctActorQuery(
            'c.authorId',
            'c.createdAt',
            bucket,
            start,
            end,
            `
            AND (
              c.type = @postType
              OR c.type = @replyType
            )
            AND (
              NOT IS_DEFINED(c.kind)
              OR IS_NULL(c.kind)
              OR c.kind = @kind
            )
          `,
            [
              { name: '@postType', value: 'post' },
              { name: '@replyType', value: 'reply' },
              { name: '@kind', value: 'user' },
            ],
          ),
        ),
        fetchRows<AdminMetricsActiveUserBucketRecord>(
          this.reactionsContainer,
          createBucketedDistinctActorQuery(
            'c.userId',
            'c.updatedAt',
            bucket,
            start,
            end,
            `
            AND c.type = @type
          `,
            [{ name: '@type', value: 'reaction' }],
          ),
        ),
        fetchRows<AdminMetricsActiveUserBucketRecord>(
          this.followsContainer,
          createBucketedDistinctActorQuery(
            'c.followerId',
            'c.createdAt',
            bucket,
            start,
            end,
            `
            AND c.type = @type
          `,
            [{ name: '@type', value: 'follow' }],
          ),
        ),
        fetchRows<AdminMetricsActiveUserBucketRecord>(
          this.reportsContainer,
          createBucketedDistinctActorQuery(
            'c.reporterId',
            'c.createdAt',
            bucket,
            start,
            end,
            `
            AND (
              NOT IS_DEFINED(c.type)
              OR IS_NULL(c.type)
              OR c.type = @type
            )
          `,
            [{ name: '@type', value: 'report' }],
          ),
        ),
      ])

    return [
      ...registrations,
      ...posts,
      ...reactions,
      ...follows,
      ...reports,
    ]
  }

  listReportTimeline(
    previousStart: Date,
    end: Date,
  ): Promise<AdminMetricsReportRecord[]> {
    return fetchRows<AdminMetricsReportRecord>(this.reportsContainer, {
      query: `
        SELECT
          c.createdAt,
          c.triagedAt,
          c.status,
          c.reporterId
        FROM c
        WHERE c.createdAt < @end
          AND (
            NOT IS_DEFINED(c.type)
            OR IS_NULL(c.type)
            OR c.type = @type
          )
          AND (
            c.createdAt >= @previousStart
            OR (
              NOT IS_DEFINED(c.status)
              OR IS_NULL(c.status)
              OR LOWER(c.status) = 'open'
            )
            OR (
              IS_DEFINED(c.triagedAt)
              AND NOT IS_NULL(c.triagedAt)
              AND c.triagedAt >= @previousStart
            )
          )
      `,
      parameters: [
        { name: '@end', value: end.toISOString() },
        { name: '@previousStart', value: previousStart.toISOString() },
        { name: '@type', value: 'report' },
      ],
    })
  }
}

export function createAdminMetricsStore(): CosmosAdminMetricsStore {
  cachedAdminMetricsStore ??= CosmosAdminMetricsStore.fromEnvironment()
  return cachedAdminMetricsStore
}
