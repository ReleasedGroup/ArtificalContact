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
})
