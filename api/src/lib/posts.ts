import type { Container } from '@azure/cosmos'
import { z, type ZodIssue } from 'zod'
import type { ApiEnvelope, ApiError } from './api-envelope.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './config.js'
import { createCosmosClient } from './cosmos-client.js'
import { readOptionalValue } from './strings.js'
import type { UserDocument } from './users.js'

export const DEFAULT_POSTS_CONTAINER_NAME = 'posts'
export const DEFAULT_POST_MAX_LENGTH = 280

const hashtagPattern = /(?<![A-Za-z0-9_])#([A-Za-z0-9_]+)/g
const mentionPattern = /(?<![A-Za-z0-9_])@([A-Za-z0-9._/-]+)/g

let cachedPostRepository: MutablePostRepository | undefined

export interface StoredPostMediaDocument {
  id?: string | null
  kind?: string | null
  url?: string | null
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
}

export interface StoredGitHubPostMetadataDocument {
  repoId?: string | null
  owner?: string | null
  name?: string | null
  eventType?: string | null
  eventId?: string | number | null
  number?: string | number | null
  tag?: string | null
  state?: string | null
  actorLogin?: string | null
  actorAvatarUrl?: string | null
  url?: string | null
  bodyExcerpt?: string | null
  labels?: string[] | null
  githubCreatedAt?: string | null
  githubUpdatedAt?: string | null
}

export interface StoredPostDocument {
  id: string
  type?: string | null
  kind?: string | null
  threadId?: string | null
  parentId?: string | null
  authorId?: string | null
  authorHandle?: string | null
  authorDisplayName?: string | null
  authorAvatarUrl?: string | null
  text?: string | null
  hashtags?: string[] | null
  mentions?: string[] | null
  media?: StoredPostMediaDocument[] | null
  counters?: {
    likes?: number | null
    dislikes?: number | null
    emoji?: number | null
    replies?: number | null
  } | null
  visibility?: string | null
  moderationState?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  deletedAt?: string | null
  github?: StoredGitHubPostMetadataDocument | null
}

export interface PostContent {
  text: string
  hashtags: string[]
  mentions: string[]
}

export interface ReplyGifMedia {
  id: string
  kind: 'gif'
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
}

export interface ReplyContent {
  text: string
  hashtags: string[]
  mentions: string[]
  media: ReplyGifMedia[]
}

export interface PublicPostMedia {
  id: string | null
  kind: string | null
  url: string | null
  thumbUrl: string | null
  width: number | null
  height: number | null
}

export interface PublicGitHubPostMetadata {
  repoId: string | null
  owner: string | null
  name: string | null
  eventType: string | null
  eventId: string | null
  number: number | null
  tag: string | null
  state: string | null
  actorLogin: string | null
  actorAvatarUrl: string | null
  url: string | null
  bodyExcerpt: string | null
  labels: string[]
  githubCreatedAt: string | null
  githubUpdatedAt: string | null
}

export interface PublicPost {
  id: string
  type: 'post' | 'reply'
  kind: 'user' | 'github'
  threadId: string
  parentId: string | null
  authorId: string | null
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  text: string | null
  hashtags: string[]
  mentions: string[]
  media: PublicPostMedia[]
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  visibility: string
  createdAt: string | null
  updatedAt: string | null
  github: PublicGitHubPostMetadata | null
}

export interface PostCounters {
  likes: number
  dislikes: number
  emoji: number
  replies: number
}

export interface UserPostDocument extends StoredPostDocument {
  type: 'post' | 'reply'
  kind: 'user'
  threadId: string
  parentId: string | null
  authorId: string
  authorHandle: string
  authorDisplayName: string
  authorAvatarUrl?: string
  text: string
  hashtags: string[]
  mentions: string[]
  counters: PostCounters
  visibility: 'public'
  moderationState: 'ok'
  createdAt: string
  updatedAt: string
  deletedAt: null
}

export interface PostDocument extends UserPostDocument {
  type: 'post'
  parentId: null
}

export interface PostStore {
  getPostById(
    postId: string,
    threadId?: string,
  ): Promise<StoredPostDocument | null>
}

export interface PostRepository {
  create(post: UserPostDocument): Promise<UserPostDocument>
}

export interface ReadablePostRepository extends PostStore, PostRepository {}

export interface MutablePostStore extends PostStore {
  upsertPost(post: StoredPostDocument): Promise<StoredPostDocument>
}

