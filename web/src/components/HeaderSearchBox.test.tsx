import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeaderSearchBox } from './HeaderSearchBox'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('HeaderSearchBox', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('debounces /api/search calls and renders grouped quick results', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          query: 'ada',
          type: 'all',
          users: [
            {
              id: 'user-1',
              handle: 'ada',
              displayName: 'Ada Lovelace',
              bio: 'Search engineer.',
              expertise: ['search'],
              followerCount: 4200,
            },
          ],
          posts: [
            {
              id: 'post-1',
              postId: 'post-1',
              authorHandle: 'ada',
              excerpt: 'Building robust agent search experiences.',
              createdAt: '2026-04-16T00:00:00.000Z',
              hashtags: ['search'],
              mediaKinds: [],
              kind: 'user',
            },
          ],
        },
        errors: [],
      }),
    )

    render(<HeaderSearchBox />)

    const input = screen.getByRole('searchbox', {
      name: 'Search people and posts',
    })

    fireEvent.focus(input)
    fireEvent.change(input, {
      target: {
        value: 'a',
      },
    })

    expect(
      screen.getByText('Type at least 2 characters to search.'),
    ).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()

    fireEvent.change(input, {
      target: {
        value: 'ada',
      },
    })

    await act(async () => {
      vi.advanceTimersByTime(249)
    })

    expect(mockFetch).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/search?q=ada&limit=4',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(
      screen.getByText('Building robust agent search experiences.'),
    ).toBeInTheDocument()
  })

  it('renders an empty state when the search endpoint returns no quick results', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse(200, {
        data: {
          query: 'zz',
          type: 'all',
          users: [],
          posts: [],
        },
        errors: [],
      }),
    )

    render(<HeaderSearchBox />)

    const input = screen.getByRole('searchbox', {
      name: 'Search people and posts',
    })

    fireEvent.focus(input)
    fireEvent.change(input, {
      target: {
        value: 'zz',
      },
    })

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      screen.getByText('No quick results matched "zz".'),
    ).toBeInTheDocument()
  })

  it('does not issue a search request after the control loses focus', async () => {
    render(<HeaderSearchBox />)

    const input = screen.getByRole('searchbox', {
      name: 'Search people and posts',
    })

    fireEvent.focus(input)
    fireEvent.change(input, {
      target: {
        value: 'ada',
      },
    })
    fireEvent.blur(input)

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
