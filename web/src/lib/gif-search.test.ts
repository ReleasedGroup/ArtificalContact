import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchGifs } from './gif-search'

const mockFetch = vi.fn()

function createJsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('searchGifs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the GIF search endpoint with the selected query and locale', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          mode: 'search',
          query: 'party parrot',
          results: [
            {
              id: 'tenor-123',
              title: 'Party parrot',
              previewUrl: 'https://media.tenor.com/tiny.gif',
              gifUrl: 'https://media.tenor.com/full.gif',
              width: 320,
              height: 240,
            },
          ],
        },
        errors: [],
      }),
    )

    const result = await searchGifs('  party parrot  ', {
      locale: 'en-AU',
      limit: 9,
    })

    expect(result.mode).toBe('search')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/gifs/search?q=party+parrot&locale=en-AU&limit=9',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    )
  })

  it('surfaces API errors from the GIF search endpoint', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(503, {
        data: null,
        errors: [
          {
            code: 'gif_picker_unavailable',
            message: 'The GIF picker is not configured right now.',
          },
        ],
      }),
    )

    await expect(searchGifs('party')).rejects.toThrow(
      'The GIF picker is not configured right now.',
    )
  })
})
