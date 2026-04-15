import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PostComposer,
  type PostComposerMediaFile,
  type PostComposerSubmission,
} from './PostComposer'

interface ComposerHarnessProps {
  initialMediaFiles?: PostComposerMediaFile[]
  initialValue?: string
  onSubmit?: (submission: PostComposerSubmission) => void
  variant?: 'post' | 'reply'
}

function ComposerHarness({
  initialMediaFiles = [],
  initialValue = '',
  onSubmit = vi.fn(),
  variant = 'post',
}: ComposerHarnessProps): ReactElement {
  const [mediaFiles, setMediaFiles] = useState(initialMediaFiles)
  const [value, setValue] = useState(initialValue)

  return (
    <PostComposer
      authorBadge="AL"
      authorHandle="ada"
      authorName="Ada Lovelace"
      label={variant === 'reply' ? 'Reply body' : 'Post body'}
      mediaFiles={mediaFiles}
      onChange={setValue}
      onMediaFilesChange={setMediaFiles}
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
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      })
    } else {
      delete (
        URL as { createObjectURL?: (file: File) => string }
      ).createObjectURL
    }

    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      })
    } else {
      delete (
        URL as { revokeObjectURL?: (url: string) => void }
      ).revokeObjectURL
    }

    vi.restoreAllMocks()
  })

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

    expect(handleSubmit).toHaveBeenCalledWith({
      mediaFiles: [],
      value: 'Shipping #evals notes for @grace today.',
    })
  })

  it('disables reply submission when the text is blank', () => {
    render(<ComposerHarness variant="reply" initialValue="   " />)

    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
  })

  it('adds multiple image previews from drag and drop and removes them individually', () => {
    render(<ComposerHarness />)

    const dropZone = screen.getByRole('group', {
      name: 'Post image attachments',
    })
    const firstImage = new File(['first'], 'diagram-a.png', {
      type: 'image/png',
    })
    const secondImage = new File(['second'], 'diagram-b.png', {
      type: 'image/png',
    })

    fireEvent.dragEnter(dropZone, {
      dataTransfer: { files: [firstImage, secondImage] },
    })
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [firstImage, secondImage] },
    })

    expect(screen.getByText('2 images ready')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Selected media preview: diagram-a.png',
      }),
    ).toHaveAttribute('src', 'blob:diagram-a.png')
    expect(
      screen.getByRole('img', {
        name: 'Selected media preview: diagram-b.png',
      }),
    ).toHaveAttribute('src', 'blob:diagram-b.png')

    fireEvent.click(screen.getByRole('button', { name: 'Remove diagram-a.png' }))

    expect(screen.getByText('1 image ready')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', {
        name: 'Selected media preview: diagram-a.png',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Selected media preview: diagram-b.png',
      }),
    ).toBeInTheDocument()
  })
})
