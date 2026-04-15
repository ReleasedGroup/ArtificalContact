import { startTransition, useEffect, useState } from 'react'
import { getComposerSegments } from '../lib/composer'
import {
  getPublicPost,
  PublicPostNotFoundError,
  type PublicGitHubPostMetadata,
  type PublicPost,
  type PublicPostMedia,
} from '../lib/public-post'
import {
  getThread,
  ThreadNotFoundError,
  type ThreadGitHubPost,
  type ThreadPage,
  type ThreadPost,
  type ThreadPostMedia,
} from '../lib/thread'

type PostDetailState =
  | { status: 'loading' }
  | { status: 'ready'; data: PostDetailData }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }

type PostDetailStatusState = Exclude<
  PostDetailState,
  { status: 'ready'; data: PostDetailData }
>

interface PostDetailData {
  post: PublicPost
  thread: ThreadPage
}

interface RenderableGitHubMetadata {
  owner: string | null
  name: string | null
  eventType: string | null
  number: number | null
  tag: string | null
  state: string | null
  url: string | null
  labels: string[]
}

interface RenderablePost {
  id: string
  type: 'post' | 'reply'
  kind: 'user' | 'github'
  threadId: string
  parentId: string | null
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  text: string | null
  media: Array<PublicPostMedia | ThreadPostMedia>
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  createdAt: string | null
  updatedAt: string | null
  github?: RenderableGitHubMetadata | null
}

const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const githubEventLabels: Record<string, string> = {
  issue: 'Issue',
  pull_request: 'Pull request',
  release: 'Release',
}

const githubStateClassNames: Record<string, string> = {
  open: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
  closed: 'border-rose-300/20 bg-rose-300/10 text-rose-100',
  merged: 'border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100',
  published: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  'pre-release': 'border-amber-300/20 bg-amber-300/10 text-amber-100',
}

function getPostRouteHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`
}

function getPublicProfileHref(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`
}

function toRenderableGitHubMetadata(
  github: PublicGitHubPostMetadata | ThreadGitHubPost | null | undefined,
): RenderableGitHubMetadata | null {
  if (github === null || github === undefined) {
    return null
  }

  return {
    owner: github.owner,
    name: github.name,
    eventType: github.eventType,
    number: github.number,
    tag: github.tag,
    state: github.state,
    url: github.url,
    labels: github.labels,
  }
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function compareThreadPosts(left: ThreadPost, right: ThreadPost): number {
  const leftIsRoot = left.id === left.threadId && left.parentId === null
  const rightIsRoot = right.id === right.threadId && right.parentId === null

  if (leftIsRoot !== rightIsRoot) {
    return leftIsRoot ? -1 : 1
  }

  const leftTimestamp = parseTimestamp(left.createdAt)
  const rightTimestamp = parseTimestamp(right.createdAt)

  if (
    leftTimestamp !== null &&
    rightTimestamp !== null &&
    leftTimestamp !== rightTimestamp
  ) {
    return leftTimestamp - rightTimestamp
  }

  if (leftTimestamp !== null && rightTimestamp === null) {
    return -1
  }

  if (leftTimestamp === null && rightTimestamp !== null) {
    return 1
  }

  return left.id.localeCompare(right.id)
}

function formatCount(value: number): string {
  return value >= 1000 ? compactCountFormatter.format(value) : String(value)
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function buildAuthorMonogram(post: RenderablePost): string {
  const source =
    post.authorDisplayName?.trim() || post.authorHandle?.trim() || 'AI'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function getAuthorName(post: RenderablePost): string {
  return (
    post.authorDisplayName?.trim() ||
    post.authorHandle?.trim() ||
    'Unknown author'
  )
}

function getAuthorHandle(post: RenderablePost): string | null {
  return post.authorHandle?.trim() || null
}

function getReplyContextLabel(
  post: RenderablePost,
  postsById: Map<string, ThreadPost>,
): string | null {
  if (post.parentId === null) {
    return 'Root post in the public thread.'
  }

  const parent = postsById.get(post.parentId)
  const parentHandle = parent?.authorHandle?.trim()
  const parentName = parent?.authorDisplayName?.trim()

  if (parentHandle) {
    return `Replying to @${parentHandle}`
  }

  if (parentName) {
    return `Replying to ${parentName}`
  }

  return 'Reply in this thread'
}

function renderPostText(text: string | null) {
  if (!text) {
    return (
      <p className="mt-4 text-sm leading-7 text-slate-400">
        No public body text is available for this post.
      </p>
    )
  }

  const segments = getComposerSegments(text)

  if (segments.length === 0) {
    return (
      <p className="mt-4 text-sm leading-7 whitespace-pre-wrap text-slate-100 sm:text-[15px]">
        {text}
      </p>
    )
  }

  return (
    <p className="mt-4 text-sm leading-7 whitespace-pre-wrap text-slate-100 sm:text-[15px]">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <span key={`${segment.kind}-${index}`}>{segment.text}</span>
        }

        const className =
          segment.kind === 'hashtag'
            ? 'rounded bg-sky-300/12 px-1 text-sky-100 ring-1 ring-inset ring-sky-300/25'
            : 'rounded bg-fuchsia-300/12 px-1 text-fuchsia-100 ring-1 ring-inset ring-fuchsia-300/25'

        return (
          <mark key={`${segment.kind}-${index}`} className={className}>
            {segment.text}
          </mark>
        )
      })}
    </p>
  )
}

