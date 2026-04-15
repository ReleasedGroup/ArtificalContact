import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requestMediaUploadUrl,
  uploadMediaFile,
  type BlobUploadProgress,
  type MediaUploadDescriptor,
} from './media-upload'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

class MockXMLHttpRequest {
  method: string | null = null
  url: string | null = null
  body: Document | XMLHttpRequestBodyInit | null = null
  status = 0
  private readonly headers = new Map<string, string>()
  private readonly listeners = new Map<string, (event: Event) => void>()
  private readonly uploadListeners = new Map<
    string,
    (event: ProgressEvent) => void
  >()
  private readonly responseHeaders = new Map<string, string>()

  upload = {
    addEventListener: (type: string, listener: (event: ProgressEvent) => void) =>
      this.uploadListeners.set(type, listener),
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener)
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null) {
    this.body = body
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null
  }

  getRequestHeader(name: string) {
    return this.headers.get(name.toLowerCase()) ?? null
  }

  triggerProgress(progress: BlobUploadProgress) {
    this.uploadListeners.get('progress')?.({
      loaded: progress.loaded,
      total: progress.total,
      lengthComputable: true,
    } as ProgressEvent)
  }

  respond(status: number, headers: Record<string, string> = {}) {
    this.status = status
    Object.entries(headers).forEach(([name, value]) => {
      this.responseHeaders.set(name.toLowerCase(), value)
    })
    this.listeners.get('load')?.(new Event('load'))
  }
}

function createDescriptor(): MediaUploadDescriptor {
  return {
    kind: 'image',
    contentType: 'image/png',
    sizeBytes: 1024,
    containerName: 'images',
    blobName: 'github:abc123/2026/04/01J9TESTULID.png',
    blobUrl:
      'https://cdn.example.com/media/images/github%3Aabc123/2026/04/01J9TESTULID.png',
    uploadUrl:
      'https://storage.example.blob.core.windows.net/images/github%3Aabc123/2026/04/01J9TESTULID.png?sig=test',
    expiresAt: '2026-04-15T04:10:00.000Z',
    method: 'PUT',
    requiredHeaders: {
      'content-type': 'image/png',
      'x-ms-blob-type': 'BlockBlob',
    },
  }
}

describe('requestMediaUploadUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the media upload request to the Functions endpoint', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: createDescriptor(),
        errors: [],
      }),
    )

    const descriptor = await requestMediaUploadUrl({
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 1024,
    })

    expect(descriptor).toEqual(createDescriptor())
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/media/upload-url',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'image',
          contentType: 'image/png',
          sizeBytes: 1024,
        }),
      }),
    )
  })

  it('surfaces API validation failures', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(415, {
        data: null,
        errors: [
          {
            code: 'media.unsupported_content_type',
            message: 'Only png files are accepted here.',
            field: 'contentType',
          },
        ],
      }),
    )

    await expect(
      requestMediaUploadUrl({
        kind: 'image',
        contentType: 'text/plain',
        sizeBytes: 32,
      }),
    ).rejects.toThrow('Only png files are accepted here.')
  })
})

describe('uploadMediaFile', () => {
  it('requests a SAS URL, uploads the file with XHR progress, and returns the blob details', async () => {
    const descriptor = createDescriptor()
    const requestUploadUrl = vi.fn(async () => descriptor)
    const onProgress = vi.fn()
    const xhr = new MockXMLHttpRequest()
    const file = new File(['hello world'], 'preview.png', {
      type: 'image/png',
    })

    const uploadPromise = uploadMediaFile({
      file,
      kind: 'image',
      onProgress,
      requestMediaUploadUrl: requestUploadUrl,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    })

    await Promise.resolve()

    expect(requestUploadUrl).toHaveBeenCalledWith(
      {
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: file.size,
      },
      undefined,
    )
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe(descriptor.uploadUrl)
    expect(xhr.getRequestHeader('content-type')).toBe('image/png')
    expect(xhr.getRequestHeader('x-ms-blob-type')).toBe('BlockBlob')
    expect(xhr.body).toBe(file)

    xhr.triggerProgress({
      loaded: 64,
      total: 128,
      percent: 50,
    })
    xhr.respond(201, {
      etag: '"etag-1"',
      'x-ms-request-id': 'request-1',
    })

    await expect(uploadPromise).resolves.toEqual({
      ...descriptor,
      etag: '"etag-1"',
      requestId: 'request-1',
    })
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 64,
      total: 128,
      percent: 50,
    })
  })

  it('rejects upload failures from blob storage', async () => {
    const xhr = new MockXMLHttpRequest()
    const uploadPromise = uploadMediaFile({
      file: new File(['hello world'], 'preview.png', {
        type: 'image/png',
      }),
      kind: 'image',
      requestMediaUploadUrl: async () => createDescriptor(),
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    })

    await Promise.resolve()
    xhr.respond(403)

    await expect(uploadPromise).rejects.toThrow(
      'Blob upload failed with status 403.',
    )
  })
})
