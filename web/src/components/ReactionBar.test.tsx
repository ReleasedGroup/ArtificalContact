import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createReaction, deleteReaction } from '../lib/reactions'
import { ReactionBar } from './ReactionBar'

vi.mock('../lib/reactions', () => ({
  createReaction: vi.fn(),
  deleteReaction: vi.fn(),
}))

describe('ReactionBar', () => {
  const renderBar = () =>
    render(
      <ReactionBar
        canReact
        dislikesCount={0}
        emojiCount={0}
        likeCount={0}
        postId="post-1"
        onCommitted={vi.fn()}
      />,
    )

  const findEmojiButton = (emoji: string) =>
    screen.findByRole('button', {
      name: `Emoji ${emoji}`,
    })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts like and delete calls while updating counts optimistically', async () => {
    vi.mocked(createReaction).mockResolvedValue({
      reaction: {
        sentiment: 'like',
        emojiValues: [],
        gifValue: null,
      },
    })
    vi.mocked(deleteReaction).mockResolvedValue({
      unreact: {
        id: 'reaction-1',
        postId: 'post-1',
        userId: 'viewer-1',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: null,
        emojiValueRemoved: false,
      },
      reaction: {
        sentiment: null,
        emojiValues: [],
        gifValue: null,
      },
    })

    renderBar()

    const likeButton = screen.getByRole('button', { name: 'Like reaction' })

    expect(likeButton).toHaveTextContent('👍 0')

    fireEvent.click(likeButton)

    await waitFor(() => {
      expect(createReaction).toHaveBeenCalledWith('post-1', {
        type: 'like',
      })
      expect(likeButton).toHaveTextContent('👍 1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Like reaction' }))

    await waitFor(() => {
      expect(deleteReaction).toHaveBeenCalledWith('post-1')
      expect(likeButton).toHaveTextContent('👍 0')
    })
  })

  it('adds and removes a chosen emoji', async () => {
    vi.mocked(createReaction).mockResolvedValue({
      reaction: {
        sentiment: null,
        emojiValues: ['😍'],
        gifValue: null,
      },
    })
    vi.mocked(deleteReaction).mockResolvedValue({
      unreact: {
        id: 'reaction-1',
        postId: 'post-1',
        userId: 'viewer-1',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: '😍',
        emojiValueRemoved: true,
      },
      reaction: {
        sentiment: null,
        emojiValues: [],
        gifValue: null,
      },
    })

    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Emoji reaction picker' }))
    fireEvent.click(await findEmojiButton('😍'))

    await waitFor(() => {
      expect(createReaction).toHaveBeenCalledWith('post-1', {
        type: 'emoji',
        value: '😍',
      })
      expect(screen.getByRole('button', { name: 'Emoji reaction picker' })).toHaveTextContent(
        '😊 1',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Emoji reaction picker' }))
    fireEvent.click(await findEmojiButton('😍'))

    await waitFor(() => {
      expect(deleteReaction).toHaveBeenCalledWith('post-1', '😍')
      expect(screen.getByRole('button', { name: 'Emoji reaction picker' })).toHaveTextContent(
        '😊 0',
      )
    })
  })

  it('reverts the optimistic state when the API request fails', async () => {
    vi.mocked(createReaction).mockRejectedValue(new Error('Network unavailable'))
    vi.mocked(deleteReaction).mockResolvedValue({
      unreact: {
        id: 'reaction-1',
        postId: 'post-1',
        userId: 'viewer-1',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: null,
        emojiValueRemoved: false,
      },
      reaction: {
        sentiment: null,
        emojiValues: [],
        gifValue: null,
      },
    })

    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Like reaction' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Like reaction' })).toHaveTextContent('👍 0')
      expect(screen.getByRole('status')).toHaveTextContent('Network unavailable')
    })
  })

  it('preserves user reaction state when counts are refreshed from the parent', async () => {
    vi.mocked(createReaction).mockResolvedValue({
      reaction: {
        sentiment: 'like',
        emojiValues: [],
        gifValue: null,
      },
    })
    vi.mocked(deleteReaction).mockResolvedValue({
      unreact: {
        id: 'reaction-1',
        postId: 'post-1',
        userId: 'viewer-1',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: null,
        emojiValueRemoved: false,
      },
      reaction: {
        sentiment: 'like',
        emojiValues: ['👍'],
        gifValue: null,
      },
    })

    const rendered = renderBar()
    const likeButton = screen.getByRole('button', { name: 'Like reaction' })

    fireEvent.click(likeButton)

    await waitFor(() => {
      expect(likeButton).toHaveClass('bg-emerald-300/15')
    })

    rendered.rerender(
      <ReactionBar
        canReact
        dislikesCount={0}
        emojiCount={0}
        likeCount={1}
        onCommitted={vi.fn()}
        postId="post-1"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Like reaction' })).toHaveClass(
        'bg-emerald-300/15',
      )
    })
  })

  it('resets local reaction state when postId changes', async () => {
    vi.mocked(createReaction).mockResolvedValue({
      reaction: {
        sentiment: 'like',
        emojiValues: [],
        gifValue: null,
      },
    })
    vi.mocked(deleteReaction).mockResolvedValue({
      unreact: {
        id: 'reaction-1',
        postId: 'post-2',
        userId: 'viewer-1',
        reactionExisted: true,
        deletedReaction: true,
        removedEmojiValue: null,
        emojiValueRemoved: false,
      },
      reaction: {
        sentiment: null,
        emojiValues: [],
        gifValue: null,
      },
    })

    const rendered = render(
      <ReactionBar
        canReact
        dislikesCount={0}
        emojiCount={0}
        likeCount={0}
        onCommitted={vi.fn()}
        postId="post-1"
      />,
    )
    const likeButton = screen.getByRole('button', { name: 'Like reaction' })

    fireEvent.click(likeButton)

    await waitFor(() => {
      expect(likeButton).toHaveClass('bg-emerald-300/15')
    })

    rendered.rerender(
      <ReactionBar
        canReact
        dislikesCount={3}
        emojiCount={1}
        likeCount={2}
        onCommitted={vi.fn()}
        postId="post-2"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Like reaction' })).toHaveTextContent('👍 2')
      expect(screen.getByRole('button', { name: 'Like reaction' })).not.toHaveClass(
        'bg-emerald-300/15',
      )
    })
  })

  it('disables controls when reaction is not allowed', () => {
    render(
      <ReactionBar
        canReact={false}
        dislikesCount={0}
        emojiCount={0}
        likeCount={0}
        onCommitted={vi.fn()}
        postId="post-1"
      />,
    )

    expect(screen.getByRole('button', { name: 'Like reaction' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dislike reaction' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Emoji reaction picker' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Sign in and activate a public handle to react.'),
    ).toBeInTheDocument()
  })
})