export type MutablePostRepository = PostRepository

export interface PostLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<PublicPost | null>
}

export interface DeletedPost {
  id: string
  threadId: string
  deletedAt: string
  alreadyDeleted: boolean
}

export interface PostDeletionResult {
  status: 200 | 400 | 403 | 404
  body: ApiEnvelope<DeletedPost | null>
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullableStringish(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return toNullableString(value)
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function normalizePostText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim()
}

function isAllowedTenorMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const hostname = url.hostname.trim().toLowerCase()

    return url.protocol === 'https:' && hostname.endsWith('.tenor.com')
  } catch {
    return false
  }
}

function buildTenorMediaUrlSchema(label: string) {
  return z.string().url().refine(isAllowedTenorMediaUrl, {
    message: `${label} must use an https://*.tenor.com URL.`,
  })
}

function readUniqueMatches(text: string, pattern: RegExp): string[] {
  const values = new Set<string>()

  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.trim().toLowerCase()
    if (!value) {
      continue
    }

    values.add(value)
  }

  return [...values]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => toNullableStringish(item))
    .filter((item): item is string => item !== null)
}

function toPostMediaArray(value: unknown): PublicPostMedia[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is StoredPostMediaDocument =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      id: toNullableString(item.id),
      kind: toNullableString(item.kind),
      url: toNullableString(item.url),
      thumbUrl: toNullableString(item.thumbUrl),
      width: toNullableNumber(item.width),
      height: toNullableNumber(item.height),
    }))
}

function toGitHubMetadata(
  github: StoredGitHubPostMetadataDocument | null | undefined,
): PublicGitHubPostMetadata | null {
  if (github === null || github === undefined) {
    return null
  }

  return {
    repoId: toNullableString(github.repoId),
    owner: toNullableString(github.owner),
    name: toNullableString(github.name),
    eventType: toNullableString(github.eventType),
    eventId: toNullableStringish(github.eventId),
    number: toNullableNumber(github.number),
    tag: toNullableString(github.tag),
    state: toNullableString(github.state),
    actorLogin: toNullableString(github.actorLogin),
    actorAvatarUrl: toNullableString(github.actorAvatarUrl),
    url: toNullableString(github.url),
    bodyExcerpt: toNullableString(github.bodyExcerpt),
    labels: toStringArray(github.labels),
    githubCreatedAt: toNullableString(github.githubCreatedAt),
    githubUpdatedAt: toNullableString(github.githubUpdatedAt),
  }
}

function toPostType(post: StoredPostDocument): 'post' | 'reply' {
  return toNullableString(post.type) === 'reply' ? 'reply' : 'post'
}

function toPostKind(post: StoredPostDocument): 'user' | 'github' {
  return toNullableString(post.kind) === 'github' ? 'github' : 'user'
}

function normalizeRoles(roles: readonly string[]): string[] {
  return [
    ...new Set(roles.map((role) => role.trim().toLowerCase()).filter(Boolean)),
  ]
}

function canDeletePost(
  post: StoredPostDocument,
  actorUserId: string,
  actorRoles: readonly string[],
): boolean {
  if (toNullableString(post.authorId) === actorUserId) {
    return true
  }

  return actorRoles.includes('moderator')
}

function buildDeletedPostSummary(
  post: StoredPostDocument,
  deletedAt: string,
  alreadyDeleted: boolean,
): DeletedPost {
  return {
    id: post.id,
    threadId: toNullableString(post.threadId) ?? post.id,
    deletedAt,
    alreadyDeleted,
  }
}

export function isPubliclyVisiblePost(post: StoredPostDocument): boolean {
  if (toNullableString(post.deletedAt) !== null) {
    return false
  }

  const visibility = toNullableString(post.visibility) ?? 'public'
  if (visibility !== 'public') {
    return false
  }

  const moderationState = toNullableString(post.moderationState) ?? 'ok'
  return moderationState !== 'hidden' && moderationState !== 'removed'
}

function createPostRepositoryForContainer(
  container: Container,
): MutablePostRepository {
  return {
    async create(post: UserPostDocument) {
      const response = await container.items.create<UserPostDocument>(post)
      return response.resource ?? post
    },
  }
}

