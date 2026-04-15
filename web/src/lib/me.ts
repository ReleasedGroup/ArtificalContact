interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export interface UserCounters {
  posts: number
  followers: number
  following: number
}

export interface MeProfile {
  id: string
  identityProvider: string
  identityProviderUserId: string
  email: string | null
  handle: string | null
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
  links: Record<string, string>
  status: 'active' | 'pending' | 'suspended' | 'deactivated' | 'deleted'
  roles: string[]
  counters: UserCounters
  createdAt: string
  updatedAt: string
}

export interface ResolvedMeProfile {
  user: MeProfile
  isNewUser: boolean
}

export interface UpdateMeResponse {
  user: MeProfile
}

export interface UpdateMeInput {
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
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

    throw new Error('The profile response was not valid JSON.')
  }

  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message ?? failureFallback)
  }

  return payload
}

export async function getMe(signal?: AbortSignal): Promise<ResolvedMeProfile> {
  const response = await fetch('/api/me', {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<ResolvedMeProfile>(
    response,
    `Profile request failed with status ${response.status}.`,
  )

  if (!payload.data) {
    throw new Error('The profile response did not contain a payload.')
  }

  return payload.data
}

export async function updateMe(
  input: UpdateMeInput,
  signal?: AbortSignal,
): Promise<UpdateMeResponse> {
  const response = await fetch('/api/me', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<UpdateMeResponse>(
    response,
    `Profile update failed with status ${response.status}.`,
  )

  if (!payload.data) {
    throw new Error('The profile update response did not contain a payload.')
  }

  return payload.data
}
