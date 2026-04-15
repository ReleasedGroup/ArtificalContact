import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mockFetch = vi.fn()

function createJsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('renders the sign-in screen and exposes both SWA auth providers', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse({
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
      }),
    )

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

  it('loads the /me profile editor with existing profile data', async () => {
    window.history.pushState({}, '', '/me')
    mockFetch.mockResolvedValue(
      createJsonResponse({
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
      }),
    )

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Edit your profile' }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('Nick Beaugeard')).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('Building agent-first systems.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agents ×' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evals ×' })).toBeInTheDocument()
  })

  it('saves profile edits from the /me editor', async () => {
    window.history.pushState({}, '', '/me')
    mockFetch
      .mockResolvedValueOnce(
        createJsonResponse({
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
              expertise: ['agents'],
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
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            isNewUser: false,
            user: {
              id: 'github:abc123',
              identityProvider: 'github',
              identityProviderUserId: 'abc123',
              email: 'nick@example.com',
              handle: 'nick',
              displayName: 'Ada Lovelace',
              bio: 'Designing resilient evaluation loops.',
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
              updatedAt: '2026-04-15T02:00:00.000Z',
            },
          },
          errors: [],
        }),
      )

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Edit your profile' }),
    ).toBeInTheDocument()

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
          displayName: 'Ada Lovelace',
          bio: 'Designing resilient evaluation loops.',
          avatarUrl: null,
          bannerUrl: null,
          expertise: ['agents', 'evals'],
        }),
      }),
    )

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })
})
