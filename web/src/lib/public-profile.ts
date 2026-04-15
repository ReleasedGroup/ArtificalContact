export interface PublicUserProfile {
  id: string
  handle: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
  counters: {
    posts: number
    followers: number
    following: number
  }
  createdAt: string | null
  updatedAt: string | null
}

interface ApiError {
  code: string
  message: string
  field?: string
}

interface PublicProfileEnvelope {
  data: PublicUserProfile | null
  errors: ApiError[]
}

export class PublicProfileNotFoundError extends Error {
  constructor(message = 'No public profile exists for the requested handle.') {
    super(message)
    this.name = 'PublicProfileNotFoundError'
  }
}

function readErrorMessage(payload: PublicProfileEnvelope | null): string | null {
  const firstError = payload?.errors[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function getPublicUserProfile(
  handle: string,
  signal?: AbortSignal,
): Promise<PublicUserProfile> {
  const response = await fetch(`/api/users/${encodeURIComponent(handle)}`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  let payload: PublicProfileEnvelope | null = null

  try {
    payload = (await response.json()) as PublicProfileEnvelope
  } catch {
    payload = null
  }

  if (response.status === 404) {
    throw new PublicProfileNotFoundError(readErrorMessage(payload) ?? undefined)
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Public profile lookup failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('Public profile response did not contain a profile payload.')
  }

  return payload.data
}
