import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeFeedComposer } from './HomeFeedComposer'
import type { MeProfile } from '../lib/me'
import { uploadMediaFile } from '../lib/media-upload'
import { searchGifs } from '../lib/gif-search'

vi.mock('../lib/media-upload', async () => {
  const actual = await vi.importActual<typeof import('../lib/media-upload')>(
    '../lib/media-upload',
  )

  return {
    ...actual,
    uploadMediaFile: vi.fn(),
  }
})

vi.mock('../lib/gif-search', () => ({
  searchGifs: vi.fn(),
}))

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function createViewer(overrides?: Partial<MeProfile>): MeProfile {
  return {
    id: 'github:viewer-1',
    identityProvider: 'github',
    identityProviderUserId: 'viewer-1',
    email: 'ada@example.com',
    handle: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Following agent builders and evaluation engineers.',
    avatarUrl: null,
    bannerUrl: null,
    expertise: ['agents'],
    links: {},
    status: 'active',
    roles: ['user'],
    counters: {
      posts: 4,
      followers: 12,
      following: 8,
    },
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('HomeFeedComposer', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    vi.mocked(uploadMediaFile).mockReset()
    vi.mocked(searchGifs).mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads an image attachment and publishes it to the home feed', async () => {
    vi.mocked(uploadMediaFile).mockResolvedValue({
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 2048,
      containerName: 'images',
      blobName: 'github:viewer-1/2026/04/16/diagram.png',
      blobUrl: 'https://cdn.example.com/media/diagram.png',
      uploadUrl: 'https://storage.example.com/upload',
      expiresAt: '2026-04-16T09:00:00.000Z',
      method: 'PUT',
      requiredHeaders: {
        'content-type': 'image/png',
        'x-ms-blob-type': 'BlockBlob',
      },
      etag: '"etag-1"',
      requestId: 'req-1',
    })

    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'post-with-image',
          },
        },
        errors: [],
      }),
    )

    const onPublished = vi.fn()
    render(
      <HomeFeedComposer onPublished={onPublished} viewer={createViewer()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Browse images' }))
    fireEvent.change(screen.getByLabelText('Post image upload file'), {
      target: {
        files: [
          new File(['diagram'], 'diagram.png', {
            type: 'image/png',
          }),
        ],
      },
    })

    expect(
      await screen.findByText('diagram.png', {}, { timeout: 5_000 }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/posts',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            media: [
              {
                kind: 'image',
                url: 'https://cdn.example.com/media/diagram.png',
                thumbUrl: 'https://cdn.example.com/media/diagram.png',
              },
            ],
          }),
        }),
      )
    })

    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('attaches a Tenor GIF and publishes a media-only post', async () => {
    vi.mocked(searchGifs).mockResolvedValue({
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

    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          post: {
            id: 'post-with-gif',
          },
        },
        errors: [],
      }),
    )

    render(<HomeFeedComposer viewer={createViewer()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse GIFs' }))

    await waitFor(() => {
      expect(vi.mocked(searchGifs)).toHaveBeenCalledTimes(1)
    })

    fireEvent.change(screen.getByPlaceholderText('Search Tenor'), {
      target: { value: 'party parrot' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find GIFs' }))

    const attachButton = await screen.findByRole('button', {
      name: 'Attach GIF: Party parrot celebration',
    })
    fireEvent.click(attachButton)

    expect(await screen.findByText('Party parrot celebration')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/posts',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            media: [
              {
                id: 'tenor-123',
                kind: 'gif',
                url: 'https://media.tenor.com/party-parrot-full.gif',
                thumbUrl: 'https://media.tenor.com/party-parrot-tiny.gif',
                width: 320,
                height: 240,
              },
            ],
          }),
        }),
      )
    })
  })
})
