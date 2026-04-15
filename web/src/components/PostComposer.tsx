import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type UIEvent,
} from 'react'
import {
  getComposerSegments,
  isComposerTextEmpty,
  type ComposerSegment,
} from '../lib/composer'

type ComposerVariant = 'post' | 'reply'

export interface PostComposerSubmission {
  mediaFiles: File[]
  value: string
}

export interface PostComposerMediaFile {
  file: File
  previewUrl: string | null
  signature: string
}

interface PostComposerProps {
  authorBadge: string
  authorHandle?: string | null
  authorName: string
  disabled?: boolean
  label: string
  maxLength?: number
  mediaFiles: PostComposerMediaFile[]
  onChange: (nextValue: string) => void
  onMediaFilesChange: (nextFiles: PostComposerMediaFile[]) => void
  onSubmit: (submission: PostComposerSubmission) => void
  placeholder: string
  submitLabel: string
  submitting?: boolean
  value: string
  variant?: ComposerVariant
}

const tokenClassNames: Record<
  Exclude<ComposerSegment['kind'], 'text'>,
  string
> = {
  hashtag:
    'rounded bg-sky-300/12 px-1 text-sky-100 ring-1 ring-inset ring-sky-300/25',
  mention:
    'rounded bg-fuchsia-300/12 px-1 text-fuchsia-100 ring-1 ring-inset ring-fuchsia-300/25',
}

