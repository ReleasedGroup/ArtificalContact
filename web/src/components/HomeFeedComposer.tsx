import { useMemo, useState, type FormEvent } from 'react'
import type { MeProfile } from '../lib/me'
import {
  createPost,
  type CreatePostMediaInput,
} from '../lib/post-write'
import type { UploadedBlobResult } from '../lib/media-upload'
import type { GifSearchResult } from '../lib/gif-search'
import { AppImage } from './AppImage'
import { DirectBlobUploadCard } from './DirectBlobUploadCard'
import { ModalDialog } from './ModalDialog'
import { ReplyGifPicker } from './ReplyGifPicker'

const maxComposerLength = 280
const maxComposerAttachments = 4
const imageUploadAccept = 'image/avif,image/jpeg,image/png,image/webp'

interface HomeFeedComposerProps {
  onPublished?: () => Promise<void> | void
  viewer: MeProfile
}

interface HomeFeedComposerAttachment {
  id: string | null
  key: string
  kind: 'image' | 'gif'
  label: string
  thumbUrl: string | null
  url: string
  width: number | null
  height: number | null
}

function buildMonogram(
  source: string | null | undefined,
  fallback: string,
): string {
  const resolvedSource = source?.trim() || fallback
  const words = resolvedSource.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return resolvedSource.slice(0, 2).toUpperCase()
}

function buildCreatePostMediaPayload(
  attachments: HomeFeedComposerAttachment[],
): CreatePostMediaInput[] {
  return attachments.map((attachment) => ({
    ...(attachment.id ? { id: attachment.id } : {}),
    kind: attachment.kind,
    url: attachment.url,
    ...(attachment.thumbUrl ? { thumbUrl: attachment.thumbUrl } : {}),
    ...(attachment.width !== null ? { width: attachment.width } : {}),
    ...(attachment.height !== null ? { height: attachment.height } : {}),
  }))
}

function createUploadedAttachment(
  upload: UploadedBlobResult,
): HomeFeedComposerAttachment | null {
  if (upload.kind !== 'image' && upload.kind !== 'gif') {
    return null
  }

  return {
    id: null,
    key: `blob:${upload.blobName}`,
    kind: upload.kind,
    label: upload.blobName.split('/').pop() ?? upload.blobName,
    thumbUrl: upload.blobUrl,
    url: upload.blobUrl,
    width: null,
    height: null,
  }
}

function createGifAttachment(gif: GifSearchResult): HomeFeedComposerAttachment {
  return {
    id: gif.id,
    key: `gif:${gif.id}`,
    kind: 'gif',
    label: gif.title?.trim() || 'Selected GIF',
    thumbUrl: gif.previewUrl,
    url: gif.gifUrl,
    width: gif.width,
    height: gif.height,
  }
}

function appendUniqueAttachment(
  currentAttachments: HomeFeedComposerAttachment[],
  nextAttachment: HomeFeedComposerAttachment,
): HomeFeedComposerAttachment[] {
  if (
    currentAttachments.some(
      (attachment) =>
        attachment.key === nextAttachment.key ||
        (attachment.kind === nextAttachment.kind &&
          attachment.url === nextAttachment.url),
    )
  ) {
    return currentAttachments
  }

  return [...currentAttachments, nextAttachment].slice(0, maxComposerAttachments)
}

function formatAttachmentCount(count: number): string {
  return `${count}/${maxComposerAttachments} attached`
}

