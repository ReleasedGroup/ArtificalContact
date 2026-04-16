interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export interface FollowRelationship {
  handle: string
  following: boolean
}

interface FollowRelationshipResponse {
  relationship: FollowRelationship
}

interface FollowMutationResponse {
  follow?: {
    handle?: string
    following?: boolean
  }
  unfollow?: {
    handle?: string
    following?: boolean
  }
}

function readErrorMessage<TData>(payload: ApiEnvelope<TData> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

async function readEnvelope<TData>(
  response: Response,
  fallbackMessage: string,
): Promise<ApiEnvelope<TData>> {
  let payload: ApiEnvelope<TData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<TData>
  } catch {
    if (!response.ok) {
      throw new Error(fallbackMessage)
    }

    throw new Error('The follow response was not valid JSON.')
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? fallbackMessage)
  }

  return payload
}

export async function getFollowRelationship(
  handle: string,
  signal?: AbortSignal,
): Promise<FollowRelationship> {
  const response = await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<FollowRelationshipResponse>(
    response,
    `Follow relationship lookup failed with status ${response.status}.`,
  )

  if (!payload.data?.relationship) {
    throw new Error(
      'The follow relationship response did not contain a relationship payload.',
    )
  }

  return payload.data.relationship
}

export async function followUser(
  handle: string,
  signal?: AbortSignal,
): Promise<FollowRelationship> {
  const response = await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<FollowMutationResponse>(
    response,
    `Follow request failed with status ${response.status}.`,
  )
  const followHandle = payload.data?.follow?.handle?.trim() || handle

  return {
    handle: followHandle,
    following: true,
  }
}

export async function unfollowUser(
  handle: string,
  signal?: AbortSignal,
): Promise<FollowRelationship> {
  const response = await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<FollowMutationResponse>(
    response,
    `Unfollow request failed with status ${response.status}.`,
  )
  const unfollowHandle = payload.data?.unfollow?.handle?.trim() || handle

  return {
    handle: unfollowHandle,
    following: false,
  }
}
