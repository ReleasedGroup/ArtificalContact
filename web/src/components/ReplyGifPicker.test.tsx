import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReplyGifPicker } from './ReplyGifPicker'
import { searchGifs } from '../lib/gif-search'

vi.mock('../lib/gif-search', () => ({
  searchGifs: vi.fn(),
}))

describe('ReplyGifPicker', () => {
  it('retries the same query after a failed GIF search', async () => {
    const mockedSearchGifs = vi.mocked(searchGifs)

    mockedSearchGifs
      .mockResolvedValueOnce({
        mode: 'featured',
        query: '',
        results: [],
      })
      .mockRejectedValueOnce(new Error('Tenor is warming up.'))
      .mockResolvedValueOnce({
        mode: 'search',
        query: 'party parrot',
        results: [
          {
            id: 'tenor-123',
            title: 'Party parrot celebration',
            previewUrl: 'https://media.tenor.com/party-parrot-tiny.gif',
            gifUrl: 'https://media.tenor.com/party-parrot-full.gif',
            width: 320,
            height: 240,
          },
        ],
      })

    render(<ReplyGifPicker onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(mockedSearchGifs).toHaveBeenCalledTimes(1)
    })

    fireEvent.change(screen.getByPlaceholderText('Search Tenor'), {
      target: { value: 'party parrot' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find GIFs' }))

    await waitFor(() => {
      expect(mockedSearchGifs).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('Tenor is warming up.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Find GIFs' }))

    await waitFor(() => {
      expect(mockedSearchGifs).toHaveBeenCalledTimes(3)
    })
    expect(
      await screen.findByRole('button', {
        name: 'Reply with GIF: Party parrot celebration',
      }),
    ).toBeInTheDocument()
  }, 10_000)
})
