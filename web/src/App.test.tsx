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

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []

  static reset() {
    MockXMLHttpRequest.instances = []
  }

  method: string | null = null
  url: string | null = null
  body: Document | XMLHttpRequestBodyInit | null = null
  status = 0
  private readonly headers = new Map<string, string>()
  private readonly listeners = new Map<string, (event: Event) => void>()
  private readonly uploadListeners = new Map<
    string,
    (event: ProgressEvent) => void
  >()
  private readonly responseHeaders = new Map<string, string>()

  upload = {
    addEventListener: (type: string, listener: (event: ProgressEvent) => void) =>
      this.uploadListeners.set(type, listener),
  }

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener)
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null) {
    this.body = body
  }

  abort() {
    this.listeners.get('abort')?.(new Event('abort'))
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null
  }

  triggerProgress(loaded: number, total: number) {
    this.uploadListeners.get('progress')?.({
      loaded,
      total,
      lengthComputable: true,
    } as ProgressEvent)
  }

  respond(status: number, headers: Record<string, string> = {}) {
    this.status = status
    Object.entries(headers).forEach(([name, value]) => {
      this.responseHeaders.set(name.toLowerCase(), value)
    })
    this.listeners.get('load')?.(new Event('load'))
  }
}

function createPublicPost(overrides?: Record<string, unknown>) {
  return {
    id: 'post-1',
    type: 'post',
    kind: 'user',
    threadId: 'post-1',
    parentId: null,
    authorId: 'u1',
    authorHandle: 'ada',
    authorDisplayName: 'Ada Lovelace',
    authorAvatarUrl: null,
    text: 'Root thread post',
    hashtags: ['evals'],
    mentions: [],
    media: [],
    counters: {
      likes: 12,
      dislikes: 0,
      emoji: 3,
      replies: 2,
    },
    visibility: 'public',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    github: null,
    ...overrides,
  }
}

function createThreadPost(overrides?: Record<string, unknown>) {
  const post = createPublicPost(overrides)

  return {
    id: post.id,
    type: post.type,
    kind: post.kind,
    threadId: post.threadId,
    parentId: post.parentId,
    authorId: post.authorId,
    authorHandle: post.authorHandle,
    authorDisplayName: post.authorDisplayName,
    authorAvatarUrl: post.authorAvatarUrl,
    text: post.text,
    hashtags: post.hashtags,
    mentions: post.mentions,
    media: post.media,
    counters: post.counters,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    ...(post.github ? { github: post.github } : {}),
  }
}

