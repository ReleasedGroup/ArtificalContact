import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReply } from './post-write'

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
