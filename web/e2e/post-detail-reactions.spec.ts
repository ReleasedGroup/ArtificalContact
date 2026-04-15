import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

interface MockUser {
  id: string
  email: string
  handle: string
  displayName: string
}

interface StoredReactionState {
  sentiment: 'like' | 'dislike' | null
  emojiValues: Set<string>
}

interface CounterSnapshot {
  dislikes: number
  emoji: number
  likes: number
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

const counterRefreshLatencyMs = 700

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
      bio: `${user.displayName} validating shared reaction counters.`,
      avatarUrl: null,
      bannerUrl: null,
      expertise: ['reactions', 'playwright'],
      links: {},
      status: 'active',
      roles: ['user'],
      counters: {
        followers: 0,
        following: 0,
        posts: 1,
      },
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
  }
}

function createBasePost(counters: CounterSnapshot) {
  return {
    authorAvatarUrl: null,
    authorDisplayName: users.userA.displayName,
    authorHandle: users.userA.handle,
    authorId: users.userA.id,
    counters,
    createdAt: '2026-04-16T00:01:00.000Z',
    github: null,
    hashtags: [],
    id: 'post-1',
    kind: 'user' as const,
    media: [],
    mentions: [],
    parentId: null,
    text: 'Shared reaction counter verification post.',
    threadId: 'post-1',
    type: 'post' as const,
    updatedAt: '2026-04-16T00:01:00.000Z',
    visibility: 'public',
  }
}

function createThreadPayload(counters: CounterSnapshot) {
  return {
    continuationToken: null,
    posts: [
      {
        authorAvatarUrl: null,
        authorDisplayName: users.userA.displayName,
        authorHandle: users.userA.handle,
        authorId: users.userA.id,
        counters,
        createdAt: '2026-04-16T00:01:00.000Z',
        hashtags: [],
        id: 'post-1',
        kind: 'user' as const,
        media: [],
        mentions: [],
        parentId: null,
        text: 'Shared reaction counter verification post.',
        threadId: 'post-1',
        type: 'post' as const,
        updatedAt: '2026-04-16T00:01:00.000Z',
      },
    ],
    threadId: 'post-1',
  }
}

function jsonResponse(route: Route, status: number, payload: unknown) {
  return route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    status,
  })
}

function snapshotCounters(
  reactionStateByUserId: Map<string, StoredReactionState>,
): CounterSnapshot {
  let likes = 0
  let dislikes = 0
  let emoji = 0

  for (const reactionState of reactionStateByUserId.values()) {
    if (reactionState.sentiment === 'like') {
      likes += 1
    }

    if (reactionState.sentiment === 'dislike') {
      dislikes += 1
    }

    emoji += reactionState.emojiValues.size
  }

  return {
    dislikes,
    emoji,
    likes,
  }
}

function createStoredReactionState(): StoredReactionState {
  return {
    sentiment: null,
    emojiValues: new Set<string>(),
  }
}

function cloneReactionPayload(reactionState: StoredReactionState | null) {
  return {
    gifValue: null,
    emojiValues: [...(reactionState?.emojiValues ?? [])].sort(),
    sentiment: reactionState?.sentiment ?? null,
  }
}

async function waitForCounterVisibility(counterVisibleAt: { value: number }) {
  const remaining = counterVisibleAt.value - Date.now()
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}

async function attachApiMocks(
  context: BrowserContext,
  userKey: keyof typeof users,
  reactionStateByUserId: Map<string, StoredReactionState>,
  counterVisibleAt: { value: number },
) {
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

    if (pathname === '/api/gifs/search' && request.method() === 'GET') {
      await jsonResponse(route, 200, {
        data: {
          mode: 'featured',
          query: url.searchParams.get('q')?.trim() ?? '',
          results: [],
        },
        errors: [],
      })
      return
    }

    if (pathname === '/api/posts/post-1' && request.method() === 'GET') {
      await waitForCounterVisibility(counterVisibleAt)
      await jsonResponse(route, 200, {
        data: createBasePost(snapshotCounters(reactionStateByUserId)),
        errors: [],
      })
      return
    }

    if (pathname === '/api/threads/post-1' && request.method() === 'GET') {
      await waitForCounterVisibility(counterVisibleAt)
      await jsonResponse(route, 200, {
        data: createThreadPayload(snapshotCounters(reactionStateByUserId)),
        errors: [],
      })
      return
    }

    if (pathname === '/api/posts/post-1/reactions' && request.method() === 'POST') {
      const currentReactionState =
        reactionStateByUserId.get(currentUser.id) ?? createStoredReactionState()
      const payload = request.postDataJSON() as {
        type: 'like' | 'dislike' | 'emoji'
        value?: string
      }

      if (payload.type === 'emoji') {
        const emojiValue = payload.value?.trim() ?? ''
        if (emojiValue.length === 0) {
          await jsonResponse(route, 400, {
            data: null,
            errors: [
              {
                code: 'invalid_reaction',
                message: 'Emoji reactions require a value.',
              },
            ],
          })
          return
        }

        if (currentReactionState.sentiment !== null) {
          await jsonResponse(route, 409, {
            data: null,
            errors: [
              {
                code: 'reaction_conflict',
                message: 'Emoji reactions cannot be combined with like or dislike.',
              },
            ],
          })
          return
        }

        currentReactionState.emojiValues.add(emojiValue)
      } else {
        if (currentReactionState.emojiValues.size > 0) {
          await jsonResponse(route, 409, {
            data: null,
            errors: [
              {
                code: 'reaction_conflict',
                message: 'Like and dislike cannot be combined with emoji reactions.',
              },
            ],
          })
          return
        }

        currentReactionState.sentiment = payload.type
      }

      reactionStateByUserId.set(currentUser.id, currentReactionState)
      counterVisibleAt.value = Date.now() + counterRefreshLatencyMs

      await jsonResponse(route, 201, {
        data: {
          reaction: cloneReactionPayload(currentReactionState),
        },
        errors: [],
      })
      return
    }

    if (pathname === '/api/posts/post-1/reactions' && request.method() === 'DELETE') {
      const currentReactionState =
        reactionStateByUserId.get(currentUser.id) ?? createStoredReactionState()
      const emojiValue = url.searchParams.get('emoji')?.trim() ?? null
      const hadState =
        currentReactionState.sentiment !== null ||
        currentReactionState.emojiValues.size > 0

      if (emojiValue) {
        currentReactionState.emojiValues.delete(emojiValue)
      } else {
        currentReactionState.sentiment = null
      }

      if (
        currentReactionState.sentiment === null &&
        currentReactionState.emojiValues.size === 0
      ) {
        reactionStateByUserId.delete(currentUser.id)
      } else {
        reactionStateByUserId.set(currentUser.id, currentReactionState)
      }

      counterVisibleAt.value = Date.now() + counterRefreshLatencyMs

      await jsonResponse(route, 200, {
        data: {
          reaction:
            currentReactionState.sentiment === null &&
            currentReactionState.emojiValues.size === 0
              ? null
              : cloneReactionPayload(currentReactionState),
          unreact: {
            deletedReaction:
              currentReactionState.sentiment === null &&
              currentReactionState.emojiValues.size === 0,
            emojiValueRemoved: emojiValue !== null,
            id: `post-1:${currentUser.id}`,
            postId: 'post-1',
            reactionExisted: hadState,
            removedEmojiValue: emojiValue,
            userId: currentUser.id,
          },
        },
        errors: [],
      })
      return
    }

    throw new Error(`Unexpected API request: ${request.method()} ${pathname}`)
  })
}

