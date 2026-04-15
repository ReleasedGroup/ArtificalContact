import { DefaultAzureCredential } from '@azure/identity'
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from '@azure/storage-blob'
import { monotonicFactory } from 'ulid'
import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import { readOptionalValue } from './strings.js'
import type { UserDocument } from './users.js'

export const DEFAULT_MEDIA_UPLOAD_SAS_TTL_MINUTES = 15

const userDelegationClockSkewBufferMs = 5 * 60 * 1000
const mebibyte = 1024 * 1024

export type MediaKind = 'image' | 'gif' | 'audio' | 'video'

type MediaKindRules = {
  defaultContainerName: string
  maxSizeBytes: number
  maxDurationSeconds?: number
  allowedContentTypes: Record<string, string>
}

const mediaKindRules: Record<MediaKind, MediaKindRules> = {
  image: {
    defaultContainerName: 'images',
    maxSizeBytes: 8 * mebibyte,
    allowedContentTypes: {
      'image/avif': 'avif',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    },
  },
  gif: {
    defaultContainerName: 'gif',
    maxSizeBytes: 8 * mebibyte,
    allowedContentTypes: {
      'image/gif': 'gif',
    },
  },
  audio: {
    defaultContainerName: 'audio',
    maxSizeBytes: 25 * mebibyte,
    maxDurationSeconds: 5 * 60,
    allowedContentTypes: {
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    },
  },
  video: {
    defaultContainerName: 'video',
    maxSizeBytes: 100 * mebibyte,
    maxDurationSeconds: 2 * 60,
    allowedContentTypes: {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    },
  },
}

const createMediaUploadRequestSchema = z
  .object({
    kind: z.enum(['image', 'gif', 'audio', 'video']),
    contentType: z.string().trim().min(1),
    sizeBytes: z.number().int().positive(),
    durationSeconds: z.number().positive().finite().optional(),
  })
  .superRefine((value, context) => {
    const rules = getMediaRules(value.kind)

    if (rules.maxDurationSeconds && value.durationSeconds === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['durationSeconds'],
        message: `durationSeconds is required for ${value.kind} uploads.`,
      })
    }
  })

let cachedMediaUploadUrlIssuer: MediaUploadUrlIssuer | undefined

export interface CreateMediaUploadRequest {
  kind: MediaKind
  contentType: string
  sizeBytes: number
  durationSeconds?: number | undefined
}

export interface MediaUploadConfig {
  blobServiceUrl: string
  mediaBaseUrl: string
  sasTtlMinutes: number
  containerNames: Record<MediaKind, string>
}

export interface IssuedMediaUploadUrl {
  kind: MediaKind
  contentType: string
  sizeBytes: number
  containerName: string
  blobName: string
  blobUrl: string
  uploadUrl: string
  expiresAt: string
  method: 'PUT'
  requiredHeaders: {
    'content-type': string
    'x-ms-blob-type': 'BlockBlob'
  }
}

export interface BlobServiceClientLike {
  getUserDelegationKey(
    startsOn: Date,
    expiresOn: Date,
  ): Promise<UserDelegationKey>
}

export type BlobServiceClientFactory = (
  config: MediaUploadConfig,
) => BlobServiceClientLike

export type MediaUploadUrlIssuer = (
  user: UserDocument,
  request: CreateMediaUploadRequest,
) => Promise<IssuedMediaUploadUrl>

export class UnsupportedMediaContentTypeError extends Error {
  readonly allowedContentTypes: string[]
  readonly code = 'media.unsupported_content_type'
  readonly field = 'contentType'
  readonly status = 415

  constructor(kind: MediaKind, contentType: string, allowedContentTypes: string[]) {
    super(
      `The content type "${contentType}" is not allowed for ${kind} uploads.`,
    )
    this.name = 'UnsupportedMediaContentTypeError'
    this.allowedContentTypes = allowedContentTypes
  }
}

export class MediaFileTooLargeError extends Error {
  readonly code = 'media.file_too_large'
  readonly field = 'sizeBytes'
  readonly status = 413

