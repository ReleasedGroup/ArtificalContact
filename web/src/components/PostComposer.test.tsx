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
  const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    'createObjectURL',
  )
  const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    'revokeObjectURL',
  )
  let createObjectURLMock: ReturnType<typeof vi.fn>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURLMock = vi.fn((file: File) => `blob:${file.name}`)
    revokeObjectURLMock = vi.fn()

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURLMock,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURLMock,
    })
  })

  afterEach(() => {
    if (originalCreateObjectURLDescriptor) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: originalCreateObjectURLDescriptor.configurable,
        enumerable: originalCreateObjectURLDescriptor.enumerable,
        value: originalCreateObjectURLDescriptor.value,
        writable: originalCreateObjectURLDescriptor.writable,
      })
    } else {
      delete (URL as { createObjectURL?: (file: File) => string })
        .createObjectURL
    }

    if (originalRevokeObjectURLDescriptor) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: originalRevokeObjectURLDescriptor.configurable,
        enumerable: originalRevokeObjectURLDescriptor.enumerable,
        value: originalRevokeObjectURLDescriptor.value,
        writable: originalRevokeObjectURLDescriptor.writable,
      })
    } else {
      delete (URL as { revokeObjectURL?: (url: string) => void })
        .revokeObjectURL
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

  it('captures alt text for attached images before submission', () => {
    const handleSubmit = vi.fn()

    render(<ComposerHarness onSubmit={handleSubmit} />)

    const dropZone = screen.getByRole('group', {
      name: 'Post image attachments',
    })
    const image = new File(['diagram'], 'system-architecture.png', {
      type: 'image/png',
    })

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [image] },
    })

    fireEvent.change(screen.getByRole('textbox', { name: 'Post body' }), {
      target: { value: 'Accessibility notes for the architecture review.' },
    })
    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'Alt text',
      }),
      {
        target: {
          value:
            'Architecture diagram showing the client, API, and storage layers.',
        },
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(handleSubmit).toHaveBeenCalledWith({
      mediaFiles: [
        {
          altText:
            'Architecture diagram showing the client, API, and storage layers.',
          file: image,
        },
      ],
      value: 'Accessibility notes for the architecture review.',
    })
    expect(
      screen.getByRole('img', {
        name: 'Architecture diagram showing the client, API, and storage layers.',
      }),
    ).toBeInTheDocument()
  })

  it('disables reply submission when the text is blank', () => {
    render(<ComposerHarness variant="reply" initialValue="   " />)

    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
  })

  it('adds multiple image previews from drag and drop and removes them individually', () => {
    const { unmount } = render(<ComposerHarness />)

    const dropZone = screen.getByRole('group', {
      name: 'Post image attachments',
    })
    const firstImage = new File(['first'], 'diagram-a.png', {
      type: 'image/png',
    })
    const secondImage = new File(['second'], 'diagram-b.webp')

    fireEvent.dragEnter(dropZone, {
      dataTransfer: { files: [firstImage, secondImage] },
    })
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [firstImage, secondImage] },
    })

    expect(screen.getByText('2 images ready')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Selected image preview for diagram-a.png',
      }),
    ).toHaveAttribute('src', 'blob:diagram-a.png')
    expect(
      screen.getByRole('img', {
        name: 'Selected image preview for diagram-b.webp',
      }),
    ).toHaveAttribute('src', 'blob:diagram-b.webp')

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove diagram-a.png' }),
    )

    expect(screen.getByText('1 image ready')).toBeInTheDocument()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:diagram-a.png')
    expect(
      screen.queryByRole('img', {
        name: 'Selected image preview for diagram-a.png',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Selected image preview for diagram-b.webp',
      }),
    ).toBeInTheDocument()

    unmount()

    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:diagram-b.webp')
  })

  it('exposes keyboard-friendly attachment controls and guidance for screen readers', () => {
    render(<ComposerHarness />)

    expect(
      screen.getByRole('button', { name: 'Browse images' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Post image attachments' }),
    ).toHaveAccessibleDescription(
      /drag images here or browse from the keyboard/i,
    )
    expect(
      screen.getByRole('textbox', { name: 'Post body' }),
    ).toHaveAccessibleDescription(/add alternative text/i)
  })
})
