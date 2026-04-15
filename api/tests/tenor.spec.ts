import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTenorConfig,
  searchTenorGifs,
  TenorConfigurationError,
  TenorUpstreamError,
} from '../src/lib/tenor.js'

const mockFetch = vi.fn()

function createJsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('getTenorConfig', () => {
  it('requires an API key', () => {
    expect(() => getTenorConfig({})).toThrow(TenorConfigurationError)
  })

  it('uses the configured client key when present', () => {
    expect(
      getTenorConfig({
        TENOR_API_KEY: 'test-key',
        TENOR_CLIENT_KEY: 'test-client',
      }),
    ).toEqual({
      apiKey: 'test-key',
      clientKey: 'test-client',
    })
  })
})

describe('searchTenorGifs', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests featured GIFs when the query is blank', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        results: [
          {
            id: 'tenor-1',
            title: 'Party parrot',
            media_formats: {
              tinygif: {
                url: 'https://media.tenor.com/tiny.gif',
                dims: [160, 120],
              },
              gif: {
                url: 'https://media.tenor.com/full.gif',
                dims: [320, 240],
              },
            },
          },
        ],
      }),
    )

    const result = await searchTenorGifs(
      {
        query: '   ',
        locale: 'en-AU',
        limit: 8,
      },
      {
        config: {
          apiKey: 'test-key',
          clientKey: 'test-client',
        },
        fetchImpl: mockFetch as typeof fetch,
      },
    )

    expect(result).toEqual({
      mode: 'featured',
      query: '',
      results: [
        {
          id: 'tenor-1',
          title: 'Party parrot',
          previewUrl: 'https://media.tenor.com/tiny.gif',
          gifUrl: 'https://media.tenor.com/full.gif',
          width: 320,
          height: 240,
        },
      ],
    })

    const requestUrl = mockFetch.mock.calls[0]?.[0]
    expect(requestUrl).toBeInstanceOf(URL)
    expect(String(requestUrl)).toContain('/v2/featured?')
    expect(String(requestUrl)).toContain('client_key=test-client')
    expect(String(requestUrl)).toContain('limit=8')
    expect(String(requestUrl)).toContain('locale=en_AU')
    expect(String(requestUrl)).toContain('media_filter=tinygif%2Cgif')
  })

  it('requests the Tenor search endpoint for non-empty queries', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        results: [
          {
            id: 'tenor-2',
            content_description: 'Celebration confetti',
            media_formats: {
              tinygif: {
                url: 'https://media.tenor.com/confetti-tiny.gif',
                dims: [180, 180],
              },
              gif: {
                url: 'https://media.tenor.com/confetti-full.gif',
                dims: [360, 360],
              },
            },
          },
        ],
      }),
    )

    const result = await searchTenorGifs(
      {
        query: ' confetti ',
      },
      {
        config: {
          apiKey: 'test-key',
          clientKey: 'test-client',
        },
        fetchImpl: mockFetch as typeof fetch,
      },
    )

    expect(result.mode).toBe('search')
    expect(result.query).toBe('confetti')
    expect(result.results[0]?.title).toBe('Celebration confetti')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/v2/search?')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('q=confetti')
  })

  it('surfaces upstream status failures', async () => {
    mockFetch.mockResolvedValue(createJsonResponse(429, {}))

    await expect(
      searchTenorGifs(
        {},
        {
          config: {
            apiKey: 'test-key',
            clientKey: 'test-client',
          },
          fetchImpl: mockFetch as typeof fetch,
        },
      ),
    ).rejects.toThrow(TenorUpstreamError)
  })

  it('surfaces invalid JSON from Tenor', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      },
    })

    await expect(
      searchTenorGifs(
        {},
        {
          config: {
            apiKey: 'test-key',
            clientKey: 'test-client',
          },
          fetchImpl: mockFetch as typeof fetch,
        },
      ),
    ).rejects.toThrow('Tenor GIF search returned invalid JSON.')
  })
})
