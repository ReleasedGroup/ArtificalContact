import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DefaultAzureCredential } from '@azure/identity'
import sharp from 'sharp'
import {
  buildDerivedBlobName,
  buildMediaId,
  buildPublicBlobUrl,
  isDerivedMediaBlob,
  normalizeMediaKindFromContainer,
  parseOwnerIdFromBlobName,
  type MediaKind,
  type MediaModerationCategoryResult,
  type MediaStore,
  type StoredMediaDocument,
  type StoredMediaVariantDocument,
} from './media.js'
import { readOptionalValue } from './strings.js'

const CONTENT_SAFETY_SCOPE = 'https://cognitiveservices.azure.com/.default'
const CONTENT_SAFETY_API_VERSION = '2024-09-01'
const MAX_CONTENT_SAFETY_IMAGE_BYTES = 4 * 1024 * 1024

const IMAGE_VARIANTS = [
  { label: 'thumb', maxWidth: 480 },
  { label: 'display', maxWidth: 1280 },
] as const

const VIDEO_VARIANTS = [
  { label: 'thumb', maxWidth: 480 },
  { label: 'poster', maxWidth: 1280 },
] as const

const require = createRequire(import.meta.url)

export interface BlobPropertiesLike {
  contentLength?: number
  contentType?: string
  metadata?: Record<string, string>
  lastModified?: Date
}

export interface BlobClientLike {
  url: string
  name?: string
  getProperties(): Promise<BlobPropertiesLike>
  downloadToBuffer(): Promise<Buffer>
  downloadToFile(filePath: string): Promise<unknown>
  setMetadata(metadata?: Record<string, string>): Promise<unknown>
}

export interface DerivedBlobClientLike {
  url: string
  uploadData(
    data: Buffer,
    options?: {
      blobHTTPHeaders?: {
        blobContentType?: string
      }
    },
  ): Promise<unknown>
}

export interface ContainerClientLike {
  containerName?: string
  getBlockBlobClient(blobName: string): DerivedBlobClientLike
}

export interface StorageBlobLike {
  blobClient: BlobClientLike
  containerClient: ContainerClientLike
}

export interface LoggerLike {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const noop = (): void => undefined

export const nullLogger: LoggerLike = {
  info: noop,
  warn: noop,
  error: noop,
}

export interface GeneratedMediaVisuals {
  width: number | null
  height: number | null
  thumbUrl: string | null
  variants: StoredMediaVariantDocument[]
  scanImageBytes: Buffer | null
}

export interface GenerateMediaVisualsInput {
  mediaKind: MediaKind
  blobName: string
  blob: StorageBlobLike
  publicBaseUrl?: string | undefined
}

export interface MediaVisualGenerator {
  generateVisuals(
    input: GenerateMediaVisualsInput,
  ): Promise<GeneratedMediaVisuals>
}

export interface MediaModerationResult {
  status: 'ok' | 'flagged' | 'skipped'
  threshold: number | null
  maxSeverity: number | null
  reason: string | null
  scannedAt: string | null
  categories: MediaModerationCategoryResult[]
}

export interface ContentSafetyScanner {
  scanImage(imageBytes: Buffer | null): Promise<MediaModerationResult>
}

export interface ProcessMediaBlobDependencies {
  mediaStore: MediaStore
  mediaVisualGenerator: MediaVisualGenerator
  contentSafetyScanner: ContentSafetyScanner
  publicBaseUrl?: string | undefined
  now?: (() => Date) | undefined
}

function normalizeNullableNumber(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function createEmptyVisuals(): GeneratedMediaVisuals {
  return {
    width: null,
    height: null,
    thumbUrl: null,
    variants: [],
    scanImageBytes: null,
  }
}

function createSkippedModeration(reason: string): MediaModerationResult {
  return {
    status: 'skipped',
    threshold: null,
    maxSeverity: null,
    reason,
    scannedAt: null,
    categories: [],
  }
}

function readBundledFfmpegPath() {
  try {
    const bundledInstaller = require('@ffmpeg-installer/ffmpeg') as {
      path?: string
    }

    return readOptionalValue(bundledInstaller.path)
  } catch {
    return undefined
  }
}

function resolveFfmpegPath(explicitPath?: string) {
  const configuredPath = readOptionalValue(explicitPath)
  if (configuredPath !== undefined) {
    return configuredPath
  }

  const installedPath = readBundledFfmpegPath()
  if (installedPath !== undefined) {
    return installedPath
  }

  throw new Error(
    'FFMPEG_PATH is required to extract video poster frames when no bundled ffmpeg binary is available.',
  )
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `Command '${command}' exited with code ${String(exitCode)}.${stderr.trim().length > 0 ? ` ${stderr.trim()}` : ''}`,
        ),
      )
    })
  })
}

