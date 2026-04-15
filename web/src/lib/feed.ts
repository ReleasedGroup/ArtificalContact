interface ApiError {
  code: string
  message: string
  field?: string
}

interface FeedEnvelope {
  data: FeedEntry[] | null
  cursor?: string | null
  errors: ApiError[]
}

export interface FeedMedia {
  kind: string | null
  thumbUrl: string | null
}

export interface FeedEntry {
  id: string
  postId: string
  authorId: string | null
  authorHandle: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  excerpt: string | null
  media: FeedMedia[]
  counters: {
    likes: number
    replies: number
  }
  createdAt: string | null
}

export interface FeedPage {
  entries: FeedEntry[]
  cursor: string | null
}

function readErrorMessage(payload: FeedEnvelope | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getFeedPage(
  options: {
    cursor?: string | null
    signal?: AbortSignal
  } = {},
): Promise<FeedPage> {
  const requestUrl = new URL('/api/feed', window.location.origin)

  if (options.cursor) {
    requestUrl.searchParams.set('cursor', options.cursor)
  }

  const response = await fetch(requestUrl.pathname + requestUrl.search, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload: FeedEnvelope | null = null

  try {
    payload = (await response.json()) as FeedEnvelope
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Feed lookup failed with status ${response.status}.`,
    )
  }

  if (!Array.isArray(payload?.data)) {
    throw new Error('Feed response did not contain a feed payload.')
  }

  return {
    entries: payload.data,
    cursor: typeof payload.cursor === 'string' ? payload.cursor : null,
  }
}
