import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createQueryClient } from './lib/query-client'

const mockFetch = vi.fn()

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
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
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
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the sign-in screen and exposes both SWA auth providers', async () => {
    renderApp()

    expect(
      screen.getByRole('heading', {
        name: 'Sign in to ArtificialContact.',
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /continue with microsoft/i }),
    ).toHaveAttribute('href', '/.auth/login/aad?post_login_redirect_uri=%2F')
    expect(
      screen.getByRole('link', { name: /continue with github/i }),
    ).toHaveAttribute('href', '/.auth/login/github?post_login_redirect_uri=%2F')
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(/sha-1234/)).toBeInTheDocument()
    expect(screen.getByText(/Cosmos ping:/)).toBeInTheDocument()
  })
})
