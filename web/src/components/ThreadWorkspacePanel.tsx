import { useState } from 'react'
import type { MeProfile } from '../lib/me'
import { createPost } from '../lib/post-write'
import type { GifSearchResult } from '../lib/gif-search'
import { AppImage } from './AppImage'
import {
  PostComposer,
  type PostComposerMediaFile,
  type PostComposerSubmission,
} from './PostComposer'
import { PostGifPicker } from './PostGifPicker'

interface ThreadWorkspacePanelProps {
  authorBadge: string
  authorHandle: string | null
  authorName: string
  mode?: 'profile' | 'home'
  onPublished?: (post: PublishedPost) => Promise<void> | void
  user: MeProfile
}

type PublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

type PublishedPost = Awaited<ReturnType<typeof createPost>>['post']

function getPostRouteHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`
}

export function ThreadWorkspacePanel({
  authorBadge,
  authorHandle,
  authorName,
  mode = 'profile',
  onPublished,
  user,
}: ThreadWorkspacePanelProps) {
  const [postDraft, setPostDraft] = useState('')
  const [postMediaFiles, setPostMediaFiles] = useState<PostComposerMediaFile[]>(
    [],
  )
  const [selectedGif, setSelectedGif] = useState<GifSearchResult | null>(null)
  const [publishState, setPublishState] = useState<PublishState>({
    status: 'idle',
  })
  const [publishedPost, setPublishedPost] = useState<PublishedPost | null>(null)

  const canPublish = user.status === 'active' && Boolean(user.handle)
  const isHomeMode = mode === 'home'

  const handleSubmit = async ({ mediaFiles, value }: PostComposerSubmission) => {
    setPublishState({ status: 'publishing' })

    try {
      const response = await createPost({
        text: value,
        mediaFiles,
        ...(selectedGif === null
          ? {}
          : {
              media: [
                {
                  id: selectedGif.id,
                  kind: 'gif' as const,
                  url: selectedGif.gifUrl,
                  thumbUrl: selectedGif.previewUrl,
                  width: selectedGif.width,
                  height: selectedGif.height,
                },
              ],
            }),
      })

      setPublishedPost(response.post)
      setPostDraft('')
      setPostMediaFiles([])
      setSelectedGif(null)
      await onPublished?.(response.post)
      setPublishState({
        status: 'success',
        message: isHomeMode
          ? 'Post published. Your home feed is refreshing.'
          : `Post published to /p/${response.post.id}.`,
      })
    } catch (error) {
      setPublishState({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to publish the post.',
      })
    }
  }

  return (
    <section
      data-testid="thread-workspace"
      className={`${isHomeMode ? 'mb-5' : 'mt-5'} rounded-[1.4rem] border border-white/8 bg-white/[0.04] p-5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            {isHomeMode ? 'Create post' : 'Thread workspace'}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            {isHomeMode
              ? 'Share something with the people who follow you.'
              : 'Compose and publish a new post.'}
          </p>
        </div>

        {publishState.status === 'success' && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
            {publishState.message}
          </span>
        )}

        {publishState.status === 'error' && (
          <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100">
            {publishState.message}
          </span>
        )}
      </div>

      {!canPublish && (
        <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Activate this profile with a public handle before publishing posts.
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.2rem] border border-white/8 bg-slate-950/35 p-4">
          <p className="text-sm font-medium text-white">
            {isHomeMode ? 'Publish post' : 'Publish root post'}
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            {isHomeMode
              ? 'Your post will appear in your feed and on its own page.'
              : 'Your post will be published and available for replies.'}
          </p>
          <div className="mt-4">
            <PostComposer
              authorBadge={authorBadge}
              authorHandle={authorHandle}
              authorName={authorName}
              disabled={!canPublish}
              hasExternalMedia={selectedGif !== null}
              label="Thread post body"
              mediaFiles={postMediaFiles}
              onChange={(nextValue) => {
                setPostDraft(nextValue)
                if (publishState.status !== 'publishing') {
                  setPublishState({ status: 'idle' })
                }
              }}
              onMediaFilesChange={(nextFiles) => {
                setPostMediaFiles(nextFiles)
                if (publishState.status !== 'publishing') {
                  setPublishState({ status: 'idle' })
                }
              }}
              onSubmit={handleSubmit}
              placeholder={
                isHomeMode
                  ? 'Share an update with the people who follow you…'
                  : 'Publish a root post for the thread workflow…'
              }
              submitLabel={isHomeMode ? 'Post to feed' : 'Publish post'}
              submitting={publishState.status === 'publishing'}
              value={postDraft}
            />

            {selectedGif && (
              <div className="mt-4 overflow-hidden rounded-[1rem] border border-white/8 bg-slate-900/65">
                <AppImage
                  alt={selectedGif.title ?? 'Selected post GIF'}
                  className="h-48 w-full object-cover"
                  src={selectedGif.previewUrl}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {selectedGif.title ?? 'Selected GIF'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {selectedGif.width && selectedGif.height
                        ? `${selectedGif.width} × ${selectedGif.height}`
                        : 'Ready to publish'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGif(null)
                      if (publishState.status !== 'publishing') {
                        setPublishState({ status: 'idle' })
                      }
                    }}
                    className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-400/20"
                    disabled={publishState.status === 'publishing'}
                  >
                    Remove GIF
                  </button>
                </div>
              </div>
            )}

            <PostGifPicker
              disabled={!canPublish || publishState.status === 'publishing'}
              onSelect={(gif) => {
                setSelectedGif(gif)
                if (publishState.status !== 'publishing') {
                  setPublishState({ status: 'idle' })
                }
              }}
            />
          </div>
        </div>

        <aside className="rounded-[1.2rem] border border-white/8 bg-slate-950/35 p-4">
          <p className="text-sm font-medium text-white">Latest published post</p>
          {publishedPost ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[1rem] border border-white/8 bg-slate-900/65 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Post id
                </p>
                <p className="mt-2 break-all text-sm text-slate-100">
                  {publishedPost.id}
                </p>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  {publishedPost.text ?? 'No public body text is available.'}
                </p>
              </div>
              <a
                href={getPostRouteHref(publishedPost.id)}
                className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
              >
                Open standalone page
              </a>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-7 text-slate-400">
              {isHomeMode
                ? 'Publish a post here to seed your home feed and jump into its standalone thread page.'
                : 'Publish a post here, then open its standalone page to validate replies and delete behavior.'}
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
