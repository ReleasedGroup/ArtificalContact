import { expect, test, type Page, type Route } from '@playwright/test'

interface MockUser {
  id: string
  email: string
  handle: string
  displayName: string
}

interface MockPost {
  id: string
  type: 'post'
  kind: 'user'
  threadId: string
  parentId: null
  authorId: string
  authorHandle: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  text: string
  hashtags: string[]
  mentions: string[]
  media: []
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  visibility: 'public'
  createdAt: string
  updatedAt: string
  deletedAt: null
}

interface SearchEnvelope {
  data: {
    '@odata.count'?: number
    value: MockPost[]
  } | null
  errors: Array<{
    code: string
    message: string
    field?: string
  }>
}

const currentUser: MockUser = {
  id: 'github:user-search',
  email: 'searcher@example.com',
  handle: 'searcher',
  displayName: 'Search Tester',
}

function createMePayload(user: MockUser) {
  return {
    isNewUser: false,
    user: {
      id: user.id,
      identityProvider: 'github',
      identityProviderUserId: user.id.replace('github:', ''),
      email: user.email,
      handle: user.handle,
      displayName: user.displayName,
      bio: `${user.displayName} validating post search indexing.`,
      avatarUrl: null,
      bannerUrl: null,
      expertise: ['search', 'playwright'],
      links: {},
      status: 'active',
      roles: ['user'],
      counters: {
        posts: 0,
        followers: 0,
        following: 0,
      },
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
  }
}

function createPostRecord(user: MockUser, text: string): MockPost {
  return {
    id: 'post-1',
    type: 'post',
    kind: 'user',
    threadId: 'post-1',
    parentId: null,
    authorId: user.id,
    authorHandle: user.handle,
    authorDisplayName: user.displayName,
    authorAvatarUrl: null,
    text,
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
    createdAt: '2026-04-15T00:01:00.000Z',
    updatedAt: '2026-04-15T00:01:00.000Z',
    deletedAt: null,
  }
}

function jsonResponse(route: Route, status: number, payload: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

async function fetchSearchResults(page: Page, query: string): Promise<SearchEnvelope> {
  return page.evaluate(async (searchQuery) => {
    const response = await fetch(
      `/api/search?${new URLSearchParams({
        q: searchQuery,
        type: 'posts',
      }).toString()}`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    )

    return (await response.json()) as SearchEnvelope
  }, query)
}

test('a published post becomes searchable within five simulated seconds', async ({
  baseURL,
  browser,
}) => {
  const posts = new Map<string, MockPost>()
  // Simulate asynchronous indexing while keeping the browser flow local and deterministic.
  const searchableAt = new Map<string, number>()
  const indexingDelayMs = 1_500
  const postText =
    'Azure AI Search should surface this Playwright post inside five seconds.'

  const context = await browser.newContext()
  try {
    await context.route('**/api/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const pathname = url.pathname

      if (pathname === '/api/me' && request.method() === 'GET') {
        await jsonResponse(route, 200, {
          data: createMePayload(currentUser),
          errors: [],
        })
        return
      }

      if (pathname === '/api/posts' && request.method() === 'POST') {
        const payload = request.postDataJSON() as { text: string }
        const createdPost = createPostRecord(currentUser, payload.text.trim())
        posts.set(createdPost.id, createdPost)
        searchableAt.set(createdPost.id, Date.now() + indexingDelayMs)

        await jsonResponse(route, 201, {
          data: {
            post: createdPost,
          },
          errors: [],
        })
        return
      }

      if (pathname === '/api/search' && request.method() === 'GET') {
        const query = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
        const now = Date.now()
        const matchedPosts = [...posts.values()].filter((post) => {
          const readyAt = searchableAt.get(post.id) ?? Number.POSITIVE_INFINITY
          return (
            readyAt <= now &&
            post.deletedAt === null &&
            (query.length === 0 || post.text.toLowerCase().includes(query))
          )
        })

        await jsonResponse(route, 200, {
          data: {
            '@odata.count': matchedPosts.length,
            value: matchedPosts,
          },
          errors: [],
        })
        return
      }

      throw new Error(`Unexpected API request: ${request.method()} ${pathname}`)
    })

    const page = await context.newPage()

    await page.goto(`${baseURL}/me`)
    await expect(
      page.getByRole('heading', { name: 'Edit your profile' }),
    ).toBeVisible()

    const threadWorkspace = page.getByTestId('thread-workspace')
    await threadWorkspace.scrollIntoViewIfNeeded()
    await threadWorkspace.locator('textarea').first().fill(postText)
    await threadWorkspace.getByRole('button', { name: 'Publish post' }).click()

    await expect(page.getByText('Post published to /p/post-1.')).toBeVisible()

    const publishConfirmedAt = Date.now()

    await expect
      .poll(
        async () => {
          const payload = await fetchSearchResults(page, 'Playwright post')
          return payload.data?.value.some((post) => post.id === 'post-1') ?? false
        },
        {
          timeout: 5_000,
          intervals: [250, 500, 1_000],
        },
      )
      .toBe(true)

    const elapsedMs = Date.now() - publishConfirmedAt
    expect(elapsedMs).toBeLessThanOrEqual(5_000)

    const payload = await fetchSearchResults(page, 'Playwright post')
    expect(payload.errors).toEqual([])
    expect(payload.data).toMatchObject({
      '@odata.count': 1,
      value: [
        {
          id: 'post-1',
          text: postText,
          authorHandle: 'searcher',
        },
      ],
    })
  } finally {
    await context.close()
  }
})
