import type { Container, SqlQuerySpec } from '@azure/cosmos'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from './follows.js'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { DEFAULT_NOTIFICATIONS_CONTAINER_NAME } from './notifications.js'
import { DEFAULT_POSTS_CONTAINER_NAME } from './posts.js'
import { DEFAULT_REACTIONS_CONTAINER_NAME } from './reactions.js'
import {
  DEFAULT_REPORTS_CONTAINER_NAME,
  type ReportStatus,
} from './reports.js'
import { readOptionalValue } from './strings.js'
import type { AdminMetricsStore } from './admin-metrics.js'

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

export class CosmosAdminMetricsStore implements AdminMetricsStore {
  constructor(
    private readonly usersContainer: Container,
    private readonly postsContainer: Container,
    private readonly followsContainer: Container,
    private readonly reactionsContainer: Container,
    private readonly reportsContainer: Container,
    private readonly notificationsContainer: Container,
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
        readOptionalValue(process.env.FOLLOWS_CONTAINER_NAME) ??
          DEFAULT_FOLLOWS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.REACTIONS_CONTAINER_NAME) ??
          DEFAULT_REACTIONS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.REPORTS_CONTAINER_NAME) ??
          DEFAULT_REPORTS_CONTAINER_NAME,
      ),
      database.container(
        readOptionalValue(process.env.NOTIFICATIONS_CONTAINER_NAME) ??
          DEFAULT_NOTIFICATIONS_CONTAINER_NAME,
      ),
    )
  }

  async countRegistrations(): Promise<number> {
    return this.countValues(this.usersContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
      `,
      parameters: [{ name: '@type', value: 'user' }],
    })
  }

  async countRegistrationsSince(since: string): Promise<number> {
    return this.countValues(this.usersContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'user' },
        { name: '@since', value: since },
      ],
    })
  }

  async listUserIdsWithPostsSince(since: string): Promise<string[]> {
    return this.listStringValues(this.postsContainer, {
      query: `
        SELECT VALUE c.authorId FROM c
        WHERE c.kind = @kind
          AND IS_DEFINED(c.authorId)
          AND NOT IS_NULL(c.authorId)
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@kind', value: 'user' },
        { name: '@since', value: since },
      ],
    })
  }

  async listUserIdsWithReactionsSince(since: string): Promise<string[]> {
    return this.listStringValues(this.reactionsContainer, {
      query: `
        SELECT VALUE c.userId FROM c
        WHERE c.type = @type
          AND IS_DEFINED(c.userId)
          AND NOT IS_NULL(c.userId)
          AND IS_DEFINED(c.updatedAt)
          AND c.updatedAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'reaction' },
        { name: '@since', value: since },
      ],
    })
  }

  async listUserIdsWithFollowsSince(since: string): Promise<string[]> {
    return this.listStringValues(this.followsContainer, {
      query: `
        SELECT VALUE c.followerId FROM c
        WHERE c.type = @type
          AND IS_DEFINED(c.followerId)
          AND NOT IS_NULL(c.followerId)
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
          AND (NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))
      `,
      parameters: [
        { name: '@type', value: 'follow' },
        { name: '@since', value: since },
      ],
    })
  }

  async listUserIdsWithReportsSince(since: string): Promise<string[]> {
    return this.listStringValues(this.reportsContainer, {
      query: `
        SELECT VALUE c.reporterId FROM c
        WHERE c.type = @type
          AND IS_DEFINED(c.reporterId)
          AND NOT IS_NULL(c.reporterId)
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'report' },
        { name: '@since', value: since },
      ],
    })
  }

  async countRootPostsSince(since: string): Promise<number> {
    return this.countValues(this.postsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.kind = @kind
          AND c.type = @type
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@kind', value: 'user' },
        { name: '@type', value: 'post' },
        { name: '@since', value: since },
      ],
    })
  }

  async countRepliesSince(since: string): Promise<number> {
    return this.countValues(this.postsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.kind = @kind
          AND c.type = @type
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@kind', value: 'user' },
        { name: '@type', value: 'reply' },
        { name: '@since', value: since },
      ],
    })
  }

  async countReports(): Promise<number> {
    return this.countValues(this.reportsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
      `,
      parameters: [{ name: '@type', value: 'report' }],
    })
  }

  async countReportsSince(since: string): Promise<number> {
    return this.countValues(this.reportsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'report' },
        { name: '@since', value: since },
      ],
    })
  }

  async countReportsByStatus(status: ReportStatus): Promise<number> {
    return this.countValues(this.reportsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
          AND c.status = @status
      `,
      parameters: [
        { name: '@type', value: 'report' },
        { name: '@status', value: status },
      ],
    })
  }

  async countReportsUpdatedSince(
    since: string,
    status: Extract<ReportStatus, 'triaged' | 'resolved'>,
  ): Promise<number> {
    return this.countValues(this.reportsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE c.type = @type
          AND c.status = @status
          AND IS_DEFINED(c.updatedAt)
          AND c.updatedAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'report' },
        { name: '@status', value: status },
        { name: '@since', value: since },
      ],
    })
  }

  async countNotificationsSince(since: string): Promise<number> {
    return this.countValues(this.notificationsContainer, {
      query: `
        SELECT VALUE COUNT(1) FROM c
        WHERE (
          NOT IS_DEFINED(c.type)
          OR IS_NULL(c.type)
          OR c.type = @type
        )
          AND IS_DEFINED(c.createdAt)
          AND c.createdAt >= @since
      `,
      parameters: [
        { name: '@type', value: 'notification' },
        { name: '@since', value: since },
      ],
    })
  }

  private async countValues(container: Container, querySpec: SqlQuerySpec): Promise<number> {
    const { resources } = await container.items.query<number>(querySpec).fetchAll()
    return toCount(resources[0])
  }

  private async listStringValues(
    container: Container,
    querySpec: SqlQuerySpec,
  ): Promise<string[]> {
    const { resources } = await container.items.query<string>(querySpec).fetchAll()
    return resources
      .map((value) => toTrimmedString(value))
      .filter((value): value is string => value !== null)
  }
}

export function createAdminMetricsStore(): CosmosAdminMetricsStore {
  cachedAdminMetricsStore ??= CosmosAdminMetricsStore.fromEnvironment()
  return cachedAdminMetricsStore
}
