import type { Container, SqlQuerySpec } from '@azure/cosmos'
import {
  type AdminMetricsActorRecord,
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

async function fetchAllResources<T>(
  container: Container,
  querySpec: SqlQuerySpec,
): Promise<T[]> {
  const queryIterator = container.items.query<T>(querySpec, {
    enableQueryControl: true,
  })
  const resources: T[] = []

  while (queryIterator.hasMoreResults()) {
    const response = await queryIterator.fetchNext()
    resources.push(...(response.resources ?? []))
  }

  return resources
}

function createActorWindowQuery(
  userFieldName: string,
  occurredAtFieldName: string,
  start: Date,
  end: Date,
  extraFilter = '',
  extraParameters: Array<{ name: string; value: string }> = [],
): SqlQuerySpec {
  return {
    query: `
      SELECT ${userFieldName} AS userId, ${occurredAtFieldName} AS occurredAt
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

  listRegistrations(start: Date, end: Date): Promise<AdminMetricsActorRecord[]> {
    return fetchAllResources<AdminMetricsActorRecord>(
      this.usersContainer,
      createActorWindowQuery(
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
    )
  }

  listPosts(start: Date, end: Date): Promise<AdminMetricsActorRecord[]> {
    return fetchAllResources<AdminMetricsActorRecord>(
      this.postsContainer,
      createActorWindowQuery(
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
    )
  }

  listReactions(start: Date, end: Date): Promise<AdminMetricsActorRecord[]> {
    return fetchAllResources<AdminMetricsActorRecord>(
      this.reactionsContainer,
      createActorWindowQuery(
        'c.userId',
        'c.updatedAt',
        start,
        end,
        `
        AND c.type = @type
      `,
        [{ name: '@type', value: 'reaction' }],
      ),
    )
  }

  listFollows(start: Date, end: Date): Promise<AdminMetricsActorRecord[]> {
    return fetchAllResources<AdminMetricsActorRecord>(
      this.followsContainer,
      createActorWindowQuery(
        'c.followerId',
        'c.createdAt',
        start,
        end,
        `
        AND c.type = @type
      `,
        [{ name: '@type', value: 'follow' }],
      ),
    )
  }

  listReportTimeline(
    previousStart: Date,
    end: Date,
  ): Promise<AdminMetricsReportRecord[]> {
    return fetchAllResources<AdminMetricsReportRecord>(this.reportsContainer, {
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
