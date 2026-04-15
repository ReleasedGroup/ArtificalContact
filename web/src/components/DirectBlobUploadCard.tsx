import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import {
  uploadMediaFile,
  type MediaKind,
  type UploadMediaFileFn,
  type UploadedBlobResult,
} from '../lib/media-upload'

interface DirectBlobUploadCardProps {
  accept: string
  description: string
  helperText: string
  kind: MediaKind
  title: string
  onUploaded?: (upload: UploadedBlobResult) => Promise<void> | void
  uploadFile?: UploadMediaFileFn
}

interface UploadState {
  status:
    | 'idle'
    | 'requesting'
    | 'uploading'
    | 'persisting'
    | 'success'
    | 'error'
  fileName: string | null
  message: string | null
  progress: number
  result: UploadedBlobResult | null
}

const idleState: UploadState = {
  status: 'idle',
  fileName: null,
  message: null,
  progress: 0,
  result: null,
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatExpiry(expiresAt: string): string {
  const parsed = new Date(expiresAt)
  if (Number.isNaN(parsed.valueOf())) {
    return expiresAt
  }

  return parsed.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function getStatusBadgeClassName(status: UploadState['status']): string {
  switch (status) {
    case 'success':
      return 'border-emerald-400/25 bg-emerald-400/12 text-emerald-100'
    case 'error':
      return 'border-rose-400/25 bg-rose-400/12 text-rose-100'
    case 'requesting':
    case 'uploading':
    case 'persisting':
      return 'border-sky-300/25 bg-sky-300/12 text-sky-100'
    default:
      return 'border-white/10 bg-white/5 text-slate-300'
  }
}

export function DirectBlobUploadCard({
  accept,
  description,
  helperText,
  kind,
  title,
  onUploaded,
  uploadFile = uploadMediaFile,
}: DirectBlobUploadCardProps) {
  const inputId = useId()
  const [uploadState, setUploadState] = useState<UploadState>(idleState)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isUploading =
    uploadState.status === 'requesting' ||
    uploadState.status === 'uploading' ||
    uploadState.status === 'persisting'

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const abortController = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = abortController

    setUploadState({
      status: 'requesting',
      fileName: file.name,
      message: 'Requesting a signed upload URL…',
      progress: 0,
      result: null,
    })

    try {
      const result = await uploadFile({
        file,
        kind,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (abortControllerRef.current !== abortController) {
            return
          }

          setUploadState((currentState) => {
            if (
              currentState.status === 'uploading' &&
              currentState.fileName === file.name &&
              currentState.progress === progress.percent
            ) {
              return currentState
            }

            return {
              status: 'uploading',
              fileName: file.name,
              message: `Uploading directly to Blob Storage (${progress.percent}%).`,
              progress: progress.percent,
              result: null,
            }
          })
        },
      })

      if (abortControllerRef.current !== abortController) {
        return
      }

      if (onUploaded) {
        setUploadState({
          status: 'persisting',
          fileName: file.name,
          message: 'Finalising the upload flow…',
          progress: 100,
          result,
        })

        await onUploaded(result)

        if (abortControllerRef.current !== abortController) {
          return
        }
      }

      setUploadState({
        status: 'success',
        fileName: file.name,
        message: 'Uploaded directly to Blob Storage.',
        progress: 100,
        result,
      })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      if (abortControllerRef.current !== abortController) {
        return
      }

      setUploadState({
        status: 'error',
        fileName: file.name,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to upload the selected file.',
        progress: 0,
        result: null,
      })
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
    }
  }

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="mt-2 text-sm leading-7 text-slate-400">{description}</p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${getStatusBadgeClassName(
            uploadState.status,
          )}`}
        >
          {uploadState.status === 'idle' && 'Ready'}
          {uploadState.status === 'requesting' && 'Signing'}
          {uploadState.status === 'uploading' && 'Uploading'}
          {uploadState.status === 'persisting' && 'Saving'}
          {uploadState.status === 'success' && 'Uploaded'}
          {uploadState.status === 'error' && 'Retry'}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
          {helperText}
        </p>

        <label className="sr-only" htmlFor={inputId}>
          {title} file
        </label>
        <input
          id={inputId}
          accept={accept}
          className="sr-only"
          disabled={isUploading}
          onChange={handleFileChange}
          ref={inputRef}
          type="file"
        />

        <button
          className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            isUploading
              ? 'cursor-not-allowed bg-slate-800 text-slate-400'
              : 'bg-sky-400 text-slate-950 hover:bg-sky-300'
          }`}
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {isUploading ? 'Uploading…' : 'Choose file'}
        </button>

        {uploadState.fileName && (
          <p className="text-sm text-slate-300">
            File:{' '}
            <span className="font-medium text-white">{uploadState.fileName}</span>
          </p>
        )}

        {uploadState.status !== 'idle' && (
          <div className="space-y-2">
            <div
              aria-label={`${title} progress`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={uploadState.progress}
              className="h-2 overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${
                  uploadState.status === 'error'
                    ? 'bg-rose-400'
                    : 'bg-sky-300'
                }`}
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
            {uploadState.message && (
              <p className="text-sm text-slate-300">{uploadState.message}</p>
            )}
          </div>
        )}

        {uploadState.status === 'success' && uploadState.result && (
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 p-4 text-sm text-slate-200">
            <p>
              Uploaded {formatBytes(uploadState.result.sizeBytes)} to{' '}
              <span className="font-medium text-white">
                {uploadState.result.containerName}
              </span>
              .
            </p>
            <p className="mt-2 text-slate-300">
              Blob path{' '}
              <span className="font-mono text-xs text-slate-200">
                {uploadState.result.blobName}
              </span>
            </p>
            <p className="mt-2 text-slate-400">
              Upload URL expires {formatExpiry(uploadState.result.expiresAt)}.
            </p>
            <a
              className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/10"
              href={uploadState.result.blobUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open uploaded asset
            </a>
          </div>
        )}
      </div>
    </article>
  )
}