function PostMediaGallery({
  authorName,
  media,
}: {
  authorName: string
  media: Array<PublicPostMedia | ThreadPostMedia>
}) {
  if (media.length === 0) {
    return null
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {media.map((item, index) => {
        const key = item.id ?? `${item.kind ?? 'media'}-${index}`
        const href = item.url ?? item.thumbUrl ?? '#'
        const kind = item.kind?.toLowerCase() ?? 'attachment'
        const previewUrl = item.thumbUrl ?? item.url
        const isVisual = previewUrl !== null && /^(gif|image)$/i.test(kind)

        return (
          <a
            key={key}
            href={href}
            className="group overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/60 transition hover:border-white/20 hover:bg-slate-950/80"
          >
            {isVisual ? (
              <img
                src={previewUrl ?? undefined}
                alt={`${kind} attachment from ${authorName}`}
                className="h-40 w-full object-cover transition duration-200 group-hover:scale-[1.01]"
              />
            ) : (
              <div className="flex h-40 items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.9))] px-4 text-center">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
                    Attachment
                  </p>
                  <p className="mt-3 text-lg font-semibold text-white">
                    {kind}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-slate-400">
              <span className="uppercase tracking-[0.18em]">{kind}</span>
              <span>Open media</span>
            </div>
          </a>
        )
      })}
    </div>
  )
}

function PostCard({
  contextLabel,
  emphasis = 'context',
  post,
  showOpenLink = true,
}: {
  contextLabel?: string | null
  emphasis?: 'selected' | 'context'
  post: RenderablePost
  showOpenLink?: boolean
}) {
  const authorName = getAuthorName(post)
  const authorHandle = getAuthorHandle(post)
  const timestamp = formatTimestamp(post.createdAt ?? post.updatedAt)
  const github = post.github ?? null
  const githubLabel = github?.eventType
    ? (githubEventLabels[github.eventType] ?? github.eventType)
    : null
  const githubRef =
    github?.tag?.trim() ||
    (typeof github?.number === 'number' ? `#${github.number}` : null)
  const cardClassName =
    emphasis === 'selected'
      ? 'border-cyan-300/25 bg-slate-900/82 shadow-xl shadow-cyan-950/20'
      : 'border-white/10 bg-slate-900/62'

  return (
    <article className={`rounded-[1.6rem] border p-5 ${cardClassName}`}>
      <div className="flex gap-4">
        {post.authorAvatarUrl ? (
          <img
            src={post.authorAvatarUrl}
            alt={`${authorName} avatar`}
            className="h-12 w-12 rounded-2xl border border-white/10 bg-slate-900 object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(45,212,191,0.34),rgba(59,130,246,0.28),rgba(249,115,22,0.3))] text-sm font-semibold tracking-[0.12em] text-white">
            {buildAuthorMonogram(post)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-white">{authorName}</span>
                {authorHandle && (
                  <span className="text-slate-500">@{authorHandle}</span>
                )}
              </div>

              {contextLabel && (
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                  {contextLabel}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium uppercase tracking-[0.18em]">
              <span
                className={`rounded-full border px-3 py-1 ${
                  emphasis === 'selected'
                    ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                {emphasis === 'selected' ? 'Selected post' : post.type}
              </span>
              {post.kind === 'github' && (
                <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-fuchsia-100">
                  GitHub sync
                </span>
              )}
              {github?.state && (
                <span
                  className={`rounded-full border px-3 py-1 ${
                    githubStateClassNames[github.state] ??
                    'border-white/10 bg-white/5 text-slate-300'
                  }`}
                >
                  {github.state}
                </span>
              )}
            </div>
          </div>

          {github && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {githubLabel && (
                <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 font-medium uppercase tracking-[0.18em] text-fuchsia-100">
                  {githubLabel}
                </span>
              )}
              {(github.owner || github.name || githubRef) && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                  {[github.owner, github.name].filter(Boolean).join('/')}
                  {githubRef ? ` ${githubRef}` : ''}
                </span>
              )}
              {github.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-slate-400"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {renderPostText(post.text)}
          <PostMediaGallery authorName={authorName} media={post.media} />

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {formatCount(post.counters.replies)} replies
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {formatCount(post.counters.likes)} likes
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {formatCount(post.counters.dislikes)} dislikes
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {formatCount(post.counters.emoji)} emoji
            </span>
            {timestamp && <span className="ml-auto">{timestamp}</span>}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {showOpenLink && (
              <a
                href={getPostRouteHref(post.id)}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
              >
                Open standalone page
              </a>
            )}
            {authorHandle && (
              <a
                href={getPublicProfileHref(authorHandle)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-200 transition hover:border-white/20 hover:bg-white/10"
              >
                Author profile
              </a>
            )}
            {github?.url && (
              <a
                href={github.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-4 py-2 text-fuchsia-100 transition hover:border-fuchsia-300/35 hover:bg-fuchsia-300/15"
              >
                View on GitHub
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function ThreadContextSection({
  posts,
  postsById,
  title,
}: {
  posts: ThreadPost[]
  postsById: Map<string, ThreadPost>
  title: string
}) {
  if (posts.length === 0) {
    return null
  }

  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/65 p-6">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            {title}
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Public posts from the same thread, ordered chronologically.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
          {posts.length} item{posts.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            contextLabel={getReplyContextLabel(post, postsById)}
            post={{
              ...post,
              github: toRenderableGitHubMetadata(post.github),
            }}
          />
        ))}
      </div>
    </article>
  )
}

function ReadyPostDetail({ data }: { data: PostDetailData }) {
  const orderedPosts = [...data.thread.posts].sort(compareThreadPosts)
  const postsById = new Map(orderedPosts.map((post) => [post.id, post]))
  const selectedIndex = orderedPosts.findIndex(
    (post) => post.id === data.post.id,
  )
  const earlierPosts =
    selectedIndex > 0 ? orderedPosts.slice(0, selectedIndex) : []
  const laterPosts =
    selectedIndex >= 0 ? orderedPosts.slice(selectedIndex + 1) : []
  const threadContextPosts =
    selectedIndex === -1
      ? orderedPosts.filter((post) => post.id !== data.post.id)
      : []
  const rootPost =
    orderedPosts.find(
      (post) => post.id === data.thread.threadId && post.parentId === null,
    ) ?? null
  const selectedContextLabel = getReplyContextLabel(data.post, postsById)
  const authorHandle = getAuthorHandle(data.post)
  const totalReplies = Math.max(orderedPosts.length - 1, 0)

  return (
    <div className="py-6 sm:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-medium text-cyan-100">
              Post detail
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
              Thread {data.thread.threadId}
            </span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Standalone post detail
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              Focus on one public post while keeping the rest of its thread in
              reach.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-medium text-white transition hover:border-white/20 hover:bg-white/10"
          >
            Back to sign-in
          </a>
          {rootPost && rootPost.id !== data.post.id && (
            <a
              href={getPostRouteHref(rootPost.id)}
              className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 font-medium text-emerald-100 transition hover:border-emerald-300/35 hover:bg-emerald-300/15"
            >
              Open thread root
            </a>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]">
        <section className="space-y-6">
          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-6">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-200/75">
                  Selected post
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  The canonical public payload from{' '}
                  <code>/api/posts/{'{id}'}</code>.
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                {data.post.type}
              </span>
            </div>

            <div className="mt-5">
              <PostCard
                emphasis="selected"
                contextLabel={selectedContextLabel}
                post={{
                  ...data.post,
                  github: toRenderableGitHubMetadata(data.post.github),
                }}
                showOpenLink={false}
              />
            </div>
          </article>

          <ThreadContextSection
            posts={earlierPosts}
            postsById={postsById}
            title="Earlier in thread"
          />
          <ThreadContextSection
            posts={threadContextPosts}
            postsById={postsById}
            title="Thread context"
          />
          <ThreadContextSection
            posts={laterPosts}
            postsById={postsById}
            title="Later in thread"
          />

          {earlierPosts.length === 0 &&
            laterPosts.length === 0 &&
            threadContextPosts.length === 0 && (
              <article className="rounded-[1.75rem] border border-dashed border-white/12 bg-slate-950/35 p-6">
                <h2 className="text-xl font-semibold text-white">
                  This post currently stands alone.
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  No additional public posts were returned for this thread, so
                  the detail page only needs to render the selected post.
                </p>
              </article>
            )}
        </section>

        <aside className="space-y-6">
          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
              Thread summary
            </p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Posts loaded
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {orderedPosts.length}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Replies in thread
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {totalReplies}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Selected position
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {selectedIndex >= 0 ? selectedIndex + 1 : 'N/A'}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm leading-7 text-slate-300">
              <p>
                This page resolves the standalone post first, then loads the
                matching thread to provide surrounding context.
              </p>
              {data.thread.continuationToken && (
                <p className="text-slate-400">
                  The thread payload is paginated. Additional context exists
                  beyond the first page.
                </p>
              )}
              {authorHandle && (
                <p>
                  Author profile:{' '}
                  <a
                    href={getPublicProfileHref(authorHandle)}
                    className="text-cyan-100 hover:text-cyan-50"
                  >
                    @{authorHandle}
                  </a>
                </p>
              )}
            </div>
          </article>

          {rootPost && rootPost.id !== data.post.id && (
            <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-emerald-100/80">
                Conversation entry point
              </p>
              <div className="mt-5">
                <PostCard
                  contextLabel="Root post in the thread"
                  post={{
                    ...rootPost,
                    github: toRenderableGitHubMetadata(rootPost.github),
                  }}
                />
              </div>
            </article>
          )}
        </aside>
      </div>
    </div>
  )
}

function PostDetailStatusCard({
  postId,
  state,
}: {
  postId: string
  state: PostDetailStatusState
}) {
  return (
    <div className="py-8 sm:py-10">
      <article className="mx-auto max-w-3xl rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-6 shadow-lg shadow-slate-950/30 sm:p-8">
        <div className="space-y-4">
          <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200">
            /p/{postId}
          </span>

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {state.status === 'loading' && 'Loading post detail'}
              {state.status === 'not-found' && 'Post not found'}
              {state.status === 'error' && 'Unable to load post detail'}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300">
              {state.status === 'loading' &&
                'Fetching the standalone post and its thread context from the linked Functions API.'}
              {state.status === 'not-found' && state.message}
              {state.status === 'error' && state.message}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="/"
              className="rounded-2xl bg-cyan-300/12 px-4 py-2.5 text-sm font-medium text-cyan-100 ring-1 ring-cyan-300/25 hover:bg-cyan-300/18"
            >
              Back to sign-in
            </a>
            {state.status !== 'loading' && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}

export function PostDetailScreen({ postId }: { postId: string }) {
  const [postState, setPostState] = useState<PostDetailState>({
    status: 'loading',
  })

  useEffect(() => {
    startTransition(() => {
      setPostState({ status: 'loading' })
    })

    const controller = new AbortController()

    const loadPostDetail = async () => {
      try {
        const post = await getPublicPost(postId, controller.signal)
        const thread = await getThread(post.threadId, controller.signal)

        startTransition(() => {
          setPostState({
            status: 'ready',
            data: {
              post,
              thread,
            },
          })
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        startTransition(() => {
          if (error instanceof PublicPostNotFoundError) {
            setPostState({
              status: 'not-found',
              message: error.message,
            })
            return
          }

          if (error instanceof ThreadNotFoundError) {
            setPostState({
              status: 'error',
              message:
                'The post loaded, but the surrounding thread context is unavailable right now.',
            })
            return
          }

          setPostState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load the post detail view.',
          })
        })
      }
    }

    void loadPostDetail()

    return () => {
      controller.abort()
    }
  }, [postId])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/90 shadow-2xl shadow-slate-950/35 backdrop-blur">
        <div className="relative h-44 overflow-hidden sm:h-52">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(232,121,249,0.18),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.88))]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.15),rgba(2,6,23,0.7))]" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-200">
              <a
                href="/"
                className="rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 font-medium hover:bg-slate-900/75"
              >
                ArtificialContact
              </a>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-medium text-cyan-100">
                Post detail
              </span>
            </div>
            <span className="rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-200">
              {postState.status === 'loading' && 'Loading'}
              {postState.status === 'ready' && 'Live'}
              {postState.status === 'not-found' && 'Missing'}
              {postState.status === 'error' && 'Retry needed'}
            </span>
          </div>
        </div>

        <div className="relative px-5 pb-6 sm:px-6 sm:pb-8 lg:px-10">
          {postState.status === 'ready' ? (
            <ReadyPostDetail data={postState.data} />
          ) : (
            <PostDetailStatusCard postId={postId} state={postState} />
          )}
        </div>
      </section>
    </main>
  )
}
