import type { Container } from '@azure/cosmos'
import { getEnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import {
  DEFAULT_NOTIFICATION_PREFS_CONTAINER_NAME,
  type NotificationPreferencesDocument,
} from './notification-preferences.js'

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

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isExpectedCosmosStatusCode(error: unknown, statusCode: number) {
  return getErrorStatusCode(error) === statusCode
}

export interface NotificationPreferenceStore {
  getByUserId(userId: string): Promise<NotificationPreferencesDocument | null>
  upsert(
    document: NotificationPreferencesDocument,
  ): Promise<NotificationPreferencesDocument>
}

export class CosmosNotificationPreferenceStore implements NotificationPreferenceStore {
  constructor(private readonly container: Container) {}

  static fromEnvironment(): CosmosNotificationPreferenceStore {
    const config = getEnvironmentConfig()

    if (!config.cosmosDatabaseName) {
      throw new Error(
        'COSMOS_DATABASE_NAME is required to resolve notification preferences.',
      )
    }

    const containerName =
      readOptionalValue(process.env.NOTIFICATION_PREFS_CONTAINER_NAME) ??
      DEFAULT_NOTIFICATION_PREFS_CONTAINER_NAME

    return new CosmosNotificationPreferenceStore(
      createCosmosClient(config)
        .database(config.cosmosDatabaseName)
        .container(containerName),
    )
  }

  async getByUserId(
    userId: string,
  ): Promise<NotificationPreferencesDocument | null> {
    try {
      const response = await this.container
        .item(userId, userId)
        .read<NotificationPreferencesDocument>()
      return response.resource ?? null
    } catch (error) {
      if (isExpectedCosmosStatusCode(error, 404)) {
        return null
      }

      throw error
    }
  }

  async upsert(
    document: NotificationPreferencesDocument,
  ): Promise<NotificationPreferencesDocument> {
    const response =
      await this.container.items.upsert<NotificationPreferencesDocument>(
        document,
      )
    return response.resource ?? document
  }
}
