import { app, type InvocationContext } from '@azure/functions'
import { getEnvironmentConfig } from '../lib/config.js'
import {
  CosmosNotificationPreferenceStore,
  type NotificationPreferenceStore,
} from '../lib/cosmos-notification-preference-store.js'
import { CosmosNotificationStore } from '../lib/cosmos-notification-store.js'
import {
  createNotificationEmailTransportFromEnvironment,
  dispatchNotificationEmails,
  type NotificationEmailTransport,
} from '../lib/notification-email.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from '../lib/follows.js'
import {
  syncFollowNotificationsBatch,
  syncPostNotificationsBatch,
  syncReactionNotificationsBatch,
  type NotificationDocument,
  type NotificationFollowSourceDocument,
  type NotificationPostSourceDocument,
  type NotificationProfileStore,
  type NotificationReactionSourceDocument,
  type NotificationStore,
} from '../lib/notifications.js'
import { DEFAULT_POSTS_CONTAINER_NAME, type PostStore } from '../lib/posts.js'
import { DEFAULT_REACTIONS_CONTAINER_NAME } from '../lib/reactions.js'
import {
  DEFAULT_COSMOS_DATABASE_NAME,
  DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
} from '../lib/users-by-handle-mirror.js'
import { createUserRepository, type UserRepository } from '../lib/users.js'

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedNotificationStore: CosmosNotificationStore | undefined
let cachedNotificationPreferenceStore:
  | CosmosNotificationPreferenceStore
  | undefined
let cachedNotificationEmailTransport: NotificationEmailTransport | null | undefined
let cachedPostStore: CosmosPostStore | undefined
let cachedProfileStore: CosmosUserProfileStore | undefined
let cachedUserRepository: UserRepository | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getNotificationStore(): CosmosNotificationStore {
  cachedNotificationStore ??= CosmosNotificationStore.fromEnvironment()
  return cachedNotificationStore
}

function getNotificationPreferenceStore(): CosmosNotificationPreferenceStore {
  cachedNotificationPreferenceStore ??=
    CosmosNotificationPreferenceStore.fromEnvironment()
  return cachedNotificationPreferenceStore
}

function getNotificationEmailTransport(): NotificationEmailTransport | null {
  cachedNotificationEmailTransport ??=
    createNotificationEmailTransportFromEnvironment()
  return cachedNotificationEmailTransport
}

function getPostStore(): CosmosPostStore {
  cachedPostStore ??= CosmosPostStore.fromEnvironment()
  return cachedPostStore
}

function getProfileStore(): CosmosUserProfileStore {
  cachedProfileStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedProfileStore
}

function getUserRepository(): UserRepository {
  cachedUserRepository ??= createUserRepository()
  return cachedUserRepository
}

export interface NotificationFunctionDependencies {
  emailTransportFactory?: () => NotificationEmailTransport | null
  notificationStoreFactory?: () => NotificationStore
  notificationPreferenceStoreFactory?: () => NotificationPreferenceStore
  postStoreFactory?: () => PostStore
  profileStoreFactory?: () => NotificationProfileStore
  userRepositoryFactory?: () => Pick<UserRepository, 'getById'>
  now?: () => Date
}

