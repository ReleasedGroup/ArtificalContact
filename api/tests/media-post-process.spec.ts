import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  DefaultMediaVisualGenerator,
  processMediaBlob,
  type BlobClientLike,
  type BlobPropertiesLike,
  type ContainerClientLike,
  type ContentSafetyScanner,
  type DerivedBlobClientLike,
  type GeneratedMediaVisuals,
  type MediaVisualGenerator,
  type StorageBlobLike,
} from '../src/lib/media-post-process.js'
import {
  buildMediaId,
  type MediaStore,
  type StoredMediaDocument,
} from '../src/lib/media.js'

class RecordingMediaStore implements MediaStore {
  public readonly documents: StoredMediaDocument[] = []

  async upsertMedia(document: StoredMediaDocument): Promise<void> {
    this.documents.push(document)
  }
}

class InMemoryDerivedBlobClient implements DerivedBlobClientLike {
  public readonly uploads: Array<{
    data: Buffer
    contentType: string | undefined
  }> = []

  constructor(public readonly url: string) {}

  async uploadData(
    data: Buffer,
    options?: {
      blobHTTPHeaders?: {
        blobContentType?: string
      }
    },
  ): Promise<void> {
    this.uploads.push({
      data,
      contentType: options?.blobHTTPHeaders?.blobContentType,
    })
  }
}

class InMemoryContainerClient implements ContainerClientLike {
  public readonly derivedClients = new Map<string, InMemoryDerivedBlobClient>()

  constructor(public readonly containerName: string) {}

  getBlockBlobClient(blobName: string): DerivedBlobClientLike {
    let blobClient = this.derivedClients.get(blobName)

    if (blobClient === undefined) {
      blobClient = new InMemoryDerivedBlobClient(
        `https://storage.example.com/${this.containerName}/${blobName}`,
      )
      this.derivedClients.set(blobName, blobClient)
    }

    return blobClient
  }
}

class InMemoryBlobClient implements BlobClientLike {
  public readonly metadataWrites: Record<string, string>[] = []

  constructor(
    public readonly url: string,
    public readonly name: string,
    private readonly data: Buffer,
    private properties: BlobPropertiesLike = {},
  ) {}

  async getProperties(): Promise<BlobPropertiesLike> {
    return {
      ...this.properties,
      metadata: { ...(this.properties.metadata ?? {}) },
    }
  }

  async downloadToBuffer(): Promise<Buffer> {
    return this.data
  }

  async downloadToFile(filePath: string): Promise<void> {
    await writeFile(filePath, this.data)
  }

  async setMetadata(metadata?: Record<string, string>): Promise<void> {
    this.metadataWrites.push(metadata ?? {})
    this.properties = {
      ...this.properties,
      metadata: metadata ?? {},
    }
  }
}

function createStorageBlob(
  containerName: string,
  blobName: string,
  bytes: Buffer,
  properties: BlobPropertiesLike = {},
): StorageBlobLike & {
  blobClient: InMemoryBlobClient
  containerClient: InMemoryContainerClient
} {
  const containerClient = new InMemoryContainerClient(containerName)
  const blobClient = new InMemoryBlobClient(
    `https://storage.example.com/${containerName}/${blobName}`,
    blobName,
    bytes,
    properties,
  )

  return {
    blobClient,
    containerClient,
  }
}

function createReadyVisuals(): GeneratedMediaVisuals {
  return {
    width: 1280,
    height: 720,
    thumbUrl: 'https://cdn.example.com/images/thumbs/u_123/photo-thumb.webp',
    variants: [
      {
        label: 'thumb',
        blobName: 'thumbs/u_123/photo-thumb.webp',
        url: 'https://cdn.example.com/images/thumbs/u_123/photo-thumb.webp',
        contentType: 'image/webp',
        width: 480,
        height: 270,
      },
    ],
    scanImageBytes: Buffer.from('scan-image'),
  }
}