export function resolvePostMaxLength(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configuredValue = readOptionalValue(env.POST_MAX_LENGTH)
  if (!configuredValue) {
    return DEFAULT_POST_MAX_LENGTH
  }

  if (!/^\d+$/.test(configuredValue)) {
    throw new Error('POST_MAX_LENGTH must be a positive integer.')
  }

  const parsedValue = Number(configuredValue)
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error('POST_MAX_LENGTH must be a positive integer.')
  }

  return parsedValue
}

export function extractHashtags(text: string): string[] {
  return readUniqueMatches(text, hashtagPattern)
}

export function extractMentions(text: string): string[] {
  return readUniqueMatches(text, mentionPattern)
}

export function buildPostContentSchema(
  maxTextLength: number = DEFAULT_POST_MAX_LENGTH,
) {
  return z
    .object({
      text: z.preprocess(
        normalizePostText,
        z.string().min(1).max(maxTextLength),
      ),
    })
    .strict()
    .transform(
      (value): PostContent => ({
        text: value.text,
        hashtags: extractHashtags(value.text),
        mentions: extractMentions(value.text),
      }),
    )
}

export function buildCreatePostRequestSchema(maxTextLength: number) {
  return buildPostContentSchema(maxTextLength)
}

export type CreatePostRequest = PostContent

function buildReplyGifMediaSchema() {
  return z
    .object({
      id: z.preprocess(normalizePostText, z.string().min(1)),
      kind: z.literal('gif'),
      url: buildTenorMediaUrlSchema('GIF URLs'),
      thumbUrl: buildTenorMediaUrlSchema('GIF thumbnail URLs')
        .nullable()
        .optional(),
      width: z.number().int().positive().nullable().optional(),
      height: z.number().int().positive().nullable().optional(),
    })
    .strict()
    .transform(
      (value): ReplyGifMedia => ({
        id: value.id,
        kind: 'gif',
        url: value.url,
        thumbUrl: value.thumbUrl ?? null,
        width: value.width ?? null,
        height: value.height ?? null,
      }),
    )
}

export function buildCreateReplyRequestSchema(maxTextLength: number) {
  return z
    .object({
      text: z.preprocess(
        normalizePostText,
        z.string().max(maxTextLength).optional(),
      ),
      media: z.array(buildReplyGifMediaSchema()).max(1).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const text = value.text ?? ''
      const mediaCount = value.media?.length ?? 0

      if (text.length === 0 && mediaCount === 0) {
        context.addIssue({
          code: 'custom',
          message: 'A reply must include text or a GIF.',
          path: ['text'],
        })
      }
    })
    .transform(
      (value): ReplyContent => {
        const text = value.text ?? ''

        return {
          text,
          hashtags: extractHashtags(text),
          mentions: extractMentions(text),
          media: value.media ?? [],
        }
      },
    )
}

export type CreateReplyRequest = ReplyContent

