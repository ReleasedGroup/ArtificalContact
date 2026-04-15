export interface PublicPostMedia {
  id: string | null
  kind: string | null
  url: string | null
  thumbUrl: string | null
  width: number | null
  height: number | null
}

export interface PublicGitHubPostMetadata {
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

export interface PublicPost {
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
  media: PublicPostMedia[]
  counters: {
    likes: number
    dislikes: number
    emoji: number
    replies: number
  }
  visibility: string
  createdAt: string | null
  updatedAt: string | null
  github: PublicGitHubPostMetadata | null
}

interface ApiError {
  code: string
  message: string
  field?: string
}

interface PublicPostEnvelope {
  data: PublicPost | null
  errors: ApiError[]
}

export class PublicPostNotFoundError extends Error {
  constructor(message = 'No public post exists for the requested id.') {
    super(message)
    this.name = 'PublicPostNotFoundError'
  }
}

function readErrorMessage(payload: PublicPostEnvelope | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getPublicPost(
  postId: string,
  signal?: AbortSignal,
): Promise<PublicPost> {
  const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  let payload: PublicPostEnvelope | null = null

  try {
    payload = (await response.json()) as PublicPostEnvelope
  } catch {
    payload = null
  }

  if (response.status === 404) {
    throw new PublicPostNotFoundError(readErrorMessage(payload) ?? undefined)
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Public post lookup failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('Public post response did not contain a post payload.')
  }

  return payload.data
}
