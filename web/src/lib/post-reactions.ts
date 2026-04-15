export type PublicReactionSummaryType =
  | 'all'
  | 'like'
  | 'dislike'
  | 'emoji'
  | 'gif'

export interface PublicReactionActor {
  id: string
  handle: string
  displayName: string | null
  avatarUrl: string | null
}

export interface PublicReactionSummaryEntry {
  actor: PublicReactionActor
  sentiment: 'like' | 'dislike' | null
  emojiValues: string[]
  gifValue: string | null
  reactedAt: string | null
}

export interface PublicReactionSummaryPage {
  reactions: PublicReactionSummaryEntry[]
  continuationToken: string | null
}

interface ApiError {
  code: string
  message: string
  field?: string
}

interface PublicReactionSummaryEnvelope {
  data: PublicReactionSummaryPage | null
  errors: ApiError[]
}

function readErrorMessage(
  payload: PublicReactionSummaryEnvelope | null,
): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getPostReactions(
  postId: string,
  options: {
    type?: PublicReactionSummaryType
    limit?: number
    continuationToken?: string | null
    signal?: AbortSignal
  } = {},
): Promise<PublicReactionSummaryPage> {
  const params = new URLSearchParams()

  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit))
  }

  if (options.type && options.type !== 'all') {
    params.set('type', options.type)
  }

  if (options.continuationToken) {
    params.set('continuationToken', options.continuationToken)
  }

  const search = params.toString()
  const requestUrl = `/api/posts/${encodeURIComponent(postId)}/reactions${
    search ? `?${search}` : ''
  }`

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload: PublicReactionSummaryEnvelope | null = null

  try {
    payload = (await response.json()) as PublicReactionSummaryEnvelope
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Reaction summary lookup failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('Reaction summary response did not contain a page payload.')
  }

  return payload.data
}
