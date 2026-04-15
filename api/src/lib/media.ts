import { createHash } from 'node:crypto'
import path from 'node:path'
import { CosmosClient, type Container } from '@azure/cosmos'
import { createCosmosClient } from './cosmos-client.js'
import { getEnvironmentConfig } from './config.js'
import { readOptionalValue } from './strings.js'
import { DEFAULT_COSMOS_DATABASE_NAME } from './users-by-handle-mirror.js'

export const DEFAULT_MEDIA_CONTAINER_NAME = 'media'
export const DEFAULT_MEDIA_DERIVATIVES_PREFIX = 'thumbs'

export type MediaKind = 'image' | 'video' | 'audio' | 'gif'

export interface StoredMediaVariantDocument {
  label: string
  blobName: string
  url: string
  contentType: string
  width: number | null
  height: number | null
}

export interface MediaModerationCategoryResult {
  category: string
  severity: number
}

export interface StoredMediaDocument {
  id: string
  type: 'media'
  ownerId: string
  kind: MediaKind
  blobContainer: string
  blobName: string
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
  sizeBytes: number | null
  contentType: string | null
  processingState: 'ready' | 'error'
  processingError: string | null
  moderationState: 'ok' | 'flagged' | 'pending'
  moderation: {
    provider: 'azure-ai-content-safety'
    status: 'ok' | 'flagged' | 'skipped'
    threshold: number | null
    maxSeverity: number | null
    reason: string | null
    scannedAt: string | null
    categories: MediaModerationCategoryResult[]
  }
  variants: StoredMediaVariantDocument[]
  createdAt: string
  updatedAt: string
}

export interface MediaStore {
  upsertMedia(document: StoredMediaDocument): Promise<void>
}

function createCosmosClientFromEnvironment(): CosmosClient {
  return createCosmosClient(getEnvironmentConfig())
}

export class CosmosMediaStore implements MediaStore {
  static fromEnvironment(client?: CosmosClient): CosmosMediaStore {
    const config = getEnvironmentConfig()
    const databaseName =
      config.cosmosDatabaseName ?? DEFAULT_COSMOS_DATABASE_NAME
    const containerName =
      config.mediaContainerName ?? DEFAULT_MEDIA_CONTAINER_NAME
    const resolvedClient = client ?? createCosmosClientFromEnvironment()
    const database = resolvedClient.database(databaseName)

    return new CosmosMediaStore(database.container(containerName))
  }

  constructor(private readonly container: Container) {}

  async upsertMedia(document: StoredMediaDocument): Promise<void> {
    await this.container.items.upsert(document)
  }
}

export function buildMediaId(containerName: string, blobName: string): string {
  const hash = createHash('sha256')
  hash.update(containerName)
  hash.update(':')
  hash.update(blobName)

  return `m_${hash.digest('hex').slice(0, 24)}`
}

export function normalizeMediaKindFromContainer(
  containerName: string,
): MediaKind | null {
  switch (containerName) {
    case 'images':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'gif':
      return 'gif'
    default:
      return null
  }
}

export function parseOwnerIdFromBlobName(blobName: string): string | null {
  const [ownerId] = blobName.split('/')
  return readOptionalValue(ownerId) ?? null
}

export function buildDerivedBlobName(
  blobName: string,
  label: string,
  extension: string,
): string {
  const directoryName = path.posix.dirname(blobName)
  const fileExtension = path.posix.extname(blobName)
  const baseName = path.posix.basename(blobName, fileExtension)
  const normalizedExtension = extension.startsWith('.')
    ? extension.slice(1)
    : extension
  const prefix = directoryName === '.' ? '' : `${directoryName}/`

  return `${DEFAULT_MEDIA_DERIVATIVES_PREFIX}/${prefix}${baseName}-${label}.${normalizedExtension}`
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

export function buildPublicBlobUrl(
  blobUrl: string,
  mediaBaseUrl?: string,
): string {
  const normalizedBaseUrl = readOptionalValue(mediaBaseUrl)
  if (normalizedBaseUrl === undefined) {
    return blobUrl
  }

  const sourceUrl = new URL(blobUrl)
  const relativePath = `${sourceUrl.pathname.replace(/^\/+/, '')}${sourceUrl.search}`

  return new URL(
    relativePath,
    ensureTrailingSlash(normalizedBaseUrl),
  ).toString()
}

export function isDerivedMediaBlob(blobName: string): boolean {
  return blobName.startsWith(`${DEFAULT_MEDIA_DERIVATIVES_PREFIX}/`)
}
