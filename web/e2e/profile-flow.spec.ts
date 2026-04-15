import { expect, test } from '@playwright/test'

test('sign in, claim a handle, and open the public profile', async ({
  page,
  baseURL,
}) => {
  const pendingProfile = {
    id: 'github:abc123',
    identityProvider: 'github',
    identityProviderUserId: 'abc123',
    email: 'nick@example.com',
    handle: null,
    displayName: 'Nick',
    bio: null,
    avatarUrl: null,
    bannerUrl: null,
    expertise: [],
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
  }

  const activeProfile = {
    ...pendingProfile,
    handle: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Designing resilient evaluation loops.',
    expertise: ['agents', 'evals'],
    status: 'active',
    updatedAt: '2026-04-15T02:00:00.000Z',
  }

  let savedPayload: Record<string, unknown> | null = null

  await page.route('**/.auth/login/github**', async (route) => {
    await route.fulfill({
      status: 302,
      headers: {
        location: `${baseURL}/me`,
      },
      body: '',
    })
  })

  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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

  await page.route('**/api/me', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            isNewUser: true,
            user: pendingProfile,
          },
          errors: [],
        }),
      })
      return
    }

    savedPayload = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: activeProfile,
        },
        errors: [],
      }),
    })
  })

  await page.route('**/api/users/ada', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: 'u1',
          handle: 'ada',
          displayName: 'Ada Lovelace',
          bio: 'Designing resilient evaluation loops.',
          avatarUrl: null,
          bannerUrl: null,
          expertise: ['agents', 'evals'],
          counters: {
            posts: 0,
            followers: 0,
            following: 0,
          },
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T02:00:00.000Z',
        },
        errors: [],
      }),
    })
  })

  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Sign in to ArtificialContact.' }),
  ).toBeVisible()

  await page.getByRole('link', { name: /continue with github/i }).click()

  await expect(page).toHaveURL(/\/me$/)
  await expect(
    page.getByRole('heading', { name: 'Edit your profile' }),
  ).toBeVisible()
  await expect(page.getByLabel('Public handle')).toHaveValue('')

  await page.getByLabel('Public handle').fill('ada')
  await page.getByLabel('Display name').fill('Ada Lovelace')
  await page.getByLabel('Bio').fill('Designing resilient evaluation loops.')
  await page.getByLabel('Expertise tags').fill('agents')
  await page.getByRole('button', { name: 'Add tag' }).click()
  await page.getByLabel('Expertise tags').fill('evals')
  await page.getByRole('button', { name: 'Add tag' }).click()
  await page.getByRole('button', { name: 'Save profile' }).click()

  await expect(
    page.getByText('Profile created. Your public profile is live.'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'View public profile' })).toHaveAttribute(
    'href',
    '/u/ada',
  )

  expect(savedPayload).toEqual({
    handle: 'ada',
    displayName: 'Ada Lovelace',
    bio: 'Designing resilient evaluation loops.',
    avatarUrl: null,
    bannerUrl: null,
    expertise: ['agents', 'evals'],
  })

  await page.getByRole('link', { name: 'View public profile' }).click()

  await expect(page).toHaveURL(/\/u\/ada$/)
  await expect(
    page.getByRole('heading', { name: 'Ada Lovelace' }),
  ).toBeVisible()
  await expect(page.getByText('@ada')).toBeVisible()
  await expect(
    page.getByText('Designing resilient evaluation loops.'),
  ).toBeVisible()
  await expect(page.getByText('Public identity is live.')).toBeVisible()
})
