import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createQueryClient } from './lib/query-client'

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

function renderApp() {
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
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

    renderApp()

    expect(
      screen.getByRole('heading', {
        name: 'Sign in to ArtificialContact.',
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /continue with microsoft/i }),
    ).toHaveAttribute('href', '/.auth/login/aad?post_login_redirect_uri=%2Fme')
    expect(
      screen.getByRole('link', { name: /continue with github/i }),
    ).toHaveAttribute(
      'href',
      '/.auth/login/github?post_login_redirect_uri=%2Fme',
    )
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(/sha-1234/)).toBeInTheDocument()
    expect(screen.getByText(/Cosmos ping:/)).toBeInTheDocument()
  })

  it('loads the /me profile editor with existing profile data', async () => {
    window.history.replaceState({}, '', '/me')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(200, {
          data: {
            isNewUser: false,
            user: {
              id: 'github:abc123',
              identityProvider: 'github',
              identityProviderUserId: 'abc123',
              email: 'nick@example.com',
              handle: 'nick',
              displayName: 'Nick Beaugeard',
              bio: 'Building agent-first systems.',
              avatarUrl: null,
              bannerUrl: null,
              expertise: ['agents', 'evals'],
              links: {},
              status: 'active',
              roles: ['user'],
              counters: {
                posts: 3,
                followers: 8,
                following: 5,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
            },
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Edit your profile' }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('nick')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Nick Beaugeard')).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('Building agent-first systems.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agents ×' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evals ×' })).toBeInTheDocument()
    expect(screen.getByText('Composer preview')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', {
        name: 'Post body',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', {
        name: 'Reply body',
      }),
    ).toBeInTheDocument()
  })

  it('renders the /me error state when the profile request fails', async () => {
    window.history.replaceState({}, '', '/me')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(500, {
          data: null,
          errors: [
            {
              code: 'server.user_lookup_failed',
              message: 'Unable to resolve the authenticated user profile.',
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', {
        name: 'The profile editor could not load.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Unable to resolve the authenticated user profile.'),
    ).toBeInTheDocument()
  })

  it('claims a handle and saves profile edits from the /me editor', async () => {
    window.history.replaceState({}, '', '/me')
    let requestCount = 0

    mockFetch.mockImplementation(async (input) => {
      if (String(input) !== '/api/me') {
        throw new Error(`Unexpected fetch request: ${String(input)}`)
      }

      requestCount += 1

      if (requestCount === 1) {
        return createJsonResponse(200, {
          data: {
            isNewUser: true,
            user: {
              id: 'github:abc123',
              identityProvider: 'github',
              identityProviderUserId: 'abc123',
              email: 'nick@example.com',
              handle: null,
              displayName: 'Nick',
              bio: null,
              avatarUrl: null,
              bannerUrl: null,
              expertise: ['agents'],
              links: {},
              status: 'pending',
              roles: ['user'],
              counters: {
                posts: 0,
                followers: 0,
                following: 0,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T01:00:00.000Z',
            },
          },
          errors: [],
        })
      }

      return createJsonResponse(200, {
        data: {
          user: {
            id: 'github:abc123',
            identityProvider: 'github',
            identityProviderUserId: 'abc123',
            email: 'nick@example.com',
            handle: 'ada',
            displayName: 'Ada Lovelace',
            bio: 'Designing resilient evaluation loops.',
            avatarUrl: null,
            bannerUrl: null,
            expertise: ['agents', 'evals'],
            links: {},
            status: 'active',
            roles: ['user'],
            counters: {
              posts: 0,
              followers: 0,
              following: 0,
            },
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T02:00:00.000Z',
          },
        },
        errors: [],
      })
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Edit your profile' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Public handle'), {
      target: { value: 'ada' },
    })
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.change(screen.getByLabelText('Bio'), {
      target: { value: 'Designing resilient evaluation loops.' },
    })
    fireEvent.change(screen.getByLabelText('Expertise tags'), {
      target: { value: 'evals' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/me',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          handle: 'ada',
          displayName: 'Ada Lovelace',
          bio: 'Designing resilient evaluation loops.',
          avatarUrl: null,
          bannerUrl: null,
          expertise: ['agents', 'evals'],
        }),
      }),
    )

    expect(
      await screen.findByText('Profile created. Your public profile is live.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View public profile' }),
    ).toHaveAttribute('href', '/u/ada')
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

    renderApp()

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

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Profile not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No public profile exists for the requested handle.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to sign-in' }),
    ).toHaveAttribute('href', '/')
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

    renderApp()

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
