import { expect, test, type BrowserContext, type Route } from '@playwright/test'

interface MockUser {
  id: string
  email: string
  handle: string
  displayName: string
}

interface MockPost {
  id: string
  type: 'post' | 'reply'
  kind: 'user'
  threadId: string
  parentId: string | null
  authorId: string
  authorHandle: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  text: string | null
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
  deletedAt: string | null
}

const users: Record<'userA' | 'userB', MockUser> = {
  userA: {
    id: 'github:user-a',
    email: 'ada@example.com',
    handle: 'ada',
    displayName: 'Ada Lovelace',
  },
  userB: {
    id: 'github:user-b',
    email: 'grace@example.com',
    handle: 'grace',
    displayName: 'Grace Hopper',
  },
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
      bio: `${user.displayName} testing the thread workflow.`,
      avatarUrl: null,
      bannerUrl: null,
      expertise: ['threads', 'playwright'],
      links: {},
      status: 'active',
      roles: ['user'],
      counters: {
        posts: 1,
        followers: 0,
        following: 0,
      },
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
  }
}

function createPostRecord(
  user: MockUser,
  options: {
    id: string
    type: 'post' | 'reply'
    threadId: string
    parentId: string | null
    text: string
    createdAt: string
  },
): MockPost {
  return {
    id: options.id,
    type: options.type,
    kind: 'user',
    threadId: options.threadId,
    parentId: options.parentId,
    authorId: user.id,
    authorHandle: user.handle,
    authorDisplayName: user.displayName,
    authorAvatarUrl: null,
    text: options.text,
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
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
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

test('two users can post, reply, and hide a soft-deleted reply from the public thread', async ({
  baseURL,
  browser,
}) => {
  const posts = new Map<string, MockPost>()
  let rootPostId: string | null = null
  let replyPostId: string | null = null

  const syncReplyCounts = () => {
    for (const post of posts.values()) {
      const activeReplies = [...posts.values()].filter(
        (candidate) =>
          candidate.parentId === post.id && candidate.deletedAt === null,
      ).length
      post.counters.replies = activeReplies
    }
  }

  const visiblePost = (postId: string) => {
    const post = posts.get(postId)
    return post && post.deletedAt === null ? post : null
  }

  const visibleThread = (threadId: string) =>
    [...posts.values()]
      .filter(
        (post) => post.threadId === threadId && post.deletedAt === null,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const attachApiMocks = async (
    context: BrowserContext,
    userKey: keyof typeof users,
  ) => {
    const currentUser = users[userKey]

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
        const createdPost = createPostRecord(currentUser, {
          id: 'post-1',
          type: 'post',
          threadId: 'post-1',
          parentId: null,
          text: payload.text.trim(),
          createdAt: '2026-04-15T00:01:00.000Z',
        })
        rootPostId = createdPost.id
        posts.set(createdPost.id, createdPost)
        syncReplyCounts()

        await jsonResponse(route, 201, {
          data: {
            post: createdPost,
          },
          errors: [],
        })
        return
      }

      if (pathname.startsWith('/api/posts/') && pathname.endsWith('/replies')) {
        const parentId = pathname.split('/')[3] ?? ''
        const parentPost = visiblePost(parentId)

        if (!parentPost) {
          await jsonResponse(route, 404, {
            data: null,
            errors: [
              {
                code: 'post_not_found',
                message: 'No public post exists for the requested id.',
              },
            ],
          })
          return
        }

        const payload = request.postDataJSON() as { text: string }
        const createdReply = createPostRecord(currentUser, {
          id: 'reply-1',
          type: 'reply',
          threadId: parentPost.threadId,
          parentId: parentPost.id,
          text: payload.text.trim(),
          createdAt: '2026-04-15T00:02:00.000Z',
        })
        replyPostId = createdReply.id
        posts.set(createdReply.id, createdReply)
        syncReplyCounts()

        await jsonResponse(route, 201, {
          data: {
            post: createdReply,
          },
          errors: [],
        })
        return
      }

      if (pathname.startsWith('/api/posts/') && request.method() === 'GET') {
        const postId = pathname.split('/')[3] ?? ''
        const post = visiblePost(postId)

        if (!post) {
          await jsonResponse(route, 404, {
            data: null,
            errors: [
              {
                code: 'post_not_found',
                message: 'No public post exists for the requested id.',
              },
            ],
          })
          return
        }

        await jsonResponse(route, 200, {
          data: post,
          errors: [],
        })
        return
      }

      if (pathname.startsWith('/api/posts/') && request.method() === 'DELETE') {
        const postId = pathname.split('/')[3] ?? ''
        const post = posts.get(postId)

        if (!post) {
          await jsonResponse(route, 404, {
            data: null,
            errors: [
              {
                code: 'post_not_found',
                message: 'No public post exists for the requested id.',
              },
            ],
          })
          return
        }

        post.deletedAt = '2026-04-15T00:03:00.000Z'
        post.updatedAt = post.deletedAt
        post.text = null
        syncReplyCounts()

        await jsonResponse(route, 200, {
          data: {
            id: post.id,
            threadId: post.threadId,
            deletedAt: post.deletedAt,
            alreadyDeleted: false,
          },
          errors: [],
        })
        return
      }

      if (pathname.startsWith('/api/threads/') && request.method() === 'GET') {
        const threadId = pathname.split('/')[3] ?? ''
        const threadPosts = visibleThread(threadId)

        if (threadPosts.length === 0) {
          await jsonResponse(route, 404, {
            data: null,
            errors: [
              {
                code: 'thread_not_found',
                message: 'No public thread exists for the requested thread id.',
              },
            ],
          })
          return
        }

        await jsonResponse(route, 200, {
          data: {
            threadId,
            posts: threadPosts,
            continuationToken: null,
          },
          errors: [],
        })
        return
      }

      throw new Error(`Unexpected API request: ${request.method()} ${pathname}`)
    })
  }

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  await attachApiMocks(contextA, 'userA')
  await attachApiMocks(contextB, 'userB')

  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await pageA.goto(`${baseURL}/me`)
  await expect(
    pageA.getByRole('heading', { name: 'Edit your profile' }),
  ).toBeVisible()

  await pageA.getByLabel('Thread post body').fill('User A root post for the shared thread.')
  await pageA.getByRole('button', { name: 'Publish post' }).click()

  await expect(pageA.getByText('Post published to /p/post-1.')).toBeVisible()
  await expect(
    pageA.getByRole('link', { name: 'Open standalone page' }),
  ).toHaveAttribute('href', '/p/post-1')

  await pageA.getByRole('link', { name: 'Open standalone page' }).click()
  await expect(pageA).toHaveURL(/\/p\/post-1$/)
  await expect(
    pageA.getByText('User A root post for the shared thread.'),
  ).toBeVisible()

  await pageB.goto(`${baseURL}/p/post-1`)
  await expect(
    pageB.getByText('User A root post for the shared thread.'),
  ).toBeVisible()

  await pageB.getByLabel('Thread reply body').fill('User B reply that should later be soft-deleted.')
  await pageB.getByRole('button', { name: 'Reply in thread' }).click()

  await expect(
    pageB.getByText('Reply published and thread refreshed.'),
  ).toBeVisible()
  await expect(
    pageB.getByText('User B reply that should later be soft-deleted.'),
  ).toBeVisible()

  await pageA.reload()
  await expect(
    pageA.getByText('User B reply that should later be soft-deleted.'),
  ).toBeVisible()

  await pageB.getByRole('button', { name: 'Delete reply' }).click()
  await expect(
    pageB.getByText('Reply removed from the public thread view.'),
  ).toBeVisible()
  await expect(
    pageB.getByText('User B reply that should later be soft-deleted.'),
  ).toHaveCount(0)

  await pageA.reload()
  await expect(
    pageA.getByText('User B reply that should later be soft-deleted.'),
  ).toHaveCount(0)

  expect(rootPostId).toBe('post-1')
  expect(replyPostId).toBe('reply-1')
  expect(posts.get('reply-1')).toMatchObject({
    deletedAt: '2026-04-15T00:03:00.000Z',
    text: null,
  })

  await contextA.close()
  await contextB.close()
})