function createOkScanner(): ContentSafetyScanner {
  return {
    scanImage: vi.fn().mockResolvedValue({
      status: 'ok',
      threshold: 4,
      maxSeverity: 0,
      reason: null,
      scannedAt: '2026-04-15T09:05:00.000Z',
      categories: [
        {
          category: 'Violence',
          severity: 0,
        },
      ],
    }),
  }
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe('processMediaBlob', () => {
  it('upserts a ready media document and stamps blob metadata for a processed image', async () => {
    const blob = createStorageBlob(
      'images',
      'u_123/2026/04/photo.png',
      Buffer.from('original-image'),
      {
        contentLength: 1234,
        contentType: 'image/png',
        lastModified: new Date('2026-04-15T09:00:00.000Z'),
      },
    )
    const store = new RecordingMediaStore()
    const mediaVisualGenerator: MediaVisualGenerator = {
      generateVisuals: vi.fn().mockResolvedValue(createReadyVisuals()),
    }
    const contentSafetyScanner = createOkScanner()

    const result = await processMediaBlob(
      blob,
      {
        mediaStore: store,
        mediaVisualGenerator,
        contentSafetyScanner,
        publicBaseUrl: 'https://cdn.example.com',
        now: () => new Date('2026-04-15T09:10:00.000Z'),
      },
      createLogger(),
    )

    expect(result).toMatchObject({
      id: buildMediaId('images', 'u_123/2026/04/photo.png'),
      ownerId: 'u_123',
      kind: 'image',
      blobContainer: 'images',
      blobName: 'u_123/2026/04/photo.png',
      url: 'https://cdn.example.com/images/u_123/2026/04/photo.png',
      thumbUrl: 'https://cdn.example.com/images/thumbs/u_123/photo-thumb.webp',
      processingState: 'ready',
      moderationState: 'ok',
      sizeBytes: 1234,
      contentType: 'image/png',
    })
    expect(store.documents).toHaveLength(1)
    expect(store.documents[0]?.id).toBe(result?.id)
    expect(blob.blobClient.metadataWrites).toEqual([
      {
        mediaid: buildMediaId('images', 'u_123/2026/04/photo.png'),
        processingstate: 'ready',
        moderationstate: 'ok',
        processedat: '2026-04-15T09:10:00.000Z',
      },
    ])
    expect(mediaVisualGenerator.generateVisuals).toHaveBeenCalledOnce()
    expect(contentSafetyScanner.scanImage).toHaveBeenCalledWith(
      Buffer.from('scan-image'),
    )
  })

  it('soft-flags a blob when content safety returns a threshold breach', async () => {
    const blob = createStorageBlob(
      'video',
      'u_123/2026/04/demo.mp4',
      Buffer.from('video'),
    )
    const store = new RecordingMediaStore()
    const mediaVisualGenerator: MediaVisualGenerator = {
      generateVisuals: vi.fn().mockResolvedValue({
        ...createReadyVisuals(),
        thumbUrl: 'https://cdn.example.com/video/thumbs/u_123/demo-thumb.webp',
      }),
    }
    const contentSafetyScanner: ContentSafetyScanner = {
      scanImage: vi.fn().mockResolvedValue({
        status: 'flagged',
        threshold: 4,
        maxSeverity: 6,
        reason: null,
        scannedAt: '2026-04-15T09:05:00.000Z',
        categories: [
          {
            category: 'Sexual',
            severity: 6,
          },
        ],
      }),
    }

    const result = await processMediaBlob(blob, {
      mediaStore: store,
      mediaVisualGenerator,
      contentSafetyScanner,
      publicBaseUrl: 'https://cdn.example.com',
    })

    expect(result?.moderationState).toBe('flagged')
    expect(result?.moderation.maxSeverity).toBe(6)
    expect(blob.blobClient.metadataWrites[0]?.moderationstate).toBe('flagged')
  })

  it('ignores derived thumbnail blobs so the worker does not recurse on itself', async () => {
    const blob = createStorageBlob(
      'images',
      'thumbs/u_123/2026/04/photo-thumb.webp',
      Buffer.from('thumb'),
    )
    const store = new RecordingMediaStore()
    const mediaVisualGenerator: MediaVisualGenerator = {
      generateVisuals: vi.fn(),
    }

    const result = await processMediaBlob(blob, {
      mediaStore: store,
      mediaVisualGenerator,
      contentSafetyScanner: createOkScanner(),
    })

    expect(result).toBeNull()
    expect(store.documents).toEqual([])
    expect(mediaVisualGenerator.generateVisuals).not.toHaveBeenCalled()
  })

  it('captures processing failures as error documents instead of dropping the blob silently', async () => {
    const blob = createStorageBlob(
      'images',
      'u_123/2026/04/bad.png',
      Buffer.from('broken'),
      {
        contentType: 'image/png',
      },
    )
    const store = new RecordingMediaStore()
    const mediaVisualGenerator: MediaVisualGenerator = {
      generateVisuals: vi.fn().mockRejectedValue(new Error('decode failed')),
    }
    const contentSafetyScanner = createOkScanner()

    const result = await processMediaBlob(blob, {
      mediaStore: store,
      mediaVisualGenerator,
      contentSafetyScanner,
    })

    expect(result).toMatchObject({
      id: buildMediaId('images', 'u_123/2026/04/bad.png'),
      processingState: 'error',
      processingError: 'decode failed',
      moderationState: 'pending',
      thumbUrl: null,
    })
    expect(contentSafetyScanner.scanImage).not.toHaveBeenCalled()
    expect(blob.blobClient.metadataWrites[0]?.processingstate).toBe('error')
  })
})

describe('DefaultMediaVisualGenerator', () => {
  it('does not require ffmpeg to be present when processing still images', async () => {
    const generator = new DefaultMediaVisualGenerator()
    const imageBytes = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: '#111827',
      },
    })
      .png()
      .toBuffer()
    const blob = createStorageBlob(
      'images',
      'u_123/2026/04/no-ffmpeg.png',
      imageBytes,
      {
        contentType: 'image/png',
      },
    )

    const visuals = await generator.generateVisuals({
      mediaKind: 'image',
      blobName: 'u_123/2026/04/no-ffmpeg.png',
      blob,
      publicBaseUrl: 'https://cdn.example.com',
    })

    expect(visuals.thumbUrl).toBe(
      'https://cdn.example.com/images/thumbs/u_123/2026/04/no-ffmpeg-thumb.webp',
    )
    expect(visuals.variants).toHaveLength(2)
  })

  it('creates webp image variants and rewrites their URLs through the public media base URL', async () => {
    const generator = new DefaultMediaVisualGenerator('ffmpeg')
    const imageBytes = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: '#0f172a',
      },
    })
      .png()
      .toBuffer()
    const blob = createStorageBlob(
      'images',
      'u_123/2026/04/photo.png',
      imageBytes,
      {
        contentType: 'image/png',
      },
    )

    const visuals = await generator.generateVisuals({
      mediaKind: 'image',
      blobName: 'u_123/2026/04/photo.png',
      blob,
      publicBaseUrl: 'https://cdn.example.com',
    })

    expect(visuals.width).toBe(1600)
    expect(visuals.height).toBe(900)
    expect(visuals.thumbUrl).toBe(
      'https://cdn.example.com/images/thumbs/u_123/2026/04/photo-thumb.webp',
    )
    expect(visuals.variants).toHaveLength(2)
    expect(
      blob.containerClient.derivedClients.get(
        'thumbs/u_123/2026/04/photo-thumb.webp',
      )?.uploads,
    ).toHaveLength(1)
    expect(
      blob.containerClient.derivedClients.get(
        'thumbs/u_123/2026/04/photo-display.webp',
      )?.uploads,
    ).toHaveLength(1)
  })
})
