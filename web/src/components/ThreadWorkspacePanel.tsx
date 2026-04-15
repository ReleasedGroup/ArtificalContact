import { useState } from 'react'
import type { MeProfile } from '../lib/me'
import { createPost } from '../lib/post-write'
import { PostComposer } from './PostComposer'

interface ThreadWorkspacePanelProps {
  authorBadge: string
  authorHandle: string | null
  authorName: string
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
  user,
}: ThreadWorkspacePanelProps) {
  const [postDraft, setPostDraft] = useState(
    'Shipping a real thread workflow from /me so Playwright can exercise post, reply, and delete end to end.',
  )
  const [publishState, setPublishState] = useState<PublishState>({
    status: 'idle',
  })
  const [publishedPost, setPublishedPost] = useState<PublishedPost | null>(null)

  const canPublish = user.status === 'active' && Boolean(user.handle)

  const handleSubmit = async (value: string) => {
    setPublishState({ status: 'publishing' })

    try {
      const response = await createPost({
        text: value.trim(),
      })

      setPublishedPost(response.post)
      setPostDraft('')
      setPublishState({
        status: 'success',
        message: `Post published to /p/${response.post.id}.`,
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
    <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            Thread workspace
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            This panel uses the real post mutation endpoints so the standalone
            thread page can be exercised with actual create, reply, and delete
            flows.
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-medium text-white">Publish root post</p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            The created post stays public at <code>/p/{'{id}'}</code>, where
            authenticated users can continue the thread with replies.
          </p>
          <div className="mt-4">
            <PostComposer
              authorBadge={authorBadge}
              authorHandle={authorHandle}
              authorName={authorName}
              disabled={!canPublish}
              label="Thread post body"
              onChange={(nextValue) => {
                setPostDraft(nextValue)
                if (publishState.status !== 'publishing') {
                  setPublishState({ status: 'idle' })
                }
              }}
              onSubmit={handleSubmit}
              placeholder="Publish a root post for the thread workflow…"
              submitLabel="Publish post"
              submitting={publishState.status === 'publishing'}
              value={postDraft}
            />
          </div>
        </div>

        <aside className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-medium text-white">Latest published post</p>
          {publishedPost ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[1.35rem] border border-white/10 bg-slate-900/80 p-4">
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
              Publish a post here, then open its standalone page to validate
              replies and delete behavior.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
