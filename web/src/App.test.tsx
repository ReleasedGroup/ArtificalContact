import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mockFetch = vi.fn()

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

  it('renders the foundation shell and shows a healthy API check', async () => {
    render(<App />)

    expect(
      screen.getByRole('heading', {
        name: 'ArtificialContact is ready for feature work.',
      }),
    ).toBeInTheDocument()

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(/sha-1234/)).toBeInTheDocument()
    expect(screen.getByText(/Cosmos ping:/)).toBeInTheDocument()
  })
})
