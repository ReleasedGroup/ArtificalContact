import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectBlobUploadCard } from './DirectBlobUploadCard'
import type { UploadMediaFileFn, UploadedBlobResult } from '../lib/media-upload'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return {
    promise,
    resolve,
  }
}

function createUploadResult(): UploadedBlobResult {
  return {
    kind: 'image',
    contentType: 'image/png',
    sizeBytes: 1024,
    containerName: 'images',
    blobName: 'github:abc123/2026/04/01J9TESTULID.png',
    blobUrl:
      'https://cdn.example.com/media/images/github%3Aabc123/2026/04/01J9TESTULID.png',
    uploadUrl:
      'https://storage.example.blob.core.windows.net/images/github%3Aabc123/2026/04/01J9TESTULID.png?sig=test',
    expiresAt: '2026-04-15T04:10:00.000Z',
    method: 'PUT',
    requiredHeaders: {
      'content-type': 'image/png',
      'x-ms-blob-type': 'BlockBlob',
    },
    etag: '"etag-1"',
    requestId: 'request-1',
  }
}

describe('DirectBlobUploadCard', () => {
  it('shows upload progress and the uploaded blob details', async () => {
    const deferred = createDeferred<UploadedBlobResult>()
    const uploadFile: UploadMediaFileFn = vi.fn(
      async ({ file, kind, onProgress }) => {
        expect(file.name).toBe('preview.png')
        expect(kind).toBe('image')

        onProgress?.({
          loaded: 64,
          total: 128,
          percent: 50,
        })

        return deferred.promise
      },
    )

    render(
      <DirectBlobUploadCard
        accept="image/png"
        description="Uploads a single image directly to Blob Storage."
        helperText="PNG up to 8 MB."
        kind="image"
        title="Image upload"
        uploadFile={uploadFile}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Choose file' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Image upload file'), {
      target: {
        files: [
          new File(['file-bytes'], 'preview.png', {
            type: 'image/png',
          }),
        ],
      },
    })

    expect(
      await screen.findByText('Uploading directly to Blob Storage (50%).'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Image upload progress' }),
    ).toHaveAttribute('aria-valuenow', '50')

    deferred.resolve(createUploadResult())

    await waitFor(() => {
      expect(
        screen.getByText('Uploaded directly to Blob Storage.'),
      ).toBeInTheDocument()
    })

    expect(
      screen.getByRole('link', { name: 'Open uploaded asset' }),
    ).toHaveAttribute(
      'href',
      'https://cdn.example.com/media/images/github%3Aabc123/2026/04/01J9TESTULID.png',
    )
    expect(uploadFile).toHaveBeenCalledTimes(1)
  })

  it('waits for post-upload persistence before reporting success', async () => {
    const uploadDeferred = createDeferred<UploadedBlobResult>()
    const persistenceDeferred = createDeferred<void>()
    const uploadFile: UploadMediaFileFn = vi.fn(async ({ onProgress }) => {
      onProgress?.({
        loaded: 128,
        total: 128,
        percent: 100,
      })

      return uploadDeferred.promise
    })
    const onUploaded = vi.fn(async () => persistenceDeferred.promise)

    render(
      <DirectBlobUploadCard
        accept="image/png"
        description="Uploads a single image directly to Blob Storage."
        helperText="PNG up to 8 MB."
        kind="image"
        title="Image upload"
        onUploaded={onUploaded}
        uploadFile={uploadFile}
      />,
    )

    fireEvent.change(screen.getByLabelText('Image upload file'), {
      target: {
        files: [
          new File(['file-bytes'], 'preview.png', {
            type: 'image/png',
          }),
        ],
      },
    })

    uploadDeferred.resolve(createUploadResult())

    expect(
      await screen.findByText('Finalising the upload flow…'),
    ).toBeInTheDocument()
    expect(screen.getByText('Saving')).toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledTimes(1)

    persistenceDeferred.resolve(undefined)

    await waitFor(() => {
      expect(
        screen.getByText('Uploaded directly to Blob Storage.'),
      ).toBeInTheDocument()
    })
  })
})