async function uploadVariant(
  containerClient: ContainerClientLike,
  blobName: string,
  contentType: string,
  data: Buffer,
): Promise<DerivedBlobClientLike> {
  const blobClient = containerClient.getBlockBlobClient(blobName)

  await blobClient.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  })

  return blobClient
}

async function createWebpVariants(
  sourceBytes: Buffer,
  blobName: string,
  containerClient: ContainerClientLike,
  publicBaseUrl: string | undefined,
  variants: readonly { label: string; maxWidth: number }[],
): Promise<GeneratedMediaVisuals> {
  const sourceImage = sharp(sourceBytes, {
    animated: false,
  }).rotate()
  const metadata = await sourceImage.clone().metadata()
  const originalWidth = normalizeNullableNumber(metadata.width)
  const originalHeight = normalizeNullableNumber(metadata.height)
  const storedVariants: StoredMediaVariantDocument[] = []
  let thumbUrl: string | null = null
  let scanImageBytes: Buffer | null = null

  for (const variant of variants) {
    const derivedBlobName = buildDerivedBlobName(
      blobName,
      variant.label,
      'webp',
    )
    const { data, info } = await sourceImage
      .clone()
      .resize({
        width: variant.maxWidth,
        withoutEnlargement: true,
      })
      .webp({
        quality: 82,
      })
      .toBuffer({
        resolveWithObject: true,
      })
    const uploadedBlob = await uploadVariant(
      containerClient,
      derivedBlobName,
      'image/webp',
      data,
    )
    const publicUrl = buildPublicBlobUrl(uploadedBlob.url, publicBaseUrl)

    storedVariants.push({
      label: variant.label,
      blobName: derivedBlobName,
      url: publicUrl,
      contentType: 'image/webp',
      width: normalizeNullableNumber(info.width),
      height: normalizeNullableNumber(info.height),
    })

    if (variant.label === 'thumb') {
      thumbUrl = publicUrl
      scanImageBytes = data
    }
  }

  return {
    width: originalWidth,
    height: originalHeight,
    thumbUrl,
    variants: storedVariants,
    scanImageBytes,
  }
}

export class DefaultMediaVisualGenerator implements MediaVisualGenerator {
  private readonly configuredFfmpegPath: string | undefined

  constructor(ffmpegPath?: string) {
    this.configuredFfmpegPath = readOptionalValue(ffmpegPath)
  }

  async generateVisuals(
    input: GenerateMediaVisualsInput,
  ): Promise<GeneratedMediaVisuals> {
    switch (input.mediaKind) {
      case 'image':
      case 'gif': {
        const sourceBytes = await input.blob.blobClient.downloadToBuffer()

        return createWebpVariants(
          sourceBytes,
          input.blobName,
          input.blob.containerClient,
          input.publicBaseUrl,
          IMAGE_VARIANTS,
        )
      }
      case 'video': {
        const posterBytes = await this.extractVideoPoster(input)

        return createWebpVariants(
          posterBytes,
          input.blobName,
          input.blob.containerClient,
          input.publicBaseUrl,
          VIDEO_VARIANTS,
        )
      }
      case 'audio':
      default:
        return createEmptyVisuals()
    }
  }

  private async extractVideoPoster(
    input: GenerateMediaVisualsInput,
  ): Promise<Buffer> {
    const ffmpegPath = resolveFfmpegPath(this.configuredFfmpegPath)
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'acn-media-'))
    const sourceExtension = path.posix.extname(input.blobName) || '.bin'
    const sourceFilePath = path.join(tempDirectory, `source${sourceExtension}`)
    const posterFilePath = path.join(tempDirectory, 'poster.jpg')

    try {
      await input.blob.blobClient.downloadToFile(sourceFilePath)
      await runCommand(ffmpegPath, [
        '-y',
        '-i',
        sourceFilePath,
        '-frames:v',
        '1',
        posterFilePath,
      ])

      return await readFile(posterFilePath)
    } finally {
      await rm(tempDirectory, {
        recursive: true,
        force: true,
      })
    }
  }
}

