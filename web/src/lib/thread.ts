export interface ThreadPostMedia {
  id: string
  kind: string
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
}

export interface ThreadGitHubPost {
  repoId: string | null
  owner: string | null
  name: string | null
  eventType: string | null
  eventId: string | null
  number: number | null
  tag: string | null
  state: string | null
  actorLogin: string | null
  actorAvatarUrl: string | null
  url: string | null
  bodyExcerpt: string | null
  labels: string[]
  githubCreatedAt: string | null
  githubUpdatedAt: string | null
}

export interface ThreadPost {
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
  hashtags: string[]
  mentions: string[]
  media: ThreadPostMedia[]
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  createdAt: string | null
  updatedAt: string | null
  github?: ThreadGitHubPost
}

export interface ThreadPage {
  threadId: string
  posts: ThreadPost[]
  continuationToken: string | null
}

interface ApiError {
  code: string
  message: string
  field?: string
}

interface ThreadEnvelope {
  data: ThreadPage | null
  errors: ApiError[]
}

export class ThreadNotFoundError extends Error {
  constructor(
    message = 'No public thread exists for the requested thread id.',
  ) {
    super(message)
    this.name = 'ThreadNotFoundError'
  }
}

function readErrorMessage(payload: ThreadEnvelope | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getThread(
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadPage> {
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  let payload: ThreadEnvelope | null = null

  try {
    payload = (await response.json()) as ThreadEnvelope
  } catch {
    payload = null
  }

  if (response.status === 404) {
    throw new ThreadNotFoundError(readErrorMessage(payload) ?? undefined)
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Thread lookup failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('Thread response did not contain a thread payload.')
  }

  return payload.data
}
