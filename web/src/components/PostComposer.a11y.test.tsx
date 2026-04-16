import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { useState, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
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
  onSubmit = () => {},
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

describe('PostComposer accessibility', () => {
  it('has no detectable axe violations for the default post composer', async () => {
    const { container } = render(
      <ComposerHarness initialValue="Shipping accessibility improvements today." />,
    )

    expect((await axe(container)).violations).toEqual([])
  })

  it('has no detectable axe violations when images are already attached', async () => {
    const image = new File(['diagram'], 'diagram.png', { type: 'image/png' })
    const { container } = render(
      <ComposerHarness
        initialMediaFiles={[
          {
            altText: '',
            file: image,
            previewUrl: 'blob:diagram.png',
            signature: 'diagram.png-7-1-image/png',
          },
        ]}
        initialValue="Attach the architecture diagram for review."
      />,
    )

    expect((await axe(container)).violations).toEqual([])
  })
})
