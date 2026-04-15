import { startTransition, useEffect, useState, type ReactNode } from 'react'
import type { MeProfile } from '../lib/me'
import { getOptionalMe } from '../lib/me'
import { createReply, deletePost } from '../lib/post-write'
import {
  PostComposer,
  type PostComposerMediaFile,
  type PostComposerSubmission,
} from './PostComposer'
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

type ReplyState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

type DeleteState =
  | { status: 'idle' }
  | { status: 'deleting'; postId: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

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
  authorId: string | null
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

interface ThreadConversationEntry {
  post: ThreadPost
  actualDepth: number
  visualDepth: number
  isFlattened: boolean
}

const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const maxVisibleThreadDepth = 3

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

function buildInitialBadge(source: string | null | undefined, fallback: string): string {
  const resolvedSource = source?.trim() || fallback
  const words = resolvedSource.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return resolvedSource.slice(0, 2).toUpperCase()
}

function buildAuthorMonogram(post: RenderablePost): string {
  return buildInitialBadge(
    post.authorDisplayName?.trim() || post.authorHandle?.trim(),
    'AI',
  )
}

function buildViewerBadge(viewer: MeProfile): string {
  return buildInitialBadge(viewer.displayName.trim() || viewer.handle?.trim(), 'ME')
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

function buildThreadConversationEntries(
  posts: ThreadPost[],
  threadId: string,
): ThreadConversationEntry[] {
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const childPosts = new Map<string, ThreadPost[]>()

  for (const post of posts) {
    if (post.parentId === null) {
      continue
    }

    const siblings = childPosts.get(post.parentId) ?? []
    siblings.push(post)
    childPosts.set(post.parentId, siblings)
  }

  for (const siblings of childPosts.values()) {
    siblings.sort(compareThreadPosts)
  }

  const sortedPosts = [...posts].sort(compareThreadPosts)
  const rootCandidates = sortedPosts.filter((post) => {
    if (post.parentId === null) {
      return true
    }

    return !postsById.has(post.parentId)
  })
  const orderedRoots = [
    ...rootCandidates.filter((post) => post.id === threadId),
    ...rootCandidates.filter((post) => post.id !== threadId),
  ]
  const visited = new Set<string>()
  const entries: ThreadConversationEntry[] = []

  const visit = (post: ThreadPost, depth: number) => {
    if (visited.has(post.id)) {
      return
    }

    visited.add(post.id)
    entries.push({
      post,
      actualDepth: depth,
      visualDepth: Math.min(depth, maxVisibleThreadDepth),
      isFlattened: depth > maxVisibleThreadDepth,
    })

    for (const child of childPosts.get(post.id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const post of orderedRoots) {
    visit(post, 0)
  }

  for (const post of sortedPosts) {
    visit(post, 0)
  }

  return entries
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
    <div data-post-media-gallery="" className="mt-4 grid gap-3 sm:grid-cols-2">
      {media.map((item, index) => {
        const key = item.id ?? `${item.kind ?? 'media'}-${index}`
        const kind = item.kind?.trim().toLowerCase() || 'attachment'
        const mediaUrl = item.url ?? null
        const previewUrl = item.thumbUrl ?? mediaUrl
        const openHref = mediaUrl ?? item.thumbUrl ?? null
        const isVisual = previewUrl !== null && /^(gif|image)$/i.test(kind)
        const isVideo = mediaUrl !== null && kind === 'video'
        const isAudio = mediaUrl !== null && kind === 'audio'

        return (
          <article
            key={key}
            data-post-media-kind={kind}
            className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/60 transition hover:border-white/20 hover:bg-slate-950/80"
          >
            {isVisual ? (
              <img
                src={previewUrl ?? undefined}
                alt={`${kind} attachment from ${authorName}`}
                className="h-40 w-full object-cover"
              />
            ) : isVideo ? (
              <video
                aria-label={`${kind} attachment from ${authorName}`}
                className="h-40 w-full bg-slate-950 object-cover"
                controls
                playsInline
                poster={item.thumbUrl ?? undefined}
                preload="metadata"
                src={mediaUrl}
              />
            ) : isAudio ? (
              <div className="flex min-h-40 flex-col justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.9))] px-4 py-5">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
                  Audio attachment
                </p>
                <audio
                  aria-label={`${kind} attachment from ${authorName}`}
                  className="mt-4 w-full"
                  controls
                  preload="metadata"
                  src={mediaUrl}
                />
              </div>
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
              {openHref ? (
                <a
                  href={openHref}
                  className="text-cyan-100 transition hover:text-cyan-50"
                >
                  Open media
                </a>
              ) : (
                <span>Preview unavailable</span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function PostCard({
  actionSlot,
  contextLabel,
  emphasis = 'context',
  post,
  showOpenLink = true,
}: {
  actionSlot?: ReactNode
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
            {actionSlot}
          </div>
        </div>
      </div>
    </article>
  )
}

function ThreadConversationSection({
  entries,
  getActionSlot,
  postsById,
  selectedPostId,
}: {
  entries: ThreadConversationEntry[]
  getActionSlot?: (post: RenderablePost) => ReactNode
  postsById: Map<string, ThreadPost>
  selectedPostId: string
}) {
  if (entries.length === 0) {
    return null
  }

  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/65 p-6">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            Thread conversation
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Root post plus nested replies. Indentation caps after level{' '}
            {maxVisibleThreadDepth} so deep branches stay readable.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
          {entries.length} item{entries.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {entries.map((entry) => {
          const contextLabel = getReplyContextLabel(entry.post, postsById)
          const indentRem = entry.visualDepth * 1.25

          return (
            <div
              key={entry.post.id}
              data-thread-entry=""
              data-thread-depth={entry.actualDepth}
              data-thread-visual-depth={entry.visualDepth}
              style={indentRem > 0 ? { marginLeft: `${indentRem}rem` } : undefined}
              className={
                entry.visualDepth > 0
                  ? 'border-l border-white/8 pl-4'
                  : undefined
              }
            >
              {entry.isFlattened && contextLabel && (
                <p className="mb-2 pl-1 text-xs font-medium tracking-[0.12em] text-slate-400">
                  {contextLabel}
                </p>
              )}
              <PostCard
                actionSlot={getActionSlot?.({
                  ...entry.post,
                  github: toRenderableGitHubMetadata(entry.post.github),
                })}
                contextLabel={entry.isFlattened ? null : contextLabel}
                emphasis={
                  entry.post.id === selectedPostId ? 'selected' : 'context'
                }
                post={{
                  ...entry.post,
                  github: toRenderableGitHubMetadata(entry.post.github),
                }}
                showOpenLink={entry.post.id !== selectedPostId}
              />
            </div>
          )
        })}
      </div>
    </article>
  )
}

function ReadyPostDetail({
  data,
  deleteState,
  getActionSlot,
  replyDraft,
  replyMediaFiles,
  replyState,
  viewer,
  onReplyDraftChange,
  onReplyMediaFilesChange,
  onReplySubmit,
}: {
  data: PostDetailData
  deleteState: DeleteState
  getActionSlot: (post: RenderablePost) => ReactNode
  replyDraft: string
  replyMediaFiles: PostComposerMediaFile[]
  replyState: ReplyState
  viewer: MeProfile | null
  onReplyDraftChange: (nextValue: string) => void
  onReplyMediaFilesChange: (nextFiles: PostComposerMediaFile[]) => void
  onReplySubmit: (submission: PostComposerSubmission) => void
}) {
  const orderedPosts = [...data.thread.posts].sort(compareThreadPosts)
  const postsById = new Map(orderedPosts.map((post) => [post.id, post]))
  const threadEntries = buildThreadConversationEntries(
    orderedPosts,
    data.thread.threadId,
  )
  const selectedIndex = threadEntries.findIndex(
    (entry) => entry.post.id === data.post.id,
  )
  const selectedInThread = selectedIndex >= 0
  const selectedThreadEntry =
    selectedIndex >= 0 ? threadEntries[selectedIndex] : null
  const rootPost =
    orderedPosts.find(
      (post) => post.id === data.thread.threadId && post.parentId === null,
    ) ?? null
  const selectedContextLabel = getReplyContextLabel(data.post, postsById)
  const authorHandle = getAuthorHandle(data.post)
  const totalReplies = Math.max(orderedPosts.length - 1, 0)
  const selectedDepth = selectedThreadEntry?.actualDepth ?? null
  const selectedVisualDepth = selectedThreadEntry?.visualDepth ?? null
  const selectedFlattened = selectedThreadEntry?.isFlattened ?? false
  const selectedStandaloneRoot =
    !selectedInThread && data.post.id === data.post.threadId && data.post.parentId === null
  const canReply = viewer?.status === 'active' && Boolean(viewer.handle)
  const replyTargetLabel = authorHandle ? `@${authorHandle}` : 'this thread'

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
          {viewer && (
            <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-4">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-emerald-100/80">
                    Join this thread
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Publish a reply to the currently selected post and refresh
                    the public thread view in place. Attached image previews
                    stay local until the reply upload path is available.
                  </p>
                </div>

                {replyState.status === 'success' && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                    {replyState.message}
                  </span>
                )}

                {replyState.status === 'error' && (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100">
                    {replyState.message}
                  </span>
                )}

                {deleteState.status === 'success' && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                    {deleteState.message}
                  </span>
                )}

                {deleteState.status === 'error' && (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100">
                    {deleteState.message}
                  </span>
                )}
              </div>

              {!canReply && (
                <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  Activate this profile with a public handle before replying.
                </div>
              )}

              <div className="mt-5">
                <PostComposer
                  authorBadge={buildViewerBadge(viewer)}
                  authorHandle={viewer.handle}
                  authorName={viewer.displayName}
                  disabled={!canReply || deleteState.status === 'deleting'}
                  label="Thread reply body"
                  mediaFiles={replyMediaFiles}
                  onChange={onReplyDraftChange}
                  onMediaFilesChange={onReplyMediaFilesChange}
                  onSubmit={onReplySubmit}
                  placeholder={`Reply to ${replyTargetLabel}…`}
                  submitLabel="Reply in thread"
                  submitting={replyState.status === 'submitting'}
                  value={replyDraft}
                  variant="reply"
                />
              </div>
            </article>
          )}

          {!selectedInThread && (
            <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-6">
              <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-200/75">
                    Selected post
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    The standalone payload loaded, but this item was not present
                    in the returned thread page.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                  {data.post.type}
                </span>
              </div>

              <div className="mt-5">
                <PostCard
                  actionSlot={getActionSlot({
                    ...data.post,
                    github: toRenderableGitHubMetadata(data.post.github),
                  })}
                  contextLabel={
                    selectedStandaloneRoot ? 'Root post in the thread' : selectedContextLabel
                  }
                  emphasis="selected"
                  post={{
                    ...data.post,
                    github: toRenderableGitHubMetadata(data.post.github),
                  }}
                  showOpenLink={false}
                />
              </div>
            </article>
          )}

          <ThreadConversationSection
            entries={threadEntries}
            getActionSlot={getActionSlot}
            postsById={postsById}
            selectedPostId={data.post.id}
          />

          {threadEntries.length === 0 && !selectedInThread && (
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
                matching thread to provide conversation context.
              </p>
              {selectedDepth !== null && (
                <p>
                  Selected thread depth: {selectedDepth}
                  {selectedVisualDepth !== null &&
                    selectedVisualDepth !== selectedDepth &&
                    ` (rendered at level ${selectedVisualDepth})`}
                  {selectedFlattened && ' with flattened indentation'}
                </p>
              )}
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
  const [viewer, setViewer] = useState<MeProfile | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyMediaFiles, setReplyMediaFiles] = useState<
    PostComposerMediaFile[]
  >([])
  const [replyState, setReplyState] = useState<ReplyState>({
    status: 'idle',
  })
  const [deleteState, setDeleteState] = useState<DeleteState>({
    status: 'idle',
  })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    const loadViewer = async () => {
      try {
        const data = await getOptionalMe(controller.signal)
        if (controller.signal.aborted) {
          return
        }

        startTransition(() => {
          setViewer(data?.user ?? null)
        })
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return
        }

        console.error('Unable to load the authenticated viewer context.', error)
      }
    }

    void loadViewer()

    return () => {
      controller.abort()
    }
  }, [postId])

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
  }, [postId, refreshToken])

  const handleReplySubmit = async ({ value }: PostComposerSubmission) => {
    if (postState.status !== 'ready' || viewer?.status !== 'active' || !viewer.handle) {
      return
    }

    setReplyState({ status: 'submitting' })
    setDeleteState({ status: 'idle' })

    try {
      await createReply(postState.data.post.id, {
        text: value.trim(),
      })

      setReplyDraft('')
      setReplyMediaFiles([])
      setReplyState({
        status: 'success',
        message: 'Reply published and thread refreshed.',
      })
      setRefreshToken((current) => current + 1)
    } catch (error) {
      setReplyState({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to publish the reply.',
      })
    }
  }

  const handleDeletePost = async (targetPost: RenderablePost) => {
    setDeleteState({
      status: 'deleting',
      postId: targetPost.id,
    })
    setReplyState({ status: 'idle' })

    try {
      await deletePost(targetPost.id)

      setDeleteState({
        status: 'success',
        message: `${targetPost.type === 'reply' ? 'Reply' : 'Post'} removed from the public thread view.`,
      })
      setRefreshToken((current) => current + 1)
    } catch (error) {
      setDeleteState({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to delete the post.',
      })
    }
  }

  const getActionSlot = (post: RenderablePost) => {
    if (viewer?.id !== post.authorId) {
      return null
    }

    const isDeleting =
      deleteState.status === 'deleting' && deleteState.postId === post.id

    return (
      <button
        type="button"
        onClick={() => {
          void handleDeletePost(post)
        }}
        className="rounded-full border border-rose-300/20 bg-rose-300/10 px-4 py-2 text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
        disabled={replyState.status === 'submitting' || deleteState.status === 'deleting'}
      >
        {isDeleting
          ? `Deleting ${post.type}...`
          : `Delete ${post.type}`}
      </button>
    )
  }

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
            <ReadyPostDetail
              data={postState.data}
              deleteState={deleteState}
              getActionSlot={getActionSlot}
              replyDraft={replyDraft}
              replyMediaFiles={replyMediaFiles}
              replyState={replyState}
              viewer={viewer}
              onReplyDraftChange={(nextValue) => {
                setReplyDraft(nextValue)
                if (replyState.status !== 'submitting') {
                  setReplyState({ status: 'idle' })
                }
                if (deleteState.status !== 'deleting') {
                  setDeleteState({ status: 'idle' })
                }
              }}
              onReplyMediaFilesChange={(nextFiles) => {
                setReplyMediaFiles(nextFiles)
                if (replyState.status !== 'submitting') {
                  setReplyState({ status: 'idle' })
                }
                if (deleteState.status !== 'deleting') {
                  setDeleteState({ status: 'idle' })
                }
              }}
              onReplySubmit={(submission) => {
                void handleReplySubmit(submission)
              }}
            />
          ) : (
            <PostDetailStatusCard postId={postId} state={postState} />
          )}
        </div>
      </section>
    </main>
  )
}
