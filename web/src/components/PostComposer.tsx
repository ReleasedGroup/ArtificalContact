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
import { AppImage } from './AppImage'

type ComposerVariant = 'post' | 'reply'

export interface PostComposerSubmission {
  mediaFiles: PostComposerSubmissionMediaFile[]
  value: string
}

export interface PostComposerSubmissionMediaFile {
  altText: string
  file: File
}

export interface PostComposerMediaFile {
  altText: string
  file: File
  previewUrl: string | null
  signature: string
}

interface PostComposerProps {
  authorBadge: string
  authorHandle?: string | null
  authorName: string
  disabled?: boolean
  hasExternalMedia?: boolean
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
      altText: '',
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

function buildImagePreviewAltText(item: PostComposerMediaFile): string {
  const trimmedAltText = item.altText.trim()

  if (trimmedAltText.length > 0) {
    return trimmedAltText
  }

  return `Selected image preview for ${item.file.name}`
}

function buildMediaFieldId(
  baseId: string,
  signature: string,
  suffix: string,
): string {
  const sanitizedSignature = signature.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `${baseId}-${sanitizedSignature}-${suffix}`
}

export function PostComposer({
  authorBadge,
  authorHandle = null,
  authorName,
  disabled = false,
  hasExternalMedia = false,
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
  const composerHelpId = useId()
  const mediaInputId = useId()
  const mediaInputLabelId = useId()
  const mediaInputHintId = useId()
  const mediaInputStatusId = useId()
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)
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
    (variant === 'post'
      ? hasExternalMedia || mediaFiles.length > 0 || !isComposerTextEmpty(value)
      : !isComposerTextEmpty(value))

  const isReplyComposer = variant === 'reply'
  const isDropZoneActive = isDragActive && !isMediaInputDisabled
  const mediaSectionTitle = isReplyComposer
    ? 'Reply image attachments'
    : 'Post image attachments'

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
      mediaFiles: mediaFiles.map((item) => ({
        altText: item.altText.trim(),
        file: item.file,
      })),
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

  const handleBrowseImages = () => {
    mediaInputRef.current?.click()
  }

  const handleAltTextChange = (fileSignature: string, nextAltText: string) => {
    onMediaFilesChange(
      mediaFiles.map((item) =>
        item.signature === fileSignature
          ? {
              ...item,
              altText: nextAltText,
            }
          : item,
      ),
    )
  }

  return (
    <form className={`flex ${isReplyComposer ? 'gap-2.5' : 'gap-3'}`} onSubmit={handleSubmit}>
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
            <p className="text-xs text-slate-400">
              {authorHandle ? `@${authorHandle}` : 'Handle pending'}
            </p>
          </div>
          {!isReplyComposer && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">
              Post composer
            </span>
          )}
        </div>

        <label className="sr-only" htmlFor={textAreaId}>
          {label}
        </label>
        <p className="sr-only" id={composerHelpId}>
          Type your message, use the image attachments section to browse or drag
          image files, and add alternative text so people using screen readers
          can understand the attachment content.
        </p>
        <div
          className={`relative mt-3 overflow-hidden border bg-slate-950/85 transition focus-within:border-sky-300/50 focus-within:ring-2 focus-within:ring-sky-300/40 focus-within:ring-offset-2 focus-within:ring-offset-slate-950 ${
            isReplyComposer
              ? 'rounded-[1.2rem] border-white/8 bg-white/[0.02]'
              : 'rounded-[1.5rem] border-white/10 shadow-inner shadow-slate-950/40'
          }`}
        >
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
              <span className="text-slate-400">{placeholder}</span>
            )}
          </div>

          <textarea
            id={textAreaId}
            aria-describedby={`${counterId} ${composerHelpId}`}
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

        <div
          className={`mt-3 border border-dashed bg-slate-950/55 ${
            isReplyComposer
              ? 'rounded-[1.2rem] border-white/8 p-3'
              : 'rounded-[1.5rem] border-white/10 p-4'
          }`}
        >
          <div
            aria-describedby={`${mediaInputHintId} ${mediaInputStatusId}`}
            aria-disabled={isMediaInputDisabled}
            aria-labelledby={mediaInputLabelId}
            className={`border border-dashed px-4 py-4 transition ${
              isDropZoneActive
                ? 'border-sky-300/70 bg-sky-400/10'
                : 'border-white/10 bg-white/[0.03]'
            } ${isReplyComposer ? 'rounded-[1rem]' : 'rounded-[1.25rem]'} ${
              isMediaInputDisabled ? 'opacity-60' : ''
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            role="group"
          >
            <p
              aria-live="polite"
              className="sr-only"
              id={mediaInputStatusId}
              role="status"
            >
              {mediaFiles.length > 0
                ? `${formatImageCount(mediaFiles.length)} attached. Consider adding alt text for each image.`
                : 'No image attachments selected yet.'}
            </p>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p
                  className="text-sm font-medium text-white"
                  id={mediaInputLabelId}
                >
                  {mediaSectionTitle}
                </p>
                <p
                  className="mt-1 text-xs leading-6 text-slate-300"
                  id={mediaInputHintId}
                >
                  {isReplyComposer
                    ? 'Drag images here or browse from the keyboard to preview them locally. Add alt text for each image so screen readers can describe the attachment before reply uploads are wired in.'
                    : 'Drag images here or browse from the keyboard to preview them locally. Selected images upload directly to Blob Storage when you publish the post.'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {mediaFiles.length > 0 && (
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-100">
                    {formatImageCount(mediaFiles.length)}
                  </span>
                )}
                {isMediaInputDisabled ? (
                  <button
                    className="cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 transition"
                    disabled
                    type="button"
                  >
                    Browse images
                  </button>
                ) : (
                  <button
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-200 transition hover:border-sky-300/40 hover:bg-sky-400/10 hover:text-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    onClick={handleBrowseImages}
                    type="button"
                  >
                    Browse images
                  </button>
                )}
              </div>
            </div>

            <input
              accept="image/*"
              aria-label={
                isReplyComposer ? 'Choose reply images' : 'Choose post images'
              }
              className="sr-only"
              disabled={isMediaInputDisabled}
              id={mediaInputId}
              multiple
              onChange={handleMediaInputChange}
              ref={mediaInputRef}
              tabIndex={-1}
              type="file"
            />
          </div>

          {mediaFiles.length > 0 && (
            <ul
              className={`mt-4 grid gap-3 ${
                mediaFiles.length === 1 ? 'sm:grid-cols-1' : 'sm:grid-cols-2'
              }`}
            >
              {mediaFiles.map((item) => {
                const altInputId = buildMediaFieldId(
                  textAreaId,
                  item.signature,
                  'alt',
                )
                const altInputHelpId = buildMediaFieldId(
                  textAreaId,
                  item.signature,
                  'alt-help',
                )

                return (
                  <li
                    key={item.signature}
                    className="overflow-hidden rounded-[1.1rem] border border-white/8 bg-slate-900/65"
                  >
                    {item.previewUrl ? (
                      <AppImage
                        alt={buildImagePreviewAltText(item)}
                        className="h-40 w-full object-cover"
                        loading="eager"
                        src={item.previewUrl}
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center bg-slate-950 text-sm text-slate-400">
                        Preview unavailable in this environment
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {item.file.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatFileSize(item.file.size)}
                        </p>
                        <div className="mt-3">
                          <label
                            className="text-xs font-medium uppercase tracking-[0.18em] text-slate-300"
                            htmlFor={altInputId}
                          >
                            Alt text
                          </label>
                          <p
                            className="mt-1 text-xs leading-6 text-slate-400"
                            id={altInputHelpId}
                          >
                            Describe the important visual details for people
                            using screen readers.
                          </p>
                          <input
                            aria-describedby={altInputHelpId}
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/30"
                            id={altInputId}
                            maxLength={240}
                            onChange={(event) =>
                              handleAltTextChange(
                                item.signature,
                                event.target.value,
                              )
                            }
                            placeholder="Describe the image for screen readers"
                            type="text"
                            value={item.altText}
                          />
                        </div>
                      </div>

                      <button
                        aria-label={`Remove ${item.file.name}`}
                        className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100 transition hover:border-rose-300/40 hover:bg-rose-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                        onClick={() => handleRemoveMediaFile(item.signature)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            {isReplyComposer
              ? 'Highlighting mirrors backend hashtag and mention parsing. Image previews stay local until reply uploads are wired in, and attachment alt text stays with the selected files.'
              : 'Highlighting mirrors backend hashtag and mention parsing. Selected post images upload when you publish, and attachment alt text stays with the selected files during composition.'}
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
              className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
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
