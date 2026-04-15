import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildMediaUploadUrlHandler } from '../src/functions/media-upload-url.js'
import {
  DEFAULT_MEDIA_UPLOAD_SAS_TTL_MINUTES,
  MediaDurationTooLongError,
  MediaFileTooLargeError,
  UnsupportedMediaContentTypeError,
  createMediaUploadUrlIssuer,
  resolveMediaUploadConfig,
  type BlobServiceClientLike,
  type IssuedMediaUploadUrl,
  type MediaUploadUrlIssuer,
} from '../src/lib/media-upload.js'
import type { UserDocument } from '../src/lib/users.js'

function createRequest(body: unknown, options?: { invalidJson?: boolean }) {
  return {
    json: async () => {
      if (options?.invalidJson) {
        throw new Error('Invalid JSON')
      }

      return body
    },
  } as unknown as HttpRequest
}

function createStoredUser(overrides: Partial<UserDocument> = {}): UserDocument {
  return {
    id: 'github:abc123',
    type: 'user',
    identityProvider: 'github',
    identityProviderUserId: 'abc123',
    email: 'nick@example.com',
    emailLower: 'nick@example.com',
    handle: 'nick',
    handleLower: 'nick',
    displayName: 'Nick Beaugeard',
    expertise: ['llm'],
    links: {
      website: 'https://example.com',
    },
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 3,
      followers: 8,
      following: 5,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T01:00:00.000Z',
    ...overrides,
  }
}

function createContext(user: UserDocument | null = createStoredUser()) {
  return {
    auth: user
      ? {
          isAuthenticated: true,
          principal: null,
          user,
          roles: user.roles,
        }
      : undefined,
    log: vi.fn(),
  } as unknown as InvocationContext
}

function createIssuedUpload(
  overrides: Partial<IssuedMediaUploadUrl> = {},
): IssuedMediaUploadUrl {
  return {
    kind: 'image',
    contentType: 'image/png',
    sizeBytes: 1024,
    containerName: 'images',
    blobName: 'github:abc123/2026/04/01TESTULID.png',
    blobUrl: 'https://cdn.example.com/images/github%3Aabc123/2026/04/01TESTULID.png',
    uploadUrl:
      'https://storage.example/images/github%3Aabc123/2026/04/01TESTULID.png?sig=test',
    expiresAt: '2026-04-15T04:15:00.000Z',
    method: 'PUT',
    requiredHeaders: {
      'content-type': 'image/png',
      'x-ms-blob-type': 'BlockBlob',
    },
    ...overrides,
  }
}

describe('resolveMediaUploadConfig', () => {
  it('uses defaults when optional media settings are absent', () => {
    const config = resolveMediaUploadConfig({
      BLOB_SERVICE_URL: 'https://storage.example.blob.core.windows.net',
    })

    expect(config).toEqual({
      blobServiceUrl: 'https://storage.example.blob.core.windows.net',
      mediaBaseUrl: 'https://storage.example.blob.core.windows.net',
      sasTtlMinutes: DEFAULT_MEDIA_UPLOAD_SAS_TTL_MINUTES,
      containerNames: {
        image: 'images',
        gif: 'gif',
        audio: 'audio',
        video: 'video',
      },
    })
  })

  it('accepts explicit media configuration values', () => {
    const config = resolveMediaUploadConfig({
      BLOB_SERVICE_URL: 'https://storage.example.blob.core.windows.net/',
      MEDIA_BASE_URL: 'https://cdn.example.com/media/',
      MEDIA_UPLOAD_SAS_TTL_MINUTES: '10',
      MEDIA_IMAGES_CONTAINER_NAME: 'post-images',
      MEDIA_GIF_CONTAINER_NAME: 'post-gif',
      MEDIA_AUDIO_CONTAINER_NAME: 'post-audio',
      MEDIA_VIDEO_CONTAINER_NAME: 'post-video',
    })

    expect(config).toEqual({
      blobServiceUrl: 'https://storage.example.blob.core.windows.net',
      mediaBaseUrl: 'https://cdn.example.com/media',
      sasTtlMinutes: 10,
      containerNames: {
        image: 'post-images',
        gif: 'post-gif',
        audio: 'post-audio',
        video: 'post-video',
      },
    })
  })

  it.each([
    {},
    {
      BLOB_SERVICE_URL: 'http://storage.example.blob.core.windows.net',
    },
    {
      BLOB_SERVICE_URL: 'https://storage.example.blob.core.windows.net',
      MEDIA_UPLOAD_SAS_TTL_MINUTES: '30',
    },
  ])('rejects invalid media upload configuration %#', (env) => {
    expect(() =>
      resolveMediaUploadConfig(env as NodeJS.ProcessEnv),
    ).toThrowError()
  })
})