async function expectReactionCounts(
  page: Page,
  expected: CounterSnapshot,
  timeout = 5000,
) {
  await expect(
    page.getByRole('button', { exact: true, name: 'Like reaction' }),
  ).toHaveText(`👍 ${expected.likes}`, { timeout })
  await expect(
    page.getByRole('button', { exact: true, name: 'Dislike reaction' }),
  ).toHaveText(`👎 ${expected.dislikes}`, { timeout })
  await expect(
    page.getByRole('button', { exact: true, name: 'Emoji reaction picker' }),
  ).toHaveText(`😊 ${expected.emoji}`, { timeout })
}

async function reloadAndExpectCountsWithin(
  page: Page,
  expected: CounterSnapshot,
  maxDurationMs: number,
) {
  const startedAt = Date.now()

  await page.reload()
  await expectReactionCounts(page, expected, maxDurationMs)

  expect(Date.now() - startedAt).toBeLessThan(maxDurationMs)
}

test('two users see like, dislike, and emoji counters settle within two seconds', async ({
  baseURL,
  browser,
}) => {
  const reactionStateByUserId = new Map<string, StoredReactionState>()
  const counterVisibleAt = { value: 0 }
  const maxCounterUpdateWindowMs = 2000

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  await attachApiMocks(
    contextA,
    'userA',
    reactionStateByUserId,
    counterVisibleAt,
  )
  await attachApiMocks(
    contextB,
    'userB',
    reactionStateByUserId,
    counterVisibleAt,
  )

  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await pageA.goto(`${baseURL}/p/post-1`)
  await pageB.goto(`${baseURL}/p/post-1`)

  await expect(
    pageA.getByRole('heading', { name: 'Standalone post detail' }),
  ).toBeVisible()
  await expect(
    pageB.getByRole('heading', { name: 'Standalone post detail' }),
  ).toBeVisible()
  await expectReactionCounts(pageA, { dislikes: 0, emoji: 0, likes: 0 })
  await expectReactionCounts(pageB, { dislikes: 0, emoji: 0, likes: 0 })

  await pageA
    .getByRole('button', { exact: true, name: 'Like reaction' })
    .click()
  await reloadAndExpectCountsWithin(
    pageB,
    { dislikes: 0, emoji: 0, likes: 1 },
    maxCounterUpdateWindowMs,
  )

  await pageB
    .getByRole('button', { exact: true, name: 'Dislike reaction' })
    .click()
  await reloadAndExpectCountsWithin(
    pageA,
    { dislikes: 1, emoji: 0, likes: 1 },
    maxCounterUpdateWindowMs,
  )

  await pageB
    .getByRole('button', { exact: true, name: 'Dislike reaction' })
    .click()
  await expectReactionCounts(pageB, { dislikes: 0, emoji: 0, likes: 1 })

  await pageB
    .getByRole('button', { exact: true, name: 'Emoji reaction picker' })
    .click()
  await pageB.getByRole('button', { exact: true, name: 'Emoji 😍' }).click()
  await reloadAndExpectCountsWithin(
    pageA,
    { dislikes: 0, emoji: 1, likes: 1 },
    maxCounterUpdateWindowMs,
  )

  expect(snapshotCounters(reactionStateByUserId)).toEqual({
    dislikes: 0,
    emoji: 1,
    likes: 1,
  })
  expect(reactionStateByUserId.get(users.userA.id)).toEqual({
    emojiValues: new Set<string>(),
    sentiment: 'like',
  })
  expect(reactionStateByUserId.get(users.userB.id)).toEqual({
    emojiValues: new Set(['😍']),
    sentiment: null,
  })

  await contextA.close()
  await contextB.close()
})
