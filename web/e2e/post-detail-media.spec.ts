import { expect, test, type Page } from '@playwright/test'

const mixedMedia = [
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

async function stubMixedMediaPost(page: Page) {
  await page.route('**/api/posts/post-mixed-media', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: 'post-mixed-media',
          type: 'post',
          kind: 'user',
          threadId: 'post-mixed-media',
          parentId: null,
          authorId: 'u1',
          authorHandle: 'ada',
          authorDisplayName: 'Ada Lovelace',
          authorAvatarUrl: null,
          text: 'Mixed media launch update',
          hashtags: ['media'],
          mentions: [],
          media: mixedMedia,
          counters: {
            likes: 12,
            dislikes: 0,
            emoji: 3,
            replies: 1,
          },
          visibility: 'public',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          github: null,
        },
        errors: [],
      }),
    })
  })

  await page.route('**/api/threads/post-mixed-media', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          threadId: 'post-mixed-media',
          posts: [
            {
              id: 'post-mixed-media',
              type: 'post',
              kind: 'user',
              threadId: 'post-mixed-media',
              parentId: null,
              authorId: 'u1',
              authorHandle: 'ada',
              authorDisplayName: 'Ada Lovelace',
              authorAvatarUrl: null,
              text: 'Mixed media launch update',
              hashtags: ['media'],
              mentions: [],
              media: mixedMedia,
              counters: {
                likes: 12,
                dislikes: 0,
                emoji: 3,
                replies: 1,
              },
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T00:00:00.000Z',
            },
            {
              id: 'reply-1',
              type: 'reply',
              kind: 'user',
              threadId: 'post-mixed-media',
              parentId: 'post-mixed-media',
              authorId: 'u2',
              authorHandle: 'grace',
              authorDisplayName: 'Grace Hopper',
              authorAvatarUrl: null,
              text: 'Reply confirms the mixed-media post is live.',
              hashtags: [],
              mentions: [],
              media: [],
              counters: {
                likes: 2,
                dislikes: 0,
                emoji: 1,
                replies: 0,
              },
              createdAt: '2026-04-15T00:05:00.000Z',
              updatedAt: '2026-04-15T00:05:00.000Z',
            },
          ],
          continuationToken: null,
        },
        errors: [],
      }),
    })
  })
}

async function expectMixedMediaPost(page: Page) {
  const gallery = page.locator('[data-post-media-gallery]')

  await expect(
    page.getByRole('heading', { name: 'Standalone post detail' }),
  ).toBeVisible()
  await expect(page.getByText('Mixed media launch update')).toBeVisible()

  await gallery.scrollIntoViewIfNeeded()

  await expect(
    gallery.locator('[data-post-media-kind="image"] img'),
  ).toHaveAttribute('src', /launch-board-thumb\.png$/)
  await expect(
    gallery.locator('[data-post-media-kind="gif"] img'),
  ).toHaveAttribute('src', /prompt-loop\.gif$/)
  await expect(
    gallery.locator('[data-post-media-kind="video"] video'),
  ).toHaveAttribute('src', /demo\.mp4$/)
  await expect(
    gallery.locator('[data-post-media-kind="audio"] audio'),
  ).toHaveAttribute('src', /voice-note\.mp3$/)
  await expect(gallery.getByRole('link', { name: 'Open media' })).toHaveCount(
    4,
  )
  await expect(
    page.getByText('Reply confirms the mixed-media post is live.'),
  ).toBeVisible()
}

function expectDefinedBox(
  box: { x: number; y: number } | null,
  label: string,
) {
  expect(box, `${label} should have a layout box`).not.toBeNull()
}

test('renders the mixed-media post detail on desktop', async ({ page }) => {
  await stubMixedMediaPost(page)
  await page.goto('/p/post-mixed-media')

  await expectMixedMediaPost(page)

  const gallery = page.locator('[data-post-media-gallery]')
  const imageBox = await gallery
    .locator('[data-post-media-kind="image"]')
    .boundingBox()
  const gifBox = await gallery
    .locator('[data-post-media-kind="gif"]')
    .boundingBox()

  expectDefinedBox(imageBox, 'image card')
  expectDefinedBox(gifBox, 'gif card')

  expect(Math.abs((imageBox?.y ?? 0) - (gifBox?.y ?? 0))).toBeLessThan(8)
  expect(Math.abs((imageBox?.x ?? 0) - (gifBox?.x ?? 0))).toBeGreaterThan(24)
})

test.describe('mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('renders the mixed-media post detail on mobile', async ({ page }) => {
    await stubMixedMediaPost(page)
    await page.goto('/p/post-mixed-media')

    await expectMixedMediaPost(page)

    const gallery = page.locator('[data-post-media-gallery]')
    const imageBox = await gallery
      .locator('[data-post-media-kind="image"]')
      .boundingBox()
    const gifBox = await gallery
      .locator('[data-post-media-kind="gif"]')
      .boundingBox()

    expectDefinedBox(imageBox, 'image card')
    expectDefinedBox(gifBox, 'gif card')

    expect((gifBox?.y ?? 0) - (imageBox?.y ?? 0)).toBeGreaterThan(24)
  })
})