  constructor(readonly kind: MediaKind, readonly maxSizeBytes: number) {
    super(`The uploaded ${kind} exceeds the ${maxSizeBytes}-byte limit.`)
    this.name = 'MediaFileTooLargeError'
  }
}

export class MediaDurationTooLongError extends Error {
  readonly code = 'media.duration_too_long'
  readonly field = 'durationSeconds'
  readonly status = 413

  constructor(readonly kind: MediaKind, readonly maxDurationSeconds: number) {
    super(
      `The uploaded ${kind} exceeds the ${maxDurationSeconds}-second duration limit.`,
    )
    this.name = 'MediaDurationTooLongError'
  }
}

function createDefaultBlobServiceClient(config: MediaUploadConfig) {
  return new BlobServiceClient(
    config.blobServiceUrl,
    new DefaultAzureCredential(),
  )
}

function parseHttpUrl(name: string, value: string): URL {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`)
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`${name} must use https.`)
  }

  return parsedUrl
}

function resolveSasTtlMinutes(env: NodeJS.ProcessEnv): number {
  const configuredValue = readOptionalValue(env.MEDIA_UPLOAD_SAS_TTL_MINUTES)
  if (!configuredValue) {
    return DEFAULT_MEDIA_UPLOAD_SAS_TTL_MINUTES
  }

  if (!/^\d+$/.test(configuredValue)) {
    throw new Error('MEDIA_UPLOAD_SAS_TTL_MINUTES must be an integer from 1 to 15.')
  }

  const parsedValue = Number.parseInt(configuredValue, 10)
  if (parsedValue < 1 || parsedValue > DEFAULT_MEDIA_UPLOAD_SAS_TTL_MINUTES) {
    throw new Error('MEDIA_UPLOAD_SAS_TTL_MINUTES must be an integer from 1 to 15.')
  }

  return parsedValue
}

function resolveContainerName(
  envValue: string | undefined,
  defaultContainerName: string,
): string {
  return readOptionalValue(envValue) ?? defaultContainerName
}

function removeTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function encodeBlobPath(blobName: string): string {
  return blobName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function getStorageAccountName(blobServiceUrl: string): string {
  const hostname = parseHttpUrl('BLOB_SERVICE_URL', blobServiceUrl).hostname
  const accountName = hostname.split('.')[0]

  if (!accountName) {
    throw new Error('BLOB_SERVICE_URL must include the storage account host name.')
  }

  return accountName
}

function normalizeContentType(contentType: string) {
  return contentType.trim().toLowerCase()
}

function getMediaRules(kind: MediaKind): MediaKindRules {
  return mediaKindRules[kind]
}

function buildBlobName(
  userId: string,
  now: Date,
  ulidFactory: () => string,
  extension: string,
) {
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')

  return `${userId}/${year}/${month}/${ulidFactory()}.${extension}`
}

export function buildCreateMediaUploadRequestSchema() {
  return createMediaUploadRequestSchema
}

export function mapCreateMediaUploadValidationIssues(
  issues: readonly ZodIssue[],
): ApiError[] {
  return issues.map((issue) => {
    const [field] = issue.path
    return {
      code: 'invalid_media_upload',
      message: issue.message,
      ...(typeof field === 'string' ? { field } : {}),
    }
  })
}

export function resolveMediaUploadConfig(
  env: NodeJS.ProcessEnv = process.env,
): MediaUploadConfig {
  const blobServiceUrlValue = readOptionalValue(env.BLOB_SERVICE_URL)
  if (!blobServiceUrlValue) {
    throw new Error('BLOB_SERVICE_URL is required to issue media upload URLs.')
  }

  const blobServiceUrl = removeTrailingSlash(
    parseHttpUrl('BLOB_SERVICE_URL', blobServiceUrlValue).toString(),
  )
  const mediaBaseUrl = removeTrailingSlash(
    parseHttpUrl(
      'MEDIA_BASE_URL',
      readOptionalValue(env.MEDIA_BASE_URL) ?? blobServiceUrl,
    ).toString(),
  )

  return {
    blobServiceUrl,
    mediaBaseUrl,
    sasTtlMinutes: resolveSasTtlMinutes(env),
    containerNames: {
      image: resolveContainerName(
        env.MEDIA_IMAGES_CONTAINER_NAME,
        mediaKindRules.image.defaultContainerName,
      ),
      gif: resolveContainerName(
        env.MEDIA_GIF_CONTAINER_NAME,
        mediaKindRules.gif.defaultContainerName,
      ),
      audio: resolveContainerName(
        env.MEDIA_AUDIO_CONTAINER_NAME,
        mediaKindRules.audio.defaultContainerName,
      ),
      video: resolveContainerName(
        env.MEDIA_VIDEO_CONTAINER_NAME,
        mediaKindRules.video.defaultContainerName,
      ),
    },
  }
}

export function createMediaUploadUrlIssuer(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    blobServiceClientFactory?: BlobServiceClientFactory
    now?: () => Date
    ulidFactory?: () => string
  } = {},
): MediaUploadUrlIssuer {
  const config = resolveMediaUploadConfig(env)
  const blobServiceClientFactory =
    dependencies.blobServiceClientFactory ?? createDefaultBlobServiceClient
  const now = dependencies.now ?? (() => new Date())
  const ulidFactory = dependencies.ulidFactory ?? monotonicFactory()
  const blobServiceClient = blobServiceClientFactory(config)
  const accountName = getStorageAccountName(config.blobServiceUrl)

  return async function issueMediaUploadUrl(user, request) {
    const rules = getMediaRules(request.kind)
    const normalizedContentType = normalizeContentType(request.contentType)
    const extension = rules.allowedContentTypes[normalizedContentType]

    if (!extension) {
      throw new UnsupportedMediaContentTypeError(
        request.kind,
        normalizedContentType,
        Object.keys(rules.allowedContentTypes),
      )
    }

    if (request.sizeBytes > rules.maxSizeBytes) {
      throw new MediaFileTooLargeError(request.kind, rules.maxSizeBytes)
    }

    if (
      rules.maxDurationSeconds !== undefined &&
      request.durationSeconds !== undefined &&
      request.durationSeconds > rules.maxDurationSeconds
    ) {
      throw new MediaDurationTooLongError(
        request.kind,
        rules.maxDurationSeconds,
      )
    }

    const requestTime = now()
    const startsOn = new Date(requestTime.getTime() - userDelegationClockSkewBufferMs)
    const expiresOn = new Date(
      requestTime.getTime() + config.sasTtlMinutes * 60 * 1000,
    )
    const containerName = config.containerNames[request.kind]
    const blobName = buildBlobName(user.id, requestTime, ulidFactory, extension)
    const sasQuery = generateBlobSASQueryParameters(
      {
        blobName,
        containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('cw'),
        protocol: SASProtocol.Https,
        startsOn,
      },
      await blobServiceClient.getUserDelegationKey(startsOn, expiresOn),
      accountName,
    ).toString()
    const blobPath = encodeBlobPath(blobName)

    return {
      kind: request.kind,
      contentType: normalizedContentType,
      sizeBytes: request.sizeBytes,
      containerName,
      blobName,
      blobUrl: `${config.mediaBaseUrl}/${containerName}/${blobPath}`,
      uploadUrl: `${config.blobServiceUrl}/${containerName}/${blobPath}?${sasQuery}`,
      expiresAt: expiresOn.toISOString(),
      method: 'PUT',
      requiredHeaders: {
        'content-type': normalizedContentType,
        'x-ms-blob-type': 'BlockBlob',
      },
    }
  }
}

export function getMediaUploadUrlIssuer(): MediaUploadUrlIssuer {
  cachedMediaUploadUrlIssuer ??= createMediaUploadUrlIssuer()
  return cachedMediaUploadUrlIssuer
}