describe('createMediaUploadUrlIssuer', () => {
  it('builds a signed upload URL, deterministic blob path, and eventual media URL', async () => {
    const getUserDelegationKey = vi.fn(async () => ({
      signedObjectId: '00000000-0000-0000-0000-000000000001',
      signedTenantId: '00000000-0000-0000-0000-000000000002',
      signedStartsOn: new Date('2026-04-15T03:55:00.000Z'),
      signedExpiresOn: new Date('2026-04-15T04:10:00.000Z'),
      signedService: 'b',
      signedVersion: '2025-11-05',
      value: 'dGVzdC1rZXk=',
    }))
    const issuer = createMediaUploadUrlIssuer(
      {
        BLOB_SERVICE_URL: 'https://storageacct.blob.core.windows.net',
        MEDIA_BASE_URL: 'https://cdn.example.com/media',
        MEDIA_UPLOAD_SAS_TTL_MINUTES: '10',
      },
      {
        blobServiceClientFactory: () =>
          ({
            getUserDelegationKey,
          }) satisfies BlobServiceClientLike,
        now: () => new Date('2026-04-15T04:00:00.000Z'),
        ulidFactory: () => '01J9TESTULID',
      },
    )

    const upload = await issuer(createStoredUser(), {
      kind: 'image',
      contentType: 'IMAGE/PNG',
      sizeBytes: 2048,
    })

    expect(getUserDelegationKey).toHaveBeenCalledWith(
      new Date('2026-04-15T03:55:00.000Z'),
      new Date('2026-04-15T04:10:00.000Z'),
    )
    expect(upload).toMatchObject({
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 2048,
      containerName: 'images',
      blobName: 'github:abc123/2026/04/01J9TESTULID.png',
      blobUrl:
        'https://cdn.example.com/media/images/github%3Aabc123/2026/04/01J9TESTULID.png',
      expiresAt: '2026-04-15T04:10:00.000Z',
      method: 'PUT',
      requiredHeaders: {
        'content-type': 'image/png',
        'x-ms-blob-type': 'BlockBlob',
      },
    })
    expect(upload.uploadUrl).toContain(
      'https://storageacct.blob.core.windows.net/images/github%3Aabc123/2026/04/01J9TESTULID.png?',
    )
    expect(upload.uploadUrl).toContain('sp=cw')
    expect(upload.uploadUrl).toContain('spr=https')
  })

  it('rejects unsupported content types for the selected media kind', async () => {
    const issuer = createMediaUploadUrlIssuer(
      {
        BLOB_SERVICE_URL: 'https://storageacct.blob.core.windows.net',
      },
      {
        blobServiceClientFactory: () =>
          ({
            getUserDelegationKey: async () => {
              throw new Error('should not be called')
            },
          }) satisfies BlobServiceClientLike,
      },
    )

    await expect(
      issuer(createStoredUser(), {
        kind: 'video',
        contentType: 'image/png',
        sizeBytes: 2048,
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaContentTypeError)
  })

  it('rejects payloads that exceed the per-kind size limit', async () => {
    const issuer = createMediaUploadUrlIssuer(
      {
        BLOB_SERVICE_URL: 'https://storageacct.blob.core.windows.net',
      },
      {
        blobServiceClientFactory: () =>
          ({
            getUserDelegationKey: async () => {
              throw new Error('should not be called')
            },
          }) satisfies BlobServiceClientLike,
      },
    )

    await expect(
      issuer(createStoredUser(), {
        kind: 'gif',
        contentType: 'image/gif',
        sizeBytes: 9 * 1024 * 1024,
      }),
    ).rejects.toEqual(new MediaFileTooLargeError('gif', 8 * 1024 * 1024))
  })

  it.each([
    ['audio', 'audio/mpeg', 301, 300],
    ['video', 'video/mp4', 121, 120],
  ] as const)(
    'rejects %s payloads that exceed the per-kind duration limit',
    async (kind, contentType, durationSeconds, maxDurationSeconds) => {
      const issuer = createMediaUploadUrlIssuer(
        {
          BLOB_SERVICE_URL: 'https://storageacct.blob.core.windows.net',
        },
        {
          blobServiceClientFactory: () =>
            ({
              getUserDelegationKey: async () => {
                throw new Error('should not be called')
              },
            }) satisfies BlobServiceClientLike,
        },
      )

      await expect(
        issuer(createStoredUser(), {
          kind,
          contentType,
          sizeBytes: 2048,
          durationSeconds,
        }),
      ).rejects.toEqual(
        new MediaDurationTooLongError(kind, maxDurationSeconds),
      )
    },
  )
})

describe('mediaUploadUrlHandler', () => {
  it('returns a signed upload descriptor for an authenticated user', async () => {
    const issuedUpload = createIssuedUpload()
    const issuer: MediaUploadUrlIssuer = vi.fn(async () => issuedUpload)
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => issuer,
    })

    const response = await handler(
      createRequest({
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 1024,
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(issuer).toHaveBeenCalledWith(createStoredUser(), {
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 1024,
    })
    expect(response.jsonBody).toEqual({
      data: issuedUpload,
      errors: [],
    })
  })

  it('passes audio duration through to the upload issuer', async () => {
    const issuedUpload = createIssuedUpload({
      kind: 'audio',
      contentType: 'audio/mpeg',
      containerName: 'audio',
      blobName: 'github:abc123/2026/04/01TESTULID.mp3',
      blobUrl:
        'https://cdn.example.com/audio/github%3Aabc123/2026/04/01TESTULID.mp3',
      uploadUrl:
        'https://storage.example/audio/github%3Aabc123/2026/04/01TESTULID.mp3?sig=test',
    })
    const issuer: MediaUploadUrlIssuer = vi.fn(async () => issuedUpload)
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => issuer,
    })

    const response = await handler(
      createRequest({
        kind: 'audio',
        contentType: 'audio/mpeg',
        sizeBytes: 1024,
        durationSeconds: 45,
      }),
      createContext(),
    )

    expect(response.status).toBe(200)
    expect(issuer).toHaveBeenCalledWith(createStoredUser(), {
      kind: 'audio',
      contentType: 'audio/mpeg',
      sizeBytes: 1024,
      durationSeconds: 45,
    })
  })

  it('returns 400 when the request body is invalid JSON', async () => {
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => vi.fn(async () => createIssuedUpload()),
    })

    const response = await handler(
      createRequest({}, { invalidJson: true }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_json',
          message: 'The request body must be valid JSON.',
        },
      ],
    })
  })

  it('returns validation errors when the request body is malformed', async () => {
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => vi.fn(async () => createIssuedUpload()),
    })

    const response = await handler(
      createRequest({
        kind: 'document',
        sizeBytes: 0,
      }),
      createContext(),
    )

    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'invalid_media_upload',
          field: 'kind',
          message: 'Invalid option: expected one of "image"|"gif"|"audio"|"video"',
        },
        {
          code: 'invalid_media_upload',
          field: 'contentType',
          message: 'Invalid input: expected string, received undefined',
        },
        {
          code: 'invalid_media_upload',
          field: 'sizeBytes',
          message: 'Too small: expected number to be >0',
        },
      ],
    })
  })

  it.each([
    ['audio', 'audio/mpeg'],
    ['video', 'video/mp4'],
  ] as const)(
    'requires durationSeconds for %s uploads',
    async (kind, contentType) => {
      const handler = buildMediaUploadUrlHandler({
        issuerFactory: () => vi.fn(async () => createIssuedUpload()),
      })

      const response = await handler(
        createRequest({
          kind,
          contentType,
          sizeBytes: 1024,
        }),
        createContext(),
      )

      expect(response.status).toBe(400)
      expect(response.jsonBody).toEqual({
        data: null,
        errors: [
          {
            code: 'invalid_media_upload',
            field: 'durationSeconds',
            message: `durationSeconds is required for ${kind} uploads.`,
          },
        ],
      })
    },
  )

  it('returns 403 when the user profile is not ready for media uploads', async () => {
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => vi.fn(async () => createIssuedUpload()),
    })

    const response = await handler(
      createRequest({
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 1024,
      }),
      createContext(
        createStoredUser({
          status: 'suspended',
        }),
      ),
    )

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active or pending profile before requesting media uploads.',
        },
      ],
    })
  })

  it('surfaces unsupported content type validation as 415', async () => {
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () =>
        (async () => {
          throw new UnsupportedMediaContentTypeError('audio', 'text/plain', [
            'audio/mpeg',
          ])
        }) satisfies MediaUploadUrlIssuer,
    })

    const response = await handler(
      createRequest({
        kind: 'audio',
        contentType: 'text/plain',
        sizeBytes: 1024,
        durationSeconds: 30,
      }),
      createContext(),
    )

    expect(response.status).toBe(415)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'media.unsupported_content_type',
          field: 'contentType',
          message:
            'The content type "text/plain" is not allowed for audio uploads. Allowed types: audio/mpeg.',
        },
      ],
    })
  })

  it('surfaces media duration validation as 413', async () => {
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () =>
        (async () => {
          throw new MediaDurationTooLongError('video', 120)
        }) satisfies MediaUploadUrlIssuer,
    })

    const response = await handler(
      createRequest({
        kind: 'video',
        contentType: 'video/mp4',
        sizeBytes: 1024,
        durationSeconds: 121,
      }),
      createContext(),
    )

    expect(response.status).toBe(413)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'media.duration_too_long',
          field: 'durationSeconds',
          message:
            'The uploaded video exceeds the 120-second duration limit.',
        },
      ],
    })
  })

  it('returns 500 when the media upload service cannot be configured', async () => {
    const context = createContext()
    const handler = buildMediaUploadUrlHandler({
      issuerFactory: () => {
        throw new Error('missing blob config')
      },
    })

    const response = await handler(
      createRequest({
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 1024,
      }),
      context,
    )

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.configuration_error',
          message: 'The media upload service is not configured.',
        },
      ],
    })
    expect(context.log).toHaveBeenCalledWith(
      'Failed to configure the media upload service.',
      {
        error: 'missing blob config',
      },
    )
  })
})