async function dispatchNotificationEmailsForBatch(
  notifications: readonly NotificationDocument[],
  dependencies: NotificationFunctionDependencies,
  notificationStore: NotificationStore,
  context: InvocationContext,
): Promise<void> {
  if (notifications.length === 0) {
    return
  }

  const emailTransportFactory =
    dependencies.emailTransportFactory ?? getNotificationEmailTransport

  let transport: NotificationEmailTransport | null
  try {
    transport = emailTransportFactory()
  } catch (error) {
    context.error('Failed to configure notification email transport.', {
      error:
        error instanceof Error
          ? error.message
          : 'Unknown notification email transport configuration error.',
    })
    return
  }

  if (transport === null) {
    return
  }

  const notificationPreferenceStoreFactory =
    dependencies.notificationPreferenceStoreFactory ??
    getNotificationPreferenceStore
  const userRepositoryFactory =
    dependencies.userRepositoryFactory ?? getUserRepository

  try {
    const deliveredCount = await dispatchNotificationEmails(notifications, {
      notificationStore,
      preferenceStore: notificationPreferenceStoreFactory(),
      transport,
      userRepository: userRepositoryFactory(),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    })

    if (deliveredCount > 0) {
      context.info('Sent %d notification emails.', deliveredCount)
    }
  } catch (error) {
    context.error('Failed to dispatch notification emails.', {
      error:
        error instanceof Error
          ? error.message
          : 'Unknown notification email delivery error.',
    })
  }
}

export function buildPostNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function postNotificationFn(
    documents: NotificationPostSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    const notificationStore =
      (dependencies.notificationStoreFactory ?? getNotificationStore)()
    const notifications = await syncPostNotificationsBatch(
      documents,
      postStoreFactory(),
      profileStoreFactory(),
      notificationStore,
      context,
    )
    await dispatchNotificationEmailsForBatch(
      notifications,
      dependencies,
      notificationStore,
      context,
    )
  }
}

export function buildReactionNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function reactionNotificationFn(
    documents: NotificationReactionSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    const notificationStore =
      (dependencies.notificationStoreFactory ?? getNotificationStore)()
    const notifications = await syncReactionNotificationsBatch(
      documents,
      postStoreFactory(),
      profileStoreFactory(),
      notificationStore,
      context,
      {
        hourlyActorThrottleThreshold:
          getEnvironmentConfig().reactionNotificationHourlyThreshold,
      },
    )
    await dispatchNotificationEmailsForBatch(
      notifications,
      dependencies,
      notificationStore,
      context,
    )
  }
}

export function buildFollowNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function followNotificationFn(
    documents: NotificationFollowSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    const notificationStore =
      (dependencies.notificationStoreFactory ?? getNotificationStore)()
    const notifications = await syncFollowNotificationsBatch(
      documents,
      profileStoreFactory(),
      notificationStore,
      context,
    )
    await dispatchNotificationEmailsForBatch(
      notifications,
      dependencies,
      notificationStore,
      context,
    )
  }
}

export const postNotificationFn = buildPostNotificationFn()
export const reactionNotificationFn = buildReactionNotificationFn()
export const followNotificationFn = buildFollowNotificationFn()

export function registerNotificationFunctions() {
  app.cosmosDB<NotificationPostSourceDocument>('postNotificationFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.POSTS_CONTAINER_NAME) ??
      DEFAULT_POSTS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'notificationPosts',
    createLeaseContainerIfNotExists: true,
    handler: postNotificationFn,
  })

  app.cosmosDB<NotificationReactionSourceDocument>('reactionNotificationFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.REACTIONS_CONTAINER_NAME) ??
      DEFAULT_REACTIONS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'notificationReactions',
    createLeaseContainerIfNotExists: true,
    handler: reactionNotificationFn,
  })

  app.cosmosDB<NotificationFollowSourceDocument>('followNotificationFn', {
    connection: cosmosConnectionName,
    databaseName:
      readOptionalValue(process.env.COSMOS_DATABASE_NAME) ??
      DEFAULT_COSMOS_DATABASE_NAME,
    containerName:
      readOptionalValue(process.env.FOLLOWS_CONTAINER_NAME) ??
      DEFAULT_FOLLOWS_CONTAINER_NAME,
    leaseContainerName:
      readOptionalValue(process.env.COSMOS_LEASE_CONTAINER_NAME) ??
      DEFAULT_COSMOS_LEASE_CONTAINER_NAME,
    leaseContainerPrefix: 'notificationFollows',
    createLeaseContainerIfNotExists: true,
    handler: followNotificationFn,
  })
}