export function mapCreatePostValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_post',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function createUserReplyDocument(
  user: UserDocument,
  parent: StoredPostDocument,
  request: CreateReplyRequest,
  createdAt: Date,
  idFactory: () => string,
): UserPostDocument {
  const id = idFactory()
  const timestamp = createdAt.toISOString()
  const threadId = toNullableString(parent.threadId) ?? parent.id

  return {
    id,
    type: 'reply',
    kind: 'user',
    threadId,
    parentId: parent.id,
    authorId: user.id,
    authorHandle: user.handle ?? user.handleLower ?? '',
    authorDisplayName: user.displayName,
    ...(user.avatarUrl ? { authorAvatarUrl: user.avatarUrl } : {}),
    text: request.text,
    hashtags: request.hashtags,
    mentions: request.mentions,
    ...(request.media.length > 0 ? { media: request.media } : {}),
    counters: {
      likes: 0,
      dislikes: 0,
      emoji: 0,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

export function buildPublicPost(post: StoredPostDocument): PublicPost {
  return {
    id: post.id,
    type: toPostType(post),
    kind: toPostKind(post),
    threadId: toNullableString(post.threadId) ?? post.id,
    parentId: toNullableString(post.parentId),
    authorId: toNullableString(post.authorId),
    authorHandle: toNullableString(post.authorHandle),
    authorDisplayName: toNullableString(post.authorDisplayName),
    authorAvatarUrl: toNullableString(post.authorAvatarUrl),
    text: toNullableString(post.text),
    hashtags: toStringArray(post.hashtags),
    mentions: toStringArray(post.mentions),
    media: toPostMediaArray(post.media),
    counters: {
      likes: toCount(post.counters?.likes),
      dislikes: toCount(post.counters?.dislikes),
      emoji: toCount(post.counters?.emoji),
      replies: toCount(post.counters?.replies),
    },
    visibility: toNullableString(post.visibility) ?? 'public',
    createdAt: toNullableString(post.createdAt),
    updatedAt: toNullableString(post.updatedAt),
    github: toGitHubMetadata(post.github),
  }
}

export async function softDeletePost(
  postId: string | undefined,
  actor: {
    userId: string
    roles: readonly string[]
  },
  store: MutablePostStore,
  now: () => Date = () => new Date(),
): Promise<PostDeletionResult> {
  const normalizedPostId = toNullableString(postId)
  if (normalizedPostId === null) {
    return {
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_post_id',
            message: 'The post id path parameter is required.',
            field: 'id',
          },
        ],
      },
    }
  }

  const post = await store.getPostById(normalizedPostId)
  if (post === null) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No post exists for the requested id.',
            field: 'id',
          },
        ],
      },
    }
  }

  const normalizedActorRoles = normalizeRoles(actor.roles)
  if (!canDeletePost(post, actor.userId, normalizedActorRoles)) {
    return {
      status: 403,
      body: {
        data: null,
        errors: [
          {
            code: 'post_delete_forbidden',
            message: 'Only the author or a moderator can delete this post.',
          },
        ],
      },
    }
  }

  const existingDeletedAt = toNullableString(post.deletedAt)
  if (existingDeletedAt !== null) {
    return {
      status: 200,
      body: {
        data: buildDeletedPostSummary(post, existingDeletedAt, true),
        errors: [],
      },
    }
  }

  const deletedAt = now().toISOString()
  const deletedPost: StoredPostDocument = {
    ...post,
    text: null,
    updatedAt: deletedAt,
    deletedAt,
    ...(post.github === null || post.github === undefined
      ? {}
      : {
          github: {
            ...post.github,
            bodyExcerpt: null,
          },
        }),
  }

  await store.upsertPost(deletedPost)

  return {
    status: 200,
    body: {
      data: buildDeletedPostSummary(post, deletedAt, false),
      errors: [],
    },
  }
}

export async function lookupPublicPost(
  postId: string | undefined,
  store: PostStore,
): Promise<PostLookupResult> {
  const normalizedPostId = toNullableString(postId)
  if (normalizedPostId === null) {
    return {
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_post_id',
            message: 'The post id path parameter is required.',
            field: 'id',
          },
        ],
      },
    }
  }

  const post = await store.getPostById(normalizedPostId)
  if (post === null || !isPubliclyVisiblePost(post)) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No public post exists for the requested id.',
            field: 'id',
          },
        ],
      },
    }
  }

  return {
    status: 200,
    body: {
      data: buildPublicPost(post),
      errors: [],
    },
  }
}

export function createUserPostDocument(
  user: UserDocument,
  request: CreatePostRequest,
  createdAt: Date,
  idFactory: () => string,
): PostDocument {
  const id = idFactory()
  const timestamp = createdAt.toISOString()

  return {
    id,
    type: 'post',
    kind: 'user',
    threadId: id,
    parentId: null,
    authorId: user.id,
    authorHandle: user.handle ?? user.handleLower ?? '',
    authorDisplayName: user.displayName,
    ...(user.avatarUrl ? { authorAvatarUrl: user.avatarUrl } : {}),
    text: request.text,
    hashtags: request.hashtags,
    mentions: request.mentions,
    counters: {
      likes: 0,
      dislikes: 0,
      emoji: 0,
      replies: 0,
    },
    visibility: 'public',
    moderationState: 'ok',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

export function createPostRepositoryFromConfig(
  config: EnvironmentConfig,
  env: NodeJS.ProcessEnv = process.env,
): MutablePostRepository {
  if (!config.cosmosDatabaseName) {
    throw new Error('COSMOS_DATABASE_NAME is required to resolve posts.')
  }

  const postsContainerName =
    readOptionalValue(env.POSTS_CONTAINER_NAME) ?? DEFAULT_POSTS_CONTAINER_NAME
  const client = createCosmosClient(config)
  const container = client
    .database(config.cosmosDatabaseName)
    .container(postsContainerName)

  return createPostRepositoryForContainer(container)
}

export function createPostRepository(): MutablePostRepository {
  cachedPostRepository ??= createPostRepositoryFromConfig(
    getEnvironmentConfig(),
  )
  return cachedPostRepository
}
