import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function createDeferredResponse<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the sign-in screen and exposes both SWA auth providers', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/health') {
        return createJsonResponse(200, {
          data: {
            service: 'artificialcontact-api',
            status: 'ok',
            buildSha: 'sha-1234',
            region: 'australiaeast',
            timestamp: '2026-04-15T00:00:00.000Z',
            cosmos: {
              status: 'ok',
              databaseName: 'acn',
            },
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    render(<App />)

    expect(
      screen.getByRole('heading', {
        name: 'Sign in to ArtificialContact.',
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /continue with microsoft/i }),
    ).toHaveAttribute(
      'href',
      '/.auth/login/aad?post_login_redirect_uri=%2F',
    )
    expect(
      screen.getByRole('link', { name: /continue with github/i }),
    ).toHaveAttribute(
      'href',
      '/.auth/login/github?post_login_redirect_uri=%2F',
    )

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(/sha-1234/)).toBeInTheDocument()
    expect(screen.getByText(/Cosmos ping:/)).toBeInTheDocument()
  })

  it('renders a public profile when the current route matches /u/{handle}', async () => {
    window.history.replaceState({}, '', '/u/Ada')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/users/Ada') {
        return createJsonResponse(200, {
          data: {
            id: 'u1',
            handle: 'Ada',
            displayName: 'Ada Lovelace',
            bio: 'Symbolic AI nerd.',
            avatarUrl: 'https://cdn.example.com/ada.png',
            bannerUrl: 'https://cdn.example.com/ada-banner.png',
            expertise: ['llm', 'evals'],
            counters: {
              posts: 12,
              followers: 34,
              following: 5,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument()
    expect(screen.getByText('@Ada')).toBeInTheDocument()
    expect(screen.getByText('Symbolic AI nerd.')).toBeInTheDocument()
    expect(screen.getByText('llm')).toBeInTheDocument()
    expect(screen.getByText('Public identity is live.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [requestUrl, requestOptions] = mockFetch.mock.calls[0]
    expect(requestUrl).toBe('/api/users/Ada')
    expect(requestOptions).toMatchObject({
      headers: { Accept: 'application/json' },
    })
  })

  it('renders a not-found state when the public profile does not exist', async () => {
    window.history.replaceState({}, '', '/u/missing')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/users/missing') {
        return createJsonResponse(404, {
          data: null,
          errors: [
            {
              code: 'user_not_found',
              message: 'No public profile exists for the requested handle.',
              field: 'handle',
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Profile not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No public profile exists for the requested handle.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign-in' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('returns to loading immediately when the handle changes', async () => {
    window.history.replaceState({}, '', '/u/Ada')

    const firstResponse = createDeferredResponse<{
      ok: boolean
      status: number
      json: () => Promise<unknown>
    }>()
    const secondResponse = createDeferredResponse<{
      ok: boolean
      status: number
      json: () => Promise<unknown>
    }>()
    let profileRequestCount = 0

    mockFetch.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/users/')) {
        profileRequestCount += 1
        return profileRequestCount === 1
          ? firstResponse.promise
          : secondResponse.promise
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    render(<App />)

    await act(async () => {
      firstResponse.resolve(
        createJsonResponse(200, {
          data: {
            id: 'u1',
            handle: 'Ada',
            displayName: 'Ada Lovelace',
            bio: 'Symbolic AI nerd.',
            avatarUrl: null,
            bannerUrl: null,
            expertise: ['llm'],
            counters: {
              posts: 12,
              followers: 34,
              following: 5,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
          errors: [],
        }),
      )
    })

    expect(
      await screen.findByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument()

    await act(async () => {
      window.history.pushState({}, '', '/u/Grace')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(
      await screen.findByRole('heading', { name: 'Loading public profile' }),
    ).toBeInTheDocument()

    await act(async () => {
      secondResponse.resolve(
        createJsonResponse(200, {
          data: {
            id: 'u2',
            handle: 'Grace',
            displayName: 'Grace Hopper',
            bio: 'Compiler pioneer.',
            avatarUrl: null,
            bannerUrl: null,
            expertise: ['compilers'],
            counters: {
              posts: 8,
              followers: 21,
              following: 3,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
          errors: [],
        }),
      )
    })

    expect(
      await screen.findByRole('heading', { name: 'Grace Hopper' }),
    ).toBeInTheDocument()
  })
})