export function HomeFeedComposer({
  onPublished,
  viewer,
}: HomeFeedComposerProps) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<HomeFeedComposerAttachment[]>(
    [],
  )
  const [isPublishing, setIsPublishing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isImageUploadOpen, setIsImageUploadOpen] = useState(false)
  const [isGifPickerOpen, setIsGifPickerOpen] = useState(false)

  const viewerMonogram = useMemo(
    () =>
      buildMonogram(viewer.displayName.trim() || viewer.handle?.trim(), 'ME'),
    [viewer.displayName, viewer.handle],
  )
  const trimmedDraft = draft.trim()
  const canCompose = viewer.status === 'active' && Boolean(viewer.handle)
  const attachmentSlotsRemaining = maxComposerAttachments - attachments.length
  const canManageAttachments =
    canCompose && !isPublishing && attachmentSlotsRemaining > 0
  const canPublish =
    canCompose &&
    !isPublishing &&
    (trimmedDraft.length > 0 || attachments.length > 0)

  const handleUploadedAttachment =
    (expectedKind: 'image' | 'gif') => async (upload: UploadedBlobResult) => {
      const attachment = createUploadedAttachment(upload)

      if (attachment === null || attachment.kind !== expectedKind) {
        setFeedback('The uploaded media could not be attached to this post.')
        return
      }

      setAttachments((currentAttachments) =>
        appendUniqueAttachment(currentAttachments, attachment),
      )
      setFeedback(null)
    }

  const handleGifSelect = (gif: GifSearchResult) => {
    setAttachments((currentAttachments) =>
      appendUniqueAttachment(currentAttachments, createGifAttachment(gif)),
    )
    setFeedback(null)
    setIsGifPickerOpen(false)
  }

  const handleRemoveAttachment = (attachmentKey: string) => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.key !== attachmentKey),
    )
    setFeedback(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canPublish) {
      return
    }

    setIsPublishing(true)
    setFeedback(null)

    try {
      await createPost({
        ...(trimmedDraft.length > 0 ? { text: trimmedDraft } : {}),
        ...(attachments.length > 0
          ? { media: buildCreatePostMediaPayload(attachments) }
          : {}),
      })

      setDraft('')
      setAttachments([])
      await onPublished?.()
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Unable to publish the post.',
      )
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <>
      <form
        className="mb-6 flex items-start gap-3 rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-4 shadow-lg shadow-slate-950/20"
        onSubmit={handleSubmit}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.2rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 text-xs font-semibold tracking-[0.08em] text-white">
          {viewerMonogram}
        </div>
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="home-feed-post-body">
            Post body
          </label>
          <textarea
            id="home-feed-post-body"
            aria-label="Post body"
            className="block w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/30"
            disabled={isPublishing || !canCompose}
            maxLength={maxComposerLength}
            onChange={(event) => {
              setDraft(event.target.value)
              setFeedback(null)
            }}
            placeholder={
              !viewer.handle
                ? 'Set a handle in your profile to start posting.'
                : viewer.status !== 'active'
                  ? 'Activate your profile to start posting.'
                  : 'Share an update...'
            }
            rows={2}
            value={draft}
          />

          {feedback && <p className="mt-2 text-sm text-rose-300">{feedback}</p>}

          {attachments.length > 0 && (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.key}
                  className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/65"
                >
                  {attachment.thumbUrl ? (
                    <AppImage
                      alt={`${attachment.kind} attachment preview`}
                      className="h-28 w-full object-cover"
                      loading="eager"
                      src={attachment.thumbUrl}
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-slate-950/80 text-xs uppercase tracking-[0.2em] text-slate-400">
                      {attachment.kind}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {attachment.label}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        {attachment.kind}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment.key)}
                      className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100 transition hover:border-rose-300/40 hover:bg-rose-400/20"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                aria-label="Browse images"
                className="rounded-full border border-white/10 p-2 text-slate-200 transition hover:border-sky-300/35 hover:bg-sky-300/10 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!canManageAttachments}
                onClick={() => {
                  setIsImageUploadOpen(true)
                }}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path
                    d="M21 15l-5-5L5 21"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                aria-label="Browse GIFs"
                className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!canManageAttachments}
                onClick={() => {
                  setIsGifPickerOpen(true)
                }}
                type="button"
              >
                GIF
              </button>
              {attachments.length > 0 && (
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-100">
                  {formatAttachmentCount(attachments.length)}
                </span>
              )}
              <span className="text-xs text-slate-500">
                {draft.length}/{maxComposerLength}
              </span>
            </div>
            <button
              className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
              disabled={!canPublish}
              type="submit"
            >
              {isPublishing ? 'Posting...' : 'Post'}
            </button>
          </div>
        </div>
      </form>

      <ModalDialog
        description="Upload a still image directly to Blob Storage and attach it to the post draft."
        isOpen={isImageUploadOpen}
        maxWidthClassName="max-w-2xl"
        onClose={() => {
          setIsImageUploadOpen(false)
        }}
        title="Upload image"
      >
        {attachmentSlotsRemaining > 0 ? (
          <DirectBlobUploadCard
            accept={imageUploadAccept}
            description="Upload a still image and keep the home feed composer compact until you're ready to post."
            helperText="AVIF, JPEG, PNG, or WebP up to 8 MB."
            kind="image"
            onUploaded={handleUploadedAttachment('image')}
            title="Post image upload"
          />
        ) : (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Remove an attachment before uploading another image.
          </div>
        )}
      </ModalDialog>

      <ModalDialog
        description="Search Tenor or upload a GIF directly to Blob Storage, then attach it to the home-feed post draft."
        isOpen={isGifPickerOpen}
        maxWidthClassName="max-w-4xl"
        onClose={() => {
          setIsGifPickerOpen(false)
        }}
        title="Choose a GIF"
      >
        <div className="space-y-6">
          {attachmentSlotsRemaining > 0 ? (
            <DirectBlobUploadCard
              accept="image/gif"
              description="Upload a GIF file directly to Blob Storage and attach it to the post draft."
              helperText="GIF up to 8 MB."
              kind="gif"
              onUploaded={handleUploadedAttachment('gif')}
              title="GIF upload"
            />
          ) : (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Remove an attachment before adding another GIF.
            </div>
          )}

          <ReplyGifPicker
            descriptionText="Search Tenor and attach a GIF to the home-feed post draft without leaving the composer."
            disabled={!canManageAttachments}
            headingLabel="Post GIFs"
            onSelect={handleGifSelect}
            resultActionLabel="Attach"
            resultAriaLabelPrefix="Attach GIF"
          />
        </div>
      </ModalDialog>
    </>
  )
}
