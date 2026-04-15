import { useState } from 'react'
import { UploadPipelinePreview } from './UploadPipelinePreview'
import { PostComposer, type PostComposerMediaFile } from './PostComposer'
import { UploadPipelinePreview } from './UploadPipelinePreview'

interface ComposerPreviewPanelProps {
  authorBadge: string
  authorHandle: string | null
  authorName: string
}

export function ComposerPreviewPanel({
  authorBadge,
  authorHandle,
  authorName,
}: ComposerPreviewPanelProps) {
  const [postDraft, setPostDraft] = useState(
    'Shipping a reusable #composer shell for @frontend before lunch.',
  )
  const [replyDraft, setReplyDraft] = useState(
    'We should keep the #thread reply surface lightweight and readable.',
  )
  const [postMediaFiles, setPostMediaFiles] = useState<PostComposerMediaFile[]>(
    [],
  )
  const [replyMediaFiles, setReplyMediaFiles] = useState<PostComposerMediaFile[]>(
    [],
  )
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const replyTarget = authorHandle ? `@${authorHandle}` : '@thread-root'

  return (
    <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-emerald-100/80">
            Composer preview
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Issue #57 extends the reusable composer shell with local image
            attachment previews, drag-and-drop selection, and removal controls
            ahead of the real Sprint 3 upload pipeline. These submissions stay
            local for now so later slices can reuse the same UI once the post,
            reply, and upload mutations are wired into their real screens.
          </p>
        </div>

        {feedbackMessage && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
            {feedbackMessage}
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-medium text-white">Top-level post</p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Uses the full multiline composer footprint planned for the feed
            surface.
          </p>
          <div className="mt-4">
            <PostComposer
              authorBadge={authorBadge}
              authorHandle={authorHandle}
              authorName={authorName}
              label="Post body"
              mediaFiles={postMediaFiles}
              onChange={(nextValue) => {
                setPostDraft(nextValue)
                setFeedbackMessage(null)
              }}
              onMediaFilesChange={(nextFiles) => {
                setPostMediaFiles(nextFiles)
                setFeedbackMessage(null)
              }}
              onSubmit={({ mediaFiles, value: submittedValue }) => {
                setPostDraft('')
                setPostMediaFiles([])
                setFeedbackMessage(
                  `Local post preview saved with ${mediaFiles.length} ${
                    mediaFiles.length === 1 ? 'image' : 'images'
                  }: ${submittedValue.trim()}`,
                )
              }}
              placeholder="Share an experiment, prompt, eval result, or hot take…"
              submitLabel="Post"
              value={postDraft}
            />
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-medium text-white">Reply box</p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Reuses the same highlighting, attachment previews, and character
            budget with a tighter footprint for thread replies.
          </p>
          <div className="mt-4">
            <PostComposer
              authorBadge={authorBadge}
              authorHandle={authorHandle}
              authorName={authorName}
              label="Reply body"
              mediaFiles={replyMediaFiles}
              onChange={(nextValue) => {
                setReplyDraft(nextValue)
                setFeedbackMessage(null)
              }}
              onMediaFilesChange={(nextFiles) => {
                setReplyMediaFiles(nextFiles)
                setFeedbackMessage(null)
              }}
              onSubmit={({ mediaFiles, value: submittedValue }) => {
                setReplyDraft('')
                setReplyMediaFiles([])
                setFeedbackMessage(
                  `Local reply preview saved for ${replyTarget} with ${
                    mediaFiles.length
                  } ${mediaFiles.length === 1 ? 'image' : 'images'}: ${submittedValue.trim()}`,
                )
              }}
              placeholder={`Reply to ${replyTarget}…`}
              submitLabel="Reply"
              value={replyDraft}
              variant="reply"
            />
          </div>
        </div>
      </div>

      <UploadPipelinePreview />
    </section>
  )
}
