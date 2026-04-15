import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOptionalMe } from './me'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('getOptionalMe', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the viewer context is unavailable for auth reasons', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(403, {
        data: null,
        errors: [
          {
            code: 'auth.forbidden',
            message: 'The authenticated user context was not available.',
          },
        ],
      }),
    )

    await expect(getOptionalMe()).resolves.toBeNull()
  })

  it('rethrows unexpected API failures instead of hiding them', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(500, {
        data: null,
        errors: [
          {
            code: 'server.error',
            message: 'The profile lookup failed unexpectedly.',
          },
        ],
      }),
    )

    await expect(getOptionalMe()).rejects.toThrow(
      'The profile lookup failed unexpectedly.',
    )
  })
})
