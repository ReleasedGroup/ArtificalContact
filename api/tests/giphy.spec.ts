import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGiphyConfig,
  GiphyConfigurationError,
  GiphyUpstreamError,
  searchGiphyGifs,
} from '../src/lib/giphy.js'

const mockFetch = vi.fn()

function createJsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('getGiphyConfig', () => {
  it('requires an API key', () => {
    expect(() => getGiphyConfig({})).toThrow(GiphyConfigurationError)
  })

  it('uses the configured API key', () => {
    expect(
      getGiphyConfig({
        GIPHY_API_KEY: 'test-key',
      }),
    ).toEqual({
      apiKey: 'test-key',
    })
  })
})

describe('searchGiphyGifs', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests featured GIFs when the query is blank', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'giphy-1',
            title: 'Party parrot',
            images: {
              fixed_width_small: {
                url: 'https://media4.giphy.com/media/party-parrot/100w.gif',
                width: '100',
                height: '75',
              },
              original: {
                url: 'https://media4.giphy.com/media/party-parrot/giphy.gif',
                width: '320',
                height: '240',
              },
            },
          },
        ],
      }),
    )

    const result = await searchGiphyGifs(
      {
        query: '   ',
        locale: 'en-AU',
        limit: 8,
      },
      {
        config: {
          apiKey: 'test-key',
        },
        fetchImpl: mockFetch as typeof fetch,
      },
    )

    expect(result).toEqual({
      mode: 'featured',
      query: '',
      results: [
        {
          id: 'giphy-1',
          title: 'Party parrot',
          previewUrl: 'https://media4.giphy.com/media/party-parrot/100w.gif',
          gifUrl: 'https://media4.giphy.com/media/party-parrot/giphy.gif',
          width: 320,
          height: 240,
        },
      ],
    })

    const requestUrl = mockFetch.mock.calls[0]?.[0]
    expect(requestUrl).toBeInstanceOf(URL)
    expect(String(requestUrl)).toContain('/v1/gifs/trending?')
    expect(String(requestUrl)).toContain('api_key=test-key')
    expect(String(requestUrl)).toContain('limit=8')
    expect(String(requestUrl)).toContain('rating=pg-13')
  })

  it('requests the GIPHY search endpoint for non-empty queries', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          {
            id: 'giphy-2',
            title: 'Celebration confetti',
            images: {
              fixed_width: {
                url: 'https://media1.giphy.com/media/confetti/200w.gif',
                width: '200',
                height: '200',
              },
              original: {
                url: 'https://media1.giphy.com/media/confetti/giphy.gif',
                width: '360',
                height: '360',
              },
            },
          },
        ],
      }),
    )

    const result = await searchGiphyGifs(
      {
        query: ' confetti ',
        locale: 'en-AU',
      },
      {
        config: {
          apiKey: 'test-key',
        },
        fetchImpl: mockFetch as typeof fetch,
      },
    )

    expect(result.mode).toBe('search')
    expect(result.query).toBe('confetti')
    expect(result.results[0]?.title).toBe('Celebration confetti')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/v1/gifs/search?')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('q=confetti')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('lang=en')
  })

  it('surfaces upstream status failures', async () => {
    mockFetch.mockResolvedValue(createJsonResponse(429, {}))

    await expect(
      searchGiphyGifs(
        {},
        {
          config: {
            apiKey: 'test-key',
          },
          fetchImpl: mockFetch as typeof fetch,
        },
      ),
    ).rejects.toThrow(GiphyUpstreamError)
  })

  it('surfaces invalid JSON from GIPHY', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      },
    })

    await expect(
      searchGiphyGifs(
        {},
        {
          config: {
            apiKey: 'test-key',
          },
          fetchImpl: mockFetch as typeof fetch,
        },
      ),
    ).rejects.toThrow('GIPHY GIF search returned invalid JSON.')
  })
})
