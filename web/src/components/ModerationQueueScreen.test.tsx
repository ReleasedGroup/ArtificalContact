import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModerationQueueScreen } from './ModerationQueueScreen'
import type { MeProfile } from '../lib/me'

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
    roles: ['moderator', 'user'],
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

describe('ModerationQueueScreen', () => {
  it('renders the moderator queue stats and report table from the mockup slice', () => {
    render(<ModerationQueueScreen viewer={createViewer()} />)

    expect(
      screen.getByRole('heading', { name: 'Moderation queue' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Queue depth (24h)')).toBeInTheDocument()
    expect(screen.getByText('Avg time to action')).toBeInTheDocument()
    expect(
      screen.getByText('Auto-flagged by Content Safety'),
    ).toBeInTheDocument()
    expect(screen.getByText('Post #p_01HXY')).toBeInTheDocument()
    expect(screen.getByText('Image m_77')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove media' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Dismiss' }),
    ).toHaveLength(5)
  })

  it('shows the current viewer roles in the route header', () => {
    render(<ModerationQueueScreen viewer={createViewer()} />)

    expect(
      screen.getByText('Viewer roles: moderator + user'),
    ).toBeInTheDocument()
  })
})
