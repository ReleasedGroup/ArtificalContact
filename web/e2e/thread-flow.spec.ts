import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test'

interface MockUser {
  id: string
  email: string
  handle: string
  displayName: string
}

interface MockPostMedia {
  id: string
  kind: 'gif'
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
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
  media: MockPostMedia[]
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

interface NotificationActorRecord {
  id?: string | null
  handle?: string | null
  displayName?: string | null
  avatarUrl?: string | null
}

interface NotificationRecord {
  id: string
  eventType: string
  text: string | null
  read: boolean
  createdAt: string
  postId: string | null
  threadId: string | null
  actor: NotificationActorRecord | null
}

interface NotificationsEnvelope {
  data: NotificationRecord[] | null
  cursor: string | null
  unreadCount: number
  errors: Array<{
    code: string
    message: string
    field?: string
  }>
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
    text?: string
    createdAt: string
    media?: MockPostMedia[]
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
    text: options.text ?? '',
    hashtags: [],
    mentions: [],
    media: options.media ?? [],
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

async function fetchNotifications(page: Page): Promise<NotificationsEnvelope> {
  return page.evaluate(async () => {
    const response = await fetch('/api/notifications', {
      headers: {
        Accept: 'application/json',
      },
    })

    return (await response.json()) as NotificationsEnvelope
  })
}

function createTenorSearchResponse(query: string) {
  return {
    mode: query.length > 0 ? 'search' : 'featured',
    query,
    results: [
      {
        id: 'tenor-party-parrot',
        title: 'Party parrot celebration',
        previewUrl: 'https://media.tenor.com/party-parrot-tiny.gif',
        gifUrl: 'https://media.tenor.com/party-parrot-full.gif',
        width: 320,
        height: 240,
      },
    ],
  }
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
      .filter((post) => post.threadId === threadId && post.deletedAt === null)
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

      if (pathname === '/api/gifs/search' && request.method() === 'GET') {
        const query = url.searchParams.get('q')?.trim() ?? ''

        await jsonResponse(route, 200, {
          data: createTenorSearchResponse(query),
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

        const payload = request.postDataJSON() as {
          text?: string
          media?: MockPostMedia[]
        }
        const isGifReply =
          Array.isArray(payload.media) && payload.media.length > 0
        const createdReply = createPostRecord(currentUser, {
          id: isGifReply ? 'reply-gif' : 'reply-1',
          type: 'reply',
          threadId: parentPost.threadId,
          parentId: parentPost.id,
          text: payload.text?.trim() ?? '',
          createdAt: '2026-04-15T00:02:00.000Z',
          media: payload.media ?? [],
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

  const threadWorkspace = pageA.getByTestId('thread-workspace')
  await threadWorkspace.scrollIntoViewIfNeeded()
  await threadWorkspace
    .locator('textarea')
    .first()
    .fill('User A root post for the shared thread.')
  await threadWorkspace.getByRole('button', { name: 'Publish post' }).click()

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

  await pageB
    .getByPlaceholder('Reply to @ada…')
    .fill('User B reply that should later be soft-deleted.')
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

test('an authenticated viewer can publish a GIF-only reply from the Tenor picker', async ({
  baseURL,
  browser,
}) => {
  const posts = new Map<string, MockPost>()

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
      .filter((post) => post.threadId === threadId && post.deletedAt === null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const currentUser = users.userA
  posts.set(
    'post-1',
    createPostRecord(currentUser, {
      id: 'post-1',
      type: 'post',
      threadId: 'post-1',
      parentId: null,
      text: 'User A root post for the GIF reply flow.',
      createdAt: '2026-04-15T00:01:00.000Z',
    }),
  )

  const context = await browser.newContext()

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

    if (pathname === '/api/gifs/search' && request.method() === 'GET') {
      const query = url.searchParams.get('q')?.trim() ?? ''

      await jsonResponse(route, 200, {
        data: createTenorSearchResponse(query),
        errors: [],
      })
      return
    }

    if (pathname === '/api/posts/post-1' && request.method() === 'GET') {
      await jsonResponse(route, 200, {
        data: visiblePost('post-1'),
        errors: [],
      })
      return
    }

    if (pathname === '/api/threads/post-1' && request.method() === 'GET') {
      await jsonResponse(route, 200, {
        data: {
          threadId: 'post-1',
          posts: visibleThread('post-1'),
          continuationToken: null,
        },
        errors: [],
      })
      return
    }

    if (
      pathname === '/api/posts/post-1/replies' &&
      request.method() === 'POST'
    ) {
      const payload = request.postDataJSON() as {
        text?: string
        media?: MockPostMedia[]
      }
      const createdReply = createPostRecord(currentUser, {
        id: 'reply-gif',
        type: 'reply',
        threadId: 'post-1',
        parentId: 'post-1',
        text: payload.text?.trim() ?? '',
        createdAt: '2026-04-15T00:02:00.000Z',
        media: payload.media ?? [],
      })

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

    throw new Error(`Unexpected API request: ${request.method()} ${pathname}`)
  })

  const page = await context.newPage()

  await page.goto(`${baseURL}/p/post-1`)
  await expect(
    page.getByText('User A root post for the GIF reply flow.'),
  ).toBeVisible()

  await page.getByPlaceholder('Search Tenor').fill('party parrot')
  await page.getByRole('button', { name: 'Find GIFs' }).click()
  await page
    .getByRole('button', { name: 'Reply with GIF: Party parrot celebration' })
    .click()

  await expect(
    page.getByText('GIF reply published and thread refreshed.'),
  ).toBeVisible()
  await expect(
    page.getByAltText('gif attachment from Ada Lovelace'),
  ).toBeVisible()

  expect(posts.get('reply-gif')).toMatchObject({
    text: '',
    media: [
      {
        id: 'tenor-party-parrot',
        kind: 'gif',
        url: 'https://media.tenor.com/party-parrot-full.gif',
        thumbUrl: 'https://media.tenor.com/party-parrot-tiny.gif',
        width: 320,
        height: 240,
      },
    ],
  })

  await context.close()
})

test('a reply produces an in-app notification for the parent author within five seconds', async ({
  baseURL,
  browser,
}) => {
  const posts = new Map<string, MockPost>()
  const notificationMaterializationDelayMs = 1_500
  let replyNotificationReadyAt: number | null = null

  const visiblePost = (postId: string) => {
    const post = posts.get(postId)
    return post && post.deletedAt === null ? post : null
  }

  const visibleThread = (threadId: string) =>
    [...posts.values()]
      .filter((post) => post.threadId === threadId && post.deletedAt === null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const listNotificationsForUser = (
    userKey: keyof typeof users,
  ): NotificationRecord[] => {
    if (userKey !== 'userA') {
      return []
    }

    const reply = posts.get('reply-1')

    if (
      !reply ||
      reply.deletedAt !== null ||
      replyNotificationReadyAt === null ||
      Date.now() < replyNotificationReadyAt
    ) {
      return []
    }

    return [
      {
        id: 'notification-reply-1',
        eventType: 'reply',
        text: 'replied to your post in #evals.',
        read: false,
        createdAt: reply.createdAt,
        postId: reply.threadId,
        threadId: reply.threadId,
        actor: {
          id: reply.authorId,
          handle: reply.authorHandle,
          displayName: reply.authorDisplayName,
          avatarUrl: reply.authorAvatarUrl,
        },
      },
    ]
  }

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

      if (pathname === '/api/feed' && request.method() === 'GET') {
        await jsonResponse(route, 200, {
          data: [],
          cursor: null,
          errors: [],
        })
        return
      }

      if (pathname === '/api/gifs/search' && request.method() === 'GET') {
        const query = url.searchParams.get('q')?.trim() ?? ''

        await jsonResponse(route, 200, {
          data: createTenorSearchResponse(query),
          errors: [],
        })
        return
      }

      if (pathname === '/api/notifications' && request.method() === 'GET') {
        const notifications = listNotificationsForUser(userKey)

        await jsonResponse(route, 200, {
          data: notifications,
          cursor: null,
          unreadCount: notifications.filter(
            (notification) => !notification.read,
          ).length,
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
        posts.set(createdPost.id, createdPost)

        await jsonResponse(route, 201, {
          data: {
            post: createdPost,
          },
          errors: [],
        })
        return
      }

      if (pathname === '/api/posts/post-1' && request.method() === 'GET') {
        const post = visiblePost('post-1')

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

      if (pathname === '/api/threads/post-1' && request.method() === 'GET') {
        await jsonResponse(route, 200, {
          data: {
            threadId: 'post-1',
            posts: visibleThread('post-1'),
            continuationToken: null,
          },
          errors: [],
        })
        return
      }

      if (
        pathname === '/api/posts/post-1/replies' &&
        request.method() === 'POST'
      ) {
        const payload = request.postDataJSON() as {
          text?: string
          media?: MockPostMedia[]
        }
        const createdReply = createPostRecord(currentUser, {
          id: 'reply-1',
          type: 'reply',
          threadId: 'post-1',
          parentId: 'post-1',
          text: payload.text?.trim() ?? '',
          createdAt: '2026-04-15T00:02:00.000Z',
          media: payload.media ?? [],
        })

        posts.set(createdReply.id, createdReply)
        replyNotificationReadyAt =
          Date.now() + notificationMaterializationDelayMs

        await jsonResponse(route, 201, {
          data: {
            post: createdReply,
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

  try {
    await attachApiMocks(contextA, 'userA')
    await attachApiMocks(contextB, 'userB')

    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    await pageA.goto(`${baseURL}/me`)
    await expect(
      pageA.getByRole('heading', { name: 'Edit your profile' }),
    ).toBeVisible()

    const threadWorkspace = pageA.getByTestId('thread-workspace')
    await threadWorkspace.scrollIntoViewIfNeeded()
    await threadWorkspace
      .locator('textarea')
      .first()
      .fill('User A root post for the reply notification flow.')
    await threadWorkspace.getByRole('button', { name: 'Publish post' }).click()

    await expect(pageA.getByText('Post published to /p/post-1.')).toBeVisible()

    await pageB.goto(`${baseURL}/p/post-1`)
    await expect(
      pageB.getByText('User A root post for the reply notification flow.'),
    ).toBeVisible()

    await pageB
      .getByPlaceholder('Reply to @ada…')
      .fill('User B reply that should trigger a notification.')
    await pageB.getByRole('button', { name: 'Reply in thread' }).click()

    await expect(
      pageB.getByText('Reply published and thread refreshed.'),
    ).toBeVisible()

    const replyConfirmedAt = Date.now()

    await expect
      .poll(
        async () => {
          const payload = await fetchNotifications(pageA)
          return (
            payload.data?.some(
              (notification) =>
                notification.eventType === 'reply' &&
                notification.actor?.handle === 'grace' &&
                notification.postId === 'post-1',
            ) ?? false
          )
        },
        {
          timeout: 5_000,
          intervals: [250, 500, 1_000],
        },
      )
      .toBe(true)

    expect(Date.now() - replyConfirmedAt).toBeLessThanOrEqual(5_000)

    await pageA.goto(`${baseURL}/`)
    await expect(
      pageA.getByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeVisible()

    await pageA.getByRole('button', { name: 'Notifications, 1 unread' }).click()

    await expect(pageA.getByText('Grace Hopper')).toBeVisible()
    await expect(
      pageA.getByText('replied to your post in #evals.'),
    ).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
