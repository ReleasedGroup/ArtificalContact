import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildSearchGifHandler } from '../src/functions/search-gifs.js'
import {
  TenorConfigurationError,
  TenorUpstreamError,
} from '../src/lib/tenor.js'
import type { UserDocument } from '../src/lib/users.js'

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
    bio: 'Building with Azure Functions.',
    avatarUrl: 'https://cdn.example.com/nick.png',
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

function createRequest(
  query: Record<string, string> = {},
): HttpRequest {
  const searchParams = new URLSearchParams(query)

  return {
    query: {
      get(name: string) {
        return searchParams.get(name)
      },
    },
  } as unknown as HttpRequest
}

describe('searchGifHandler', () => {
  it('returns Tenor-backed GIF search results for an active user', async () => {
    const searchGifs = vi.fn(async () => ({
      mode: 'search' as const,
      query: 'party parrot',
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
    }))
    const handler = buildSearchGifHandler({
      searchGifs,
    })

    const response = await handler(
      createRequest({
        q: 'party parrot',
        locale: 'en-AU',
        limit: '9',
      }),
      createContext(),
    )

    expect(searchGifs).toHaveBeenCalledWith({
      query: 'party parrot',
      locale: 'en-AU',
      limit: 9,
    })
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      data: {
        mode: 'search',
        query: 'party parrot',
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
      },
      errors: [],
    })
  })

  it('rejects users without an active handle', async () => {
    const handler = buildSearchGifHandler({
      searchGifs: vi.fn(),
    })
    const pendingUser = createStoredUser({
      status: 'pending',
    })
    delete pendingUser.handle
    delete pendingUser.handleLower

    const response = await handler(createRequest(), createContext(pendingUser))

    expect(response.status).toBe(403)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'auth.forbidden',
          message:
            'The authenticated user must have an active profile before browsing GIFs.',
        },
      ],
    })
  })

  it('surfaces Tenor configuration failures as 503 responses', async () => {
    const handler = buildSearchGifHandler({
      searchGifs: vi.fn(async () => {
        throw new TenorConfigurationError()
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(503)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'gif_picker_unavailable',
          message: 'The GIF picker is not configured right now.',
        },
      ],
    })
  })

  it('surfaces Tenor upstream failures as 502 responses', async () => {
    const handler = buildSearchGifHandler({
      searchGifs: vi.fn(async () => {
        throw new TenorUpstreamError('Tenor GIF search failed with status 429.')
      }),
    })

    const response = await handler(createRequest(), createContext())

    expect(response.status).toBe(502)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'gif_picker_upstream_failed',
          message: 'Tenor GIF search failed with status 429.',
        },
      ],
    })
  })
})
