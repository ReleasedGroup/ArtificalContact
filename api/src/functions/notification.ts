import { app, type InvocationContext } from '@azure/functions'
import { CosmosNotificationStore } from '../lib/cosmos-notification-store.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import { DEFAULT_FOLLOWS_CONTAINER_NAME } from '../lib/follows.js'
import {
  syncFollowNotificationsBatch,
  syncPostNotificationsBatch,
  syncReactionNotificationsBatch,
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

const cosmosConnectionName = 'COSMOS_CONNECTION'

let cachedNotificationStore: CosmosNotificationStore | undefined
let cachedPostStore: CosmosPostStore | undefined
let cachedProfileStore: CosmosUserProfileStore | undefined

function readOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getNotificationStore(): CosmosNotificationStore {
  cachedNotificationStore ??= CosmosNotificationStore.fromEnvironment()
  return cachedNotificationStore
}

function getPostStore(): CosmosPostStore {
  cachedPostStore ??= CosmosPostStore.fromEnvironment()
  return cachedPostStore
}

function getProfileStore(): CosmosUserProfileStore {
  cachedProfileStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedProfileStore
}

export interface NotificationFunctionDependencies {
  notificationStoreFactory?: () => NotificationStore
  postStoreFactory?: () => PostStore
  profileStoreFactory?: () => NotificationProfileStore
}

export function buildPostNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const notificationStoreFactory =
    dependencies.notificationStoreFactory ?? getNotificationStore
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function postNotificationFn(
    documents: NotificationPostSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncPostNotificationsBatch(
      documents,
      postStoreFactory(),
      profileStoreFactory(),
      notificationStoreFactory(),
      context,
    )
  }
}

export function buildReactionNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const notificationStoreFactory =
    dependencies.notificationStoreFactory ?? getNotificationStore
  const postStoreFactory = dependencies.postStoreFactory ?? getPostStore
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function reactionNotificationFn(
    documents: NotificationReactionSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncReactionNotificationsBatch(
      documents,
      postStoreFactory(),
      profileStoreFactory(),
      notificationStoreFactory(),
      context,
    )
  }
}

export function buildFollowNotificationFn(
  dependencies: NotificationFunctionDependencies = {},
) {
  const notificationStoreFactory =
    dependencies.notificationStoreFactory ?? getNotificationStore
  const profileStoreFactory =
    dependencies.profileStoreFactory ?? getProfileStore

  return async function followNotificationFn(
    documents: NotificationFollowSourceDocument[],
    context: InvocationContext,
  ): Promise<void> {
    await syncFollowNotificationsBatch(
      documents,
      profileStoreFactory(),
      notificationStoreFactory(),
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