async function prepareContentSafetyImage(imageBytes: Buffer) {
  if (imageBytes.length <= MAX_CONTENT_SAFETY_IMAGE_BYTES) {
    return imageBytes
  }

  return sharp(imageBytes)
    .rotate()
    .resize({
      width: 1024,
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 60,
    })
    .toBuffer()
}

function normalizeSeverity(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeCategory(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export class AzureContentSafetyScanner implements ContentSafetyScanner {
  private readonly credential = new DefaultAzureCredential()

  constructor(
    private readonly options: {
      endpoint?: string | undefined
      key?: string | undefined
      threshold?: number | undefined
    } = {},
  ) {}

  async scanImage(imageBytes: Buffer | null): Promise<MediaModerationResult> {
    if (imageBytes === null) {
      return createSkippedModeration('unsupported-media-kind')
    }

    const endpoint = readOptionalValue(this.options.endpoint)
    if (endpoint === undefined) {
      return createSkippedModeration('not-configured')
    }

    const requestBody = {
      image: {
        content: (await prepareContentSafetyImage(imageBytes)).toString(
          'base64',
        ),
      },
    }
    const response = await fetch(
      `${endpoint.replace(/\/+$/, '')}/contentsafety/image:analyze?api-version=${CONTENT_SAFETY_API_VERSION}`,
      {
        method: 'POST',
        headers: await this.createHeaders(),
        body: JSON.stringify(requestBody),
      },
    )

    if (!response.ok) {
      throw new Error(
        `Azure AI Content Safety request failed with status ${response.status}: ${await response.text()}`,
      )
    }

    const responseBody = (await response.json()) as {
      categoriesAnalysis?: Array<{
        category?: unknown
        severity?: unknown
      }>
    }
    const categories = (responseBody.categoriesAnalysis ?? [])
      .map((entry) => {
        const category = normalizeCategory(entry.category)
        const severity = normalizeSeverity(entry.severity)

        if (category === null || severity === null) {
          return null
        }

        return {
          category,
          severity,
        }
      })
      .filter((entry): entry is MediaModerationCategoryResult => entry !== null)
    const maxSeverity = categories.reduce<number | null>((current, entry) => {
      if (current === null) {
        return entry.severity
      }

      return Math.max(current, entry.severity)
    }, null)
    const threshold = normalizeNullableNumber(this.options.threshold ?? 4) ?? 4

    return {
      status:
        maxSeverity !== null && maxSeverity >= threshold ? 'flagged' : 'ok',
      threshold,
      maxSeverity,
      reason: null,
      scannedAt: new Date().toISOString(),
      categories,
    }
  }

  private async createHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const key = readOptionalValue(this.options.key)

    if (key !== undefined) {
      headers['Ocp-Apim-Subscription-Key'] = key
      return headers
    }

    const token = await this.credential.getToken(CONTENT_SAFETY_SCOPE)
    if (token?.token === undefined) {
      throw new Error(
        'Failed to acquire an Azure AI Content Safety access token.',
      )
    }

    headers.Authorization = `Bearer ${token.token}`
    return headers
  }
}

function readBlobName(
  blobClient: BlobClientLike,
  containerName: string | undefined,
): string | null {
  const explicitName = readOptionalValue(blobClient.name)
  if (explicitName !== undefined) {
    return explicitName
  }

  const pathname = new URL(blobClient.url).pathname.replace(/^\/+/, '')
  if (containerName === undefined) {
    return pathname.length > 0 ? pathname : null
  }

  const prefix = `${containerName}/`
  if (pathname.startsWith(prefix)) {
    return pathname.slice(prefix.length)
  }

  return pathname.length > 0 ? pathname : null
}

async function setBlobMetadata(
  blobClient: BlobClientLike,
  currentMetadata: Record<string, string> | undefined,
  updates: Record<string, string>,
) {
  await blobClient.setMetadata({
    ...(currentMetadata ?? {}),
    ...updates,
  })
}

function buildMediaDocument(input: {
  id: string
  ownerId: string
  mediaKind: MediaKind
  containerName: string
  blobName: string
  url: string
  properties: BlobPropertiesLike
  visuals: GeneratedMediaVisuals
  moderation: MediaModerationResult
  createdAt: string
  updatedAt: string
  processingState: 'ready' | 'error'
  processingError: string | null
}): StoredMediaDocument {
  return {
    id: input.id,
    type: 'media',
    ownerId: input.ownerId,
    kind: input.mediaKind,
    blobContainer: input.containerName,
    blobName: input.blobName,
    url: input.url,
    thumbUrl: input.visuals.thumbUrl,
    width: input.visuals.width,
    height: input.visuals.height,
    sizeBytes: normalizeNullableNumber(input.properties.contentLength),
    contentType: readOptionalValue(input.properties.contentType) ?? null,
    processingState: input.processingState,
    processingError: input.processingError,
    moderationState:
      input.moderation.status === 'flagged'
        ? 'flagged'
        : input.moderation.status === 'ok'
          ? 'ok'
          : 'pending',
    moderation: {
      provider: 'azure-ai-content-safety',
      status: input.moderation.status,
      threshold: input.moderation.threshold,
      maxSeverity: input.moderation.maxSeverity,
      reason: input.moderation.reason,
      scannedAt: input.moderation.scannedAt,
      categories: input.moderation.categories,
    },
    variants: input.visuals.variants,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

export async function processMediaBlob(
  blob: StorageBlobLike,
  dependencies: ProcessMediaBlobDependencies,
  logger: LoggerLike = nullLogger,
): Promise<StoredMediaDocument | null> {
  const containerName = readOptionalValue(blob.containerClient.containerName)
  const blobName = readBlobName(blob.blobClient, containerName)

  if (containerName === undefined || blobName === null) {
    logger.warn(
      'Skipping media post-processing because the blob container or blob name could not be resolved.',
    )
    return null
  }

  if (isDerivedMediaBlob(blobName)) {
    logger.info(
      "Skipping derived media blob '%s' in container '%s'.",
      blobName,
      containerName,
    )
    return null
  }

  const ownerId = parseOwnerIdFromBlobName(blobName)
  if (ownerId === null) {
    logger.warn(
      "Skipping media post-processing for blob '%s' because it does not include an owner id prefix.",
      blobName,
    )
    return null
  }

  const mediaKind = normalizeMediaKindFromContainer(containerName)
  if (mediaKind === null) {
    logger.warn(
      "Skipping media post-processing for blob '%s' because container '%s' is not supported.",
      blobName,
      containerName,
    )
    return null
  }

  const properties = await blob.blobClient.getProperties()
  const processedAt = dependencies.now?.() ?? new Date()
  const processedAtIso = processedAt.toISOString()
  const createdAtIso = properties.lastModified?.toISOString() ?? processedAtIso
  const mediaId = buildMediaId(containerName, blobName)
  const publicUrl = buildPublicBlobUrl(
    blob.blobClient.url,
    dependencies.publicBaseUrl,
  )

  try {
    const visuals = await dependencies.mediaVisualGenerator.generateVisuals({
      mediaKind,
      blobName,
      blob,
      publicBaseUrl: dependencies.publicBaseUrl,
    })
    const moderation = await dependencies.contentSafetyScanner.scanImage(
      visuals.scanImageBytes,
    )
    const document = buildMediaDocument({
      id: mediaId,
      ownerId,
      mediaKind,
      containerName,
      blobName,
      url: publicUrl,
      properties,
      visuals,
      moderation,
      createdAt: createdAtIso,
      updatedAt: processedAtIso,
      processingState: 'ready',
      processingError: null,
    })

    await dependencies.mediaStore.upsertMedia(document)
    await setBlobMetadata(blob.blobClient, properties.metadata, {
      mediaid: document.id,
      processingstate: document.processingState,
      moderationstate: document.moderationState,
      processedat: processedAtIso,
    })

    logger.info(
      "Processed media blob '%s' in container '%s' as media '%s'.",
      blobName,
      containerName,
      document.id,
    )

    return document
  } catch (error) {
    const processingError =
      error instanceof Error ? error.message : 'Unknown media processing error.'
    const document = buildMediaDocument({
      id: mediaId,
      ownerId,
      mediaKind,
      containerName,
      blobName,
      url: publicUrl,
      properties,
      visuals: createEmptyVisuals(),
      moderation: createSkippedModeration('processing-error'),
      createdAt: createdAtIso,
      updatedAt: processedAtIso,
      processingState: 'error',
      processingError,
    })

    logger.error(
      "Failed to post-process media blob '%s' in container '%s': %s",
      blobName,
      containerName,
      processingError,
    )

    await dependencies.mediaStore.upsertMedia(document)
    await setBlobMetadata(blob.blobClient, properties.metadata, {
      mediaid: document.id,
      processingstate: document.processingState,
      moderationstate: document.moderationState,
      processedat: processedAtIso,
    })

    return document
  }
}
