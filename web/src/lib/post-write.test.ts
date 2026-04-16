import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPost, createReply } from './post-write'

const uploadMediaFileMock = vi.fn()

vi.mock('./media-upload', () => ({
  uploadMediaFile: (...args: unknown[]) => uploadMediaFileMock(...args),
}))

const mockFetch = vi.fn()

function createBrokenJsonResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('invalid json')
    },
  }
}

function createJsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('createReply', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    uploadMediaFileMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a reply-specific invalid JSON error message', async () => {
    mockFetch.mockResolvedValue(createBrokenJsonResponse(201))

    await expect(
      createReply('post-1', {
        text: 'Reply body',
      }),
    ).rejects.toThrow('The reply publish response was not valid JSON.')
  })

  it('posts a GIF reply payload to the reply endpoint', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'reply-gif',
          },
        },
        errors: [],
      }),
    )

    await createReply('post-1', {
      media: [
        {
          id: 'tenor-123',
          kind: 'gif',
          url: 'https://media.tenor.com/full.gif',
          thumbUrl: 'https://media.tenor.com/tiny.gif',
          width: 320,
          height: 240,
        },
      ],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/posts/post-1/replies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          media: [
            {
              id: 'tenor-123',
              kind: 'gif',
              url: 'https://media.tenor.com/full.gif',
              thumbUrl: 'https://media.tenor.com/tiny.gif',
              width: 320,
              height: 240,
            },
          ],
        }),
      }),
    )
  })
})

describe('createPost', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    uploadMediaFileMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads image files before posting the root post payload', async () => {
    const imageFile = new File(['diagram'], 'architecture.png', {
      type: 'image/png',
    })

    uploadMediaFileMock.mockResolvedValue({
      kind: 'image',
      blobName: 'github:abc123/2026/04/architecture.png',
      blobUrl: 'https://media.example.com/images/architecture.png',
    })
    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'post-with-image',
          },
        },
        errors: [],
      }),
    )

    await createPost({
      text: 'Architecture update',
      mediaFiles: [
        {
          altText: 'Architecture diagram.',
          file: imageFile,
        },
      ],
    })

    expect(uploadMediaFileMock).toHaveBeenCalledWith({
      file: imageFile,
      kind: 'image',
      signal: undefined,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/posts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: 'Architecture update',
          media: [
            {
              id: 'github:abc123/2026/04/architecture.png',
              kind: 'image',
              url: 'https://media.example.com/images/architecture.png',
              thumbUrl: 'https://media.example.com/images/architecture.png',
              width: null,
              height: null,
            },
          ],
        }),
      }),
    )
  })

  it('accepts media file uploads without alt text until the API stores it', async () => {
    const imageFile = new File(['diagram'], 'architecture.png', {
      type: 'image/png',
    })

    uploadMediaFileMock.mockResolvedValue({
      kind: 'image',
      blobName: 'github:abc123/2026/04/architecture.png',
      blobUrl: 'https://media.example.com/images/architecture.png',
    })
    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'post-with-image',
          },
        },
        errors: [],
      }),
    )

    await createPost({
      text: 'Architecture update',
      mediaFiles: [
        {
          file: imageFile,
        },
      ],
    })

    expect(uploadMediaFileMock).toHaveBeenCalledWith({
      file: imageFile,
      kind: 'image',
      signal: undefined,
    })
  })

  it('posts a Tenor GIF payload without uploading a file first', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'post-with-gif',
          },
        },
        errors: [],
      }),
    )

    await createPost({
      media: [
        {
          id: 'tenor-123',
          kind: 'gif',
          url: 'https://media.tenor.com/full.gif',
          thumbUrl: 'https://media.tenor.com/tiny.gif',
          width: 320,
          height: 240,
        },
      ],
    })

    expect(uploadMediaFileMock).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/posts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          media: [
            {
              id: 'tenor-123',
              kind: 'gif',
              url: 'https://media.tenor.com/full.gif',
              thumbUrl: 'https://media.tenor.com/tiny.gif',
              width: 320,
              height: 240,
            },
          ],
        }),
      }),
    )
  })
})
