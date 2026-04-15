interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export type ReactionType = 'like' | 'dislike' | 'emoji'

export interface CreateReactionInput {
  type: ReactionType
  value?: string
}

export interface CreateReactionPayload {
  reaction: {
    sentiment: 'like' | 'dislike' | null
    emojiValues: string[]
    gifValue: string | null
  }
}

export interface DeleteReactionPayload {
  unreact: {
    id: string
    postId: string
    userId: string
    reactionExisted: boolean
    deletedReaction: boolean
    removedEmojiValue: string | null
    emojiValueRemoved: boolean
  }
  reaction: {
    sentiment: 'like' | 'dislike' | null
    emojiValues: string[]
    gifValue: string | null
  } | null
}

function readErrorMessage<TData>(payload: ApiEnvelope<TData> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

async function readEnvelope<TData>(
  response: Response,
  failureFallback: string,
): Promise<ApiEnvelope<TData>> {
  let payload: ApiEnvelope<TData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<TData>
  } catch {
    if (!response.ok) {
      throw new Error(failureFallback)
    }

    throw new Error('The reaction response was not valid JSON.')
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? failureFallback)
  }

  return payload
}

export async function createReaction(
  postId: string,
  input: CreateReactionInput,
  signal?: AbortSignal,
): Promise<CreateReactionPayload> {
  const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/reactions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<CreateReactionPayload>(
    response,
    `Creating the reaction failed with status ${response.status}.`,
  )

  if (!payload.data?.reaction) {
    throw new Error('Reaction create response did not include a reaction payload.')
  }

  return payload.data
}

export async function deleteReaction(
  postId: string,
  emojiValue?: string,
  signal?: AbortSignal,
): Promise<DeleteReactionPayload> {
  const encodedPostId = encodeURIComponent(postId)
  const query = emojiValue ? `?emoji=${encodeURIComponent(emojiValue)}` : ''

  const response = await fetch(`/api/posts/${encodedPostId}/reactions${query}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<DeleteReactionPayload>(
    response,
    `Deleting the reaction failed with status ${response.status}.`,
  )

  if (!payload.data) {
    throw new Error('Reaction delete response did not include a payload.')
  }

  return payload.data
}