function createResolvedMeProfile(overrides?: Record<string, unknown>) {
  return {
    isNewUser: false,
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
        posts: 1,
        followers: 8,
        following: 5,
      },
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T02:00:00.000Z',
      ...overrides,
    },
  }
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
    vi.stubGlobal(
      'XMLHttpRequest',
      MockXMLHttpRequest as unknown as typeof XMLHttpRequest,
    )
    MockXMLHttpRequest.reset()
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
    expect(screen.getByText('Direct upload pipeline')).toBeInTheDocument()
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

  it('uploads an avatar through the shared media pipeline and persists it to /api/me', async () => {
    window.history.replaceState({}, '', '/me')

    const uploadedAvatarUrl =
      'https://cdn.example.com/media/images/github%3Aabc123/2026/04/15/avatar.png'
    const uploadDescriptor = {
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 1024,
      containerName: 'images',
      blobName: 'github:abc123/2026/04/15/avatar.png',
      blobUrl: uploadedAvatarUrl,
      uploadUrl:
        'https://storage.example.blob.core.windows.net/images/github%3Aabc123/2026/04/15/avatar.png?sig=test',
      expiresAt: '2026-04-15T04:10:00.000Z',
      method: 'PUT',
      requiredHeaders: {
        'content-type': 'image/png',
        'x-ms-blob-type': 'BlockBlob',
      },
    }

    mockFetch.mockImplementation(async (input, init) => {
      if (String(input) === '/api/me' && (!init || !init.method)) {
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

      if (String(input) === '/api/media/upload-url') {
        return createJsonResponse(200, {
          data: uploadDescriptor,
          errors: [],
        })
      }

      if (String(input) === '/api/me' && init?.method === 'PUT') {
        return createJsonResponse(200, {
          data: {
            user: {
              id: 'github:abc123',
              identityProvider: 'github',
              identityProviderUserId: 'abc123',
              email: 'nick@example.com',
              handle: 'nick',
              displayName: 'Nick Beaugeard',
              bio: 'Building agent-first systems.',
              avatarUrl: uploadedAvatarUrl,
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
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Edit your profile' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Avatar upload file'), {
      target: {
        files: [
          new File(['avatar-bytes'], 'avatar.png', {
            type: 'image/png',
          }),
        ],
      },
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        '/api/media/upload-url',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            kind: 'image',
            contentType: 'image/png',
            sizeBytes: 12,
          }),
        }),
      )
    })

    const xhr = MockXMLHttpRequest.instances[0]
    expect(xhr).toBeDefined()
    expect(xhr?.method).toBe('PUT')
    expect(xhr?.url).toBe(uploadDescriptor.uploadUrl)

    await act(async () => {
      xhr?.triggerProgress(64, 128)
    })

    expect(
      await screen.findByText('Uploading directly to Blob Storage (50%).'),
    ).toBeInTheDocument()

    await act(async () => {
      xhr?.respond(201, {
        etag: '"etag-1"',
        'x-ms-request-id': 'request-1',
      })
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        '/api/me',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            avatarUrl: uploadedAvatarUrl,
          }),
        }),
      )
    })

    expect(
      await screen.findByText('Uploaded directly to Blob Storage.'),
    ).toBeInTheDocument()
    expect(screen.getByAltText('Profile avatar')).toHaveAttribute(
      'src',
      uploadedAvatarUrl,
    )
  })

  it('publishes a root post from the /me thread workspace', async () => {
    window.history.replaceState({}, '', '/me')

    mockFetch.mockImplementation(async (input, init) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(200, {
          data: createResolvedMeProfile(),
          errors: [],
        })
      }

      if (String(input) === '/api/posts') {
        return createJsonResponse(201, {
          data: {
            post: createPublicPost({
              id: 'post-2',
              text: JSON.parse(String(init?.body ?? '{}')).text,
            }),
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

    fireEvent.change(screen.getByLabelText('Thread post body'), {
      target: { value: 'Publishing a real workflow post from the /me route.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish post' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/posts',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: 'Publishing a real workflow post from the /me route.',
          }),
        }),
      )
    })

    expect(
      await screen.findByText('Post published to /p/post-2.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open standalone page' }),
    ).toHaveAttribute('href', '/p/post-2')
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

  it('renders the /p/{id} post detail route as a threaded conversation', async () => {
    window.history.replaceState({}, '', '/p/post-1')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(403, {
          data: null,
          errors: [
            {
              code: 'auth.forbidden',
              message: 'The authenticated user context was not available.',
            },
          ],
        })
      }

      if (String(input) === '/api/posts/post-1') {
        return createJsonResponse(200, {
          data: createPublicPost(),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-1') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-1',
            posts: [
              createThreadPost(),
              createThreadPost({
                id: 'reply-1',
                type: 'reply',
                parentId: 'post-1',
                text: 'Follow-up reply with more context.',
                createdAt: '2026-04-15T00:05:00.000Z',
                updatedAt: '2026-04-15T00:05:00.000Z',
              }),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Standalone post detail' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Thread conversation')).toBeInTheDocument()
    expect(screen.getByText('Root thread post')).toBeInTheDocument()
    expect(
      screen.getByText('Follow-up reply with more context.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Follow-up reply with more context.').closest(
        '[data-thread-entry]',
      ),
    ).toHaveAttribute('data-thread-depth', '1')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/me',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/posts/post-1',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      '/api/threads/post-1',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
  })

  it('renders the selected reply inside the threaded conversation', async () => {
    window.history.replaceState({}, '', '/p/reply-2')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(403, {
          data: null,
          errors: [
            {
              code: 'auth.forbidden',
              message: 'The authenticated user context was not available.',
            },
          ],
        })
      }

      if (String(input) === '/api/posts/reply-2') {
        return createJsonResponse(200, {
          data: createPublicPost({
            id: 'reply-2',
            type: 'reply',
            threadId: 'post-1',
            parentId: 'reply-1',
            text: 'Selected reply in the middle of the thread.',
            createdAt: '2026-04-15T00:06:00.000Z',
            updatedAt: '2026-04-15T00:06:00.000Z',
          }),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-1') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-1',
            posts: [
              createThreadPost(),
              createThreadPost({
                id: 'reply-1',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'post-1',
                text: 'Earlier reply that started the side discussion.',
                createdAt: '2026-04-15T00:05:00.000Z',
                updatedAt: '2026-04-15T00:05:00.000Z',
              }),
              createThreadPost({
                id: 'reply-2',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'reply-1',
                text: 'Selected reply in the middle of the thread.',
                createdAt: '2026-04-15T00:06:00.000Z',
                updatedAt: '2026-04-15T00:06:00.000Z',
              }),
              createThreadPost({
                id: 'reply-3',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'reply-2',
                text: 'Later reply that extends the thread.',
                createdAt: '2026-04-15T00:07:00.000Z',
                updatedAt: '2026-04-15T00:07:00.000Z',
              }),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByText('Selected reply in the middle of the thread.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Thread conversation')).toBeInTheDocument()
    expect(
      screen.getByText('Earlier reply that started the side discussion.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Later reply that extends the thread.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open thread root' }),
    ).toHaveAttribute('href', '/p/post-1')
  })

  it('renders image, gif, video, and audio attachments on the /p/{id} route', async () => {
    window.history.replaceState({}, '', '/p/post-mixed-media')

    const media = [
      {
        id: 'media-image',
        kind: 'image',
        url: 'https://cdn.example.com/media/launch-board.png',
        thumbUrl: 'https://cdn.example.com/media/launch-board-thumb.png',
        width: 1280,
        height: 720,
      },
      {
        id: 'media-gif',
        kind: 'gif',
        url: 'https://cdn.example.com/media/prompt-loop.gif',
        thumbUrl: 'https://cdn.example.com/media/prompt-loop.gif',
        width: 720,
        height: 720,
      },
      {
        id: 'media-video',
        kind: 'video',
        url: 'https://cdn.example.com/media/demo.mp4',
        thumbUrl: 'https://cdn.example.com/media/demo-poster.jpg',
        width: 1920,
        height: 1080,
      },
      {
        id: 'media-audio',
        kind: 'audio',
        url: 'https://cdn.example.com/media/voice-note.mp3',
        thumbUrl: null,
        width: null,
        height: null,
      },
    ]

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(403, {
          data: null,
          errors: [
            {
              code: 'auth.forbidden',
              message: 'The authenticated user context was not available.',
            },
          ],
        })
      }

      if (String(input) === '/api/posts/post-mixed-media') {
        return createJsonResponse(200, {
          data: createPublicPost({
            id: 'post-mixed-media',
            threadId: 'post-mixed-media',
            text: 'Mixed media launch update',
            media,
          }),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-mixed-media') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-mixed-media',
            posts: [
              createThreadPost({
                id: 'post-mixed-media',
                threadId: 'post-mixed-media',
                text: 'Mixed media launch update',
                media,
              }),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByAltText('image attachment from Ada Lovelace'),
    ).toBeInTheDocument()
    expect(
      screen.getByAltText('gif attachment from Ada Lovelace'),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('video attachment from Ada Lovelace'),
    ).toHaveAttribute('src', 'https://cdn.example.com/media/demo.mp4')
    expect(
      screen.getByLabelText('audio attachment from Ada Lovelace'),
    ).toHaveAttribute('src', 'https://cdn.example.com/media/voice-note.mp3')
    expect(screen.getAllByRole('link', { name: 'Open media' })).toHaveLength(4)
  })

  it('lets an authenticated viewer reply in-thread and soft-delete their reply', async () => {
    window.history.replaceState({}, '', '/p/post-1')

    const storedReplies: Array<Record<string, unknown>> = []
    let deletedReply: Record<string, unknown> | null = null

    mockFetch.mockImplementation(async (input, init) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(200, {
          data: createResolvedMeProfile(),
          errors: [],
        })
      }

      if (String(input) === '/api/posts/post-1') {
        return createJsonResponse(200, {
          data: createPublicPost(),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-1') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-1',
            posts: [
              createThreadPost(),
              ...storedReplies
                .filter((reply) => reply.deletedAt === null)
                .map((reply) => createThreadPost(reply)),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      if (String(input) === '/api/posts/post-1/replies') {
        storedReplies.push({
          id: 'reply-owned',
          type: 'reply',
          kind: 'user',
          threadId: 'post-1',
          parentId: 'post-1',
          authorId: 'github:abc123',
          authorHandle: 'ada',
          authorDisplayName: 'Ada Lovelace',
          authorAvatarUrl: null,
          text: JSON.parse(String(init?.body ?? '{}')).text,
          hashtags: [],
          mentions: [],
          media: [],
          counters: {
            likes: 0,
            dislikes: 0,
            emoji: 0,
            replies: 0,
          },
          visibility: 'public',
          createdAt: '2026-04-15T00:10:00.000Z',
          updatedAt: '2026-04-15T00:10:00.000Z',
          deletedAt: null,
        })

        return createJsonResponse(201, {
          data: {
            post: storedReplies[0],
          },
          errors: [],
        })
      }

      if (
        String(input) === '/api/posts/reply-owned' &&
        init?.method === 'DELETE'
      ) {
        deletedReply = {
          ...storedReplies[0],
          text: null,
          deletedAt: '2026-04-15T00:12:00.000Z',
          updatedAt: '2026-04-15T00:12:00.000Z',
        }
        storedReplies[0] = deletedReply

        return createJsonResponse(200, {
          data: {
            id: 'reply-owned',
            threadId: 'post-1',
            deletedAt: '2026-04-15T00:12:00.000Z',
            alreadyDeleted: false,
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Standalone post detail' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Thread reply body'), {
      target: { value: 'Owned reply that should disappear after soft delete.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reply in thread' }))

    expect(
      await screen.findByText('Reply published and thread refreshed.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Owned reply that should disappear after soft delete.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete reply' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }))

    expect(
      await screen.findByText('Reply removed from the public thread view.'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.queryByText('Owned reply that should disappear after soft delete.'),
      ).not.toBeInTheDocument()
    })

    expect(deletedReply).toMatchObject({
      id: 'reply-owned',
      text: null,
      deletedAt: '2026-04-15T00:12:00.000Z',
    })
  })

  it('lets an authenticated viewer publish a GIF-only Tenor reply', async () => {
    window.history.replaceState({}, '', '/p/post-1')

    const storedReplies: Array<Record<string, unknown>> = []

    mockFetch.mockImplementation(async (input, init) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(200, {
          data: createResolvedMeProfile(),
          errors: [],
        })
      }

      if (String(input) === '/api/posts/post-1') {
        return createJsonResponse(200, {
          data: createPublicPost(),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-1') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-1',
            posts: [
              createThreadPost(),
              ...storedReplies
                .filter((reply) => reply.deletedAt === null)
                .map((reply) => createThreadPost(reply)),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      if (String(input).startsWith('/api/gifs/search')) {
        return createJsonResponse(200, {
          data: {
            mode:
              String(input).includes('q=party+parrot') ? 'search' : 'featured',
            query:
              String(input).includes('q=party+parrot') ? 'party parrot' : '',
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
          },
          errors: [],
        })
      }

      if (String(input).startsWith('/api/gifs/search')) {
        return createJsonResponse(200, {
          data: {
            mode: 'featured',
            query: '',
            results: [],
          },
          errors: [],
        })
      }

      if (String(input) === '/api/posts/post-1/replies') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as {
          media?: Array<Record<string, unknown>>
          text?: string
        }

        storedReplies.push({
          id: 'reply-gif',
          type: 'reply',
          kind: 'user',
          threadId: 'post-1',
          parentId: 'post-1',
          authorId: 'github:abc123',
          authorHandle: 'ada',
          authorDisplayName: 'Ada Lovelace',
          authorAvatarUrl: null,
          text: payload.text ?? '',
          hashtags: [],
          mentions: [],
          media: payload.media ?? [],
          counters: {
            likes: 0,
            dislikes: 0,
            emoji: 0,
            replies: 0,
          },
          visibility: 'public',
          createdAt: '2026-04-15T00:11:00.000Z',
          updatedAt: '2026-04-15T00:11:00.000Z',
          deletedAt: null,
        })

        return createJsonResponse(201, {
          data: {
            post: storedReplies[0],
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Standalone post detail' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search Tenor'), {
      target: { value: 'party parrot' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find GIFs' }))

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Reply with GIF: Party parrot celebration',
      }),
    )

    expect(
      await screen.findByText('GIF reply published and thread refreshed.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByAltText('gif attachment from Ada Lovelace'),
    ).toHaveAttribute('src', 'https://media.tenor.com/party-parrot-tiny.gif')

    expect(storedReplies[0]).toMatchObject({
      id: 'reply-gif',
      text: '',
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
    })
  })

  it('flattens replies beyond depth 3 while preserving replying-to context', async () => {
    window.history.replaceState({}, '', '/p/reply-4')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(403, {
          data: null,
          errors: [
            {
              code: 'auth.forbidden',
              message: 'The authenticated user context was not available.',
            },
          ],
        })
      }

      if (String(input) === '/api/posts/reply-4') {
        return createJsonResponse(200, {
          data: createPublicPost({
            id: 'reply-4',
            type: 'reply',
            threadId: 'post-1',
            parentId: 'reply-3',
            authorHandle: 'radia',
            authorDisplayName: 'Radia Perlman',
            text: 'Depth 4 reply that should flatten.',
            createdAt: '2026-04-15T00:08:00.000Z',
            updatedAt: '2026-04-15T00:08:00.000Z',
          }),
          errors: [],
        })
      }

      if (String(input) === '/api/threads/post-1') {
        return createJsonResponse(200, {
          data: {
            threadId: 'post-1',
            posts: [
              createThreadPost(),
              createThreadPost({
                id: 'reply-1',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'post-1',
                authorHandle: 'grace',
                authorDisplayName: 'Grace Hopper',
                text: 'Depth 1 reply.',
                createdAt: '2026-04-15T00:05:00.000Z',
                updatedAt: '2026-04-15T00:05:00.000Z',
              }),
              createThreadPost({
                id: 'reply-2',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'reply-1',
                authorHandle: 'linus',
                authorDisplayName: 'Linus Torvalds',
                text: 'Depth 2 reply.',
                createdAt: '2026-04-15T00:06:00.000Z',
                updatedAt: '2026-04-15T00:06:00.000Z',
              }),
              createThreadPost({
                id: 'reply-3',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'reply-2',
                authorHandle: 'yann',
                authorDisplayName: 'Yann Sutskever',
                text: 'Depth 3 reply.',
                createdAt: '2026-04-15T00:07:00.000Z',
                updatedAt: '2026-04-15T00:07:00.000Z',
              }),
              createThreadPost({
                id: 'reply-4',
                type: 'reply',
                threadId: 'post-1',
                parentId: 'reply-3',
                authorHandle: 'radia',
                authorDisplayName: 'Radia Perlman',
                text: 'Depth 4 reply that should flatten.',
                createdAt: '2026-04-15T00:08:00.000Z',
                updatedAt: '2026-04-15T00:08:00.000Z',
              }),
            ],
            continuationToken: null,
          },
          errors: [],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByText('Depth 4 reply that should flatten.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Replying to @yann')).toBeInTheDocument()

    const depthThreeEntry = screen
      .getByText('Depth 3 reply.')
      .closest('[data-thread-entry]')
    const depthFourEntry = screen
      .getByText('Depth 4 reply that should flatten.')
      .closest('[data-thread-entry]')

    expect(depthThreeEntry).toHaveAttribute('data-thread-depth', '3')
    expect(depthThreeEntry).toHaveAttribute('data-thread-visual-depth', '3')
    expect(depthThreeEntry).toHaveStyle({ marginLeft: '3.75rem' })
    expect(depthFourEntry).toHaveAttribute('data-thread-depth', '4')
    expect(depthFourEntry).toHaveAttribute('data-thread-visual-depth', '3')
    expect(depthFourEntry).toHaveStyle({ marginLeft: '3.75rem' })
  })

  it('renders a not-found state when the post does not exist', async () => {
    window.history.replaceState({}, '', '/p/missing')

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/me') {
        return createJsonResponse(403, {
          data: null,
          errors: [
            {
              code: 'auth.forbidden',
              message: 'The authenticated user context was not available.',
            },
          ],
        })
      }

      if (String(input) === '/api/posts/missing') {
        return createJsonResponse(404, {
          data: null,
          errors: [
            {
              code: 'post_not_found',
              message: 'No public post exists for the requested id.',
              field: 'id',
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Post not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No public post exists for the requested id.'),
    ).toBeInTheDocument()
  })
})
