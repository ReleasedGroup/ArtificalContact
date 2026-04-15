import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PostComposer } from './PostComposer'

interface ComposerHarnessProps {
  initialValue?: string
  onSubmit?: (value: string) => void
  variant?: 'post' | 'reply'
}

function ComposerHarness({
  initialValue = '',
  onSubmit = vi.fn(),
  variant = 'post',
}: ComposerHarnessProps): ReactElement {
  const [value, setValue] = useState(initialValue)

  return (
    <PostComposer
      authorBadge="AL"
      authorHandle="ada"
      authorName="Ada Lovelace"
      label={variant === 'reply' ? 'Reply body' : 'Post body'}
      onChange={setValue}
      onSubmit={onSubmit}
      placeholder={
        variant === 'reply'
          ? 'Reply to @thread-root…'
          : 'Share an experiment, prompt, eval result, or hot take…'
      }
      submitLabel={variant === 'reply' ? 'Reply' : 'Post'}
      value={value}
      variant={variant}
    />
  )
}

describe('PostComposer', () => {
  it('highlights hashtags and mentions in the mirrored layer', () => {
    const { container } = render(
      <ComposerHarness initialValue="Checking #PromptOps with @ada before launch." />,
    )

    const hashtagToken = container.querySelector(
      '[data-composer-token="hashtag"]',
    )
    const mentionToken = container.querySelector(
      '[data-composer-token="mention"]',
    )

    expect(hashtagToken).toHaveTextContent('#PromptOps')
    expect(mentionToken).toHaveTextContent('@ada')
  })

  it('tracks the character count and submits non-empty text', () => {
    const handleSubmit = vi.fn()

    render(<ComposerHarness onSubmit={handleSubmit} />)

    const textbox = screen.getByRole('textbox', { name: 'Post body' })
    fireEvent.change(textbox, {
      target: { value: 'Shipping #evals notes for @grace today.' },
    })

    expect(screen.getByText('39 / 280')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(handleSubmit).toHaveBeenCalledWith(
      'Shipping #evals notes for @grace today.',
    )
  })

  it('disables reply submission when the text is blank', () => {
    render(<ComposerHarness variant="reply" initialValue="   " />)

    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
  })
})