function formatCounter(value: number, maxLength: number): string {
  return `${value} / ${maxLength}`
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileSignature(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`
}

function isAcceptedImageFile(file: File): boolean {
  const normalizedContentType = file.type.trim().toLowerCase()

  if (normalizedContentType.startsWith('image/')) {
    return true
  }

  if (normalizedContentType.length > 0) {
    return false
  }

  return /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') {
    return null
  }

  return URL.createObjectURL(file)
}

function revokePreviewUrl(previewUrl: string | null) {
  if (previewUrl === null || typeof URL.revokeObjectURL !== 'function') {
    return
  }

  URL.revokeObjectURL(previewUrl)
}

function mergeUniqueImageFiles(
  existingFiles: PostComposerMediaFile[],
  incomingFiles: File[],
): PostComposerMediaFile[] {
  const nextFiles = [...existingFiles]
  const signatures = new Set(existingFiles.map((file) => file.signature))

  for (const file of incomingFiles) {
    if (!isAcceptedImageFile(file)) {
      continue
    }

    const signature = getFileSignature(file)

    if (signatures.has(signature)) {
      continue
    }

    signatures.add(signature)
    nextFiles.push({
      file,
      previewUrl: createPreviewUrl(file),
      signature,
    })
  }

  return nextFiles
}

function formatImageCount(count: number): string {
  return `${count} ${count === 1 ? 'image' : 'images'} ready`
}

export function PostComposer({
  authorBadge,
  authorHandle = null,
  authorName,
  disabled = false,
  label,
  maxLength = 280,
  mediaFiles,
  onChange,
  onMediaFilesChange,
  onSubmit,
  placeholder,
  submitLabel,
  submitting = false,
  value,
  variant = 'post',
}: PostComposerProps) {
  const textAreaId = useId()
  const counterId = useId()
  const mediaInputId = useId()
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const previousMediaFilesRef = useRef<PostComposerMediaFile[]>(mediaFiles)
  const dragDepthRef = useRef(0)
  const [isDragActive, setIsDragActive] = useState(false)
  const characterCount = value.length
  const segments = getComposerSegments(value)
  const remainingCharacters = maxLength - characterCount
  const isMediaInputDisabled = disabled || submitting
  const canSubmit =
    !disabled &&
    !submitting &&
    remainingCharacters >= 0 &&
    !isComposerTextEmpty(value)

  const isReplyComposer = variant === 'reply'
  const isDropZoneActive = isDragActive && !isMediaInputDisabled

  useEffect(() => {
    const previousMediaFiles = previousMediaFilesRef.current
    const currentSignatures = new Set(mediaFiles.map((file) => file.signature))

    for (const item of previousMediaFiles) {
      if (!currentSignatures.has(item.signature)) {
        revokePreviewUrl(item.previewUrl)
      }
    }

    previousMediaFilesRef.current = mediaFiles
  }, [mediaFiles])

  useEffect(() => {
    return () => {
      for (const item of previousMediaFilesRef.current) {
        revokePreviewUrl(item.previewUrl)
      }
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    onSubmit({
      mediaFiles: mediaFiles.map((item) => item.file),
      value,
    })
  }

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (mirrorRef.current === null) {
      return
    }

    mirrorRef.current.scrollTop = event.currentTarget.scrollTop
    mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft
  }

  const appendMediaFiles = (incomingFiles: File[]) => {
    if (isMediaInputDisabled || incomingFiles.length === 0) {
      return
    }

    const nextFiles = mergeUniqueImageFiles(mediaFiles, incomingFiles)

    if (nextFiles.length === mediaFiles.length) {
      return
    }

    onMediaFilesChange(nextFiles)
  }

  const handleMediaInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    appendMediaFiles(selectedFiles)
    event.target.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    if (isMediaInputDisabled) {
      return
    }

    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    if (isMediaInputDisabled) {
      return
    }

    event.dataTransfer.dropEffect = 'copy'

    if (!isDragActive) {
      setIsDragActive(true)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    dragDepthRef.current = 0
    setIsDragActive(false)

    if (isMediaInputDisabled) {
      return
    }

    appendMediaFiles(Array.from(event.dataTransfer.files))
  }

  const handleRemoveMediaFile = (fileSignature: string) => {
    onMediaFilesChange(
      mediaFiles.filter((file) => file.signature !== fileSignature),
    )
  }

  return (
    <form className="flex gap-3" onSubmit={handleSubmit}>
      <div
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 font-semibold tracking-[0.08em] text-white shadow-lg shadow-sky-950/25 ${
          isReplyComposer ? 'h-10 w-10 text-xs' : 'h-12 w-12 text-sm'
        }`}
      >
        {authorBadge}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">{authorName}</p>
            <p className="text-xs text-slate-500">
              {authorHandle ? `@${authorHandle}` : 'Handle pending'}
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
            {isReplyComposer ? 'Reply box' : 'Post composer'}
          </span>
        </div>

        <label className="sr-only" htmlFor={textAreaId}>
          {label}
        </label>
        <div className="relative mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/85 shadow-inner shadow-slate-950/40">
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 text-[15px] whitespace-pre-wrap break-words text-slate-100 ${
              isReplyComposer ? 'leading-6' : 'leading-7'
            }`}
          >
            {value.length > 0 ? (
              <>
                {segments.map((segment, index) =>
                  segment.kind === 'text' ? (
                    <span key={`${segment.kind}-${index}-${segment.text}`}>
                      {segment.text}
                    </span>
                  ) : (
                    <mark
                      key={`${segment.kind}-${index}-${segment.text}`}
                      data-composer-token={segment.kind}
                      className={tokenClassNames[segment.kind]}
                    >
                      {segment.text}
                    </mark>
                  ),
                )}
                <span className="select-none"> </span>
              </>
            ) : (
              <span className="text-slate-500">{placeholder}</span>
            )}
          </div>

          <textarea
            id={textAreaId}
            aria-describedby={counterId}
            className={`relative z-10 block w-full resize-none bg-transparent px-4 py-3 text-[15px] text-transparent caret-white outline-none placeholder:text-transparent focus:outline-none ${
              isReplyComposer ? 'min-h-24 leading-6' : 'min-h-36 leading-7'
            }`}
            disabled={disabled}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onScroll={handleScroll}
            placeholder={placeholder}
            rows={isReplyComposer ? 3 : 5}
            style={{ WebkitTextFillColor: 'transparent' }}
            value={value}
          />
        </div>

        <div className="mt-3 rounded-[1.5rem] border border-dashed border-white/10 bg-slate-950/55 p-4">
          <div
            aria-label={
              isReplyComposer
                ? 'Reply image attachments'
                : 'Post image attachments'
            }
            className={`rounded-[1.25rem] border border-dashed px-4 py-4 transition ${
              isDropZoneActive
                ? 'border-sky-300/70 bg-sky-400/10'
                : 'border-white/10 bg-white/[0.03]'
            } ${isMediaInputDisabled ? 'opacity-60' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            role="group"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  Image attachments
                </p>
                <p className="mt-1 text-xs leading-6 text-slate-400">
                  Drag images here or browse to preview them locally before the
                  Sprint 3 upload flow is wired in.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {mediaFiles.length > 0 && (
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-100">
                    {formatImageCount(mediaFiles.length)}
                  </span>
                )}
                {isMediaInputDisabled ? (
                  <span
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 transition"
                  >
                    Browse images
                  </span>
                ) : (
                  <label
                    className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-200 transition hover:border-sky-300/40 hover:bg-sky-400/10 hover:text-sky-100"
                    htmlFor={mediaInputId}
                  >
                    Browse images
                  </label>
                )}
              </div>
            </div>

            <input
              accept="image/*"
              className="sr-only"
              disabled={isMediaInputDisabled}
              id={mediaInputId}
              multiple
              onChange={handleMediaInputChange}
              type="file"
            />
          </div>

          {mediaFiles.length > 0 && (
            <ul
              className={`mt-4 grid gap-3 ${
                mediaFiles.length === 1 ? 'sm:grid-cols-1' : 'sm:grid-cols-2'
              }`}
            >
              {mediaFiles.map((item) => (
                <li
                  key={item.signature}
                  className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-900/80 shadow-lg shadow-slate-950/30"
                >
                  {item.previewUrl ? (
                    <img
                      alt={`Selected media preview: ${item.file.name}`}
                      className="h-40 w-full object-cover"
                      src={item.previewUrl}
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-slate-950 text-sm text-slate-400">
                      Preview unavailable in this environment
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {item.file.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatFileSize(item.file.size)}
                      </p>
                    </div>

                    <button
                      aria-label={`Remove ${item.file.name}`}
                      className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100 transition hover:border-rose-300/40 hover:bg-rose-400/20"
                      onClick={() => handleRemoveMediaFile(item.signature)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Highlighting mirrors backend hashtag and mention parsing. Image
            previews stay local until upload wiring lands.
          </p>
          <div className="flex items-center gap-3">
            <span
              id={counterId}
              className={`text-xs font-medium ${
                remainingCharacters <= 40 ? 'text-amber-200' : 'text-slate-400'
              }`}
            >
              {formatCounter(characterCount, maxLength)}
            </span>
            <button
              className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
              disabled={!canSubmit}
              type="submit"
            >
              {submitting ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
