interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

class NotificationPreferencesRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'NotificationPreferencesRequestError'
    this.status = status
  }
}

export interface NotificationChannelPreference {
  inApp: boolean
  email: boolean
  webPush: boolean
}

export interface NotificationWebPushSubscription {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface NotificationPreferences {
  userId: string
  events: {
    follow: NotificationChannelPreference
    reply: NotificationChannelPreference
    reaction: NotificationChannelPreference
    mention: NotificationChannelPreference
    followeePost: NotificationChannelPreference
  }
  webPush: {
    supported: boolean
    subscription: NotificationWebPushSubscription | null
  }
  createdAt: string
  updatedAt: string
}

interface NotificationPreferencesPayload {
  preferences: NotificationPreferences
}

export interface UpdateNotificationPreferencesInput {
  events?: Partial<NotificationPreferences['events']>
  webPush?: {
    supported?: boolean
    subscription?: NotificationWebPushSubscription | null
  }
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

    throw new Error('The notification preferences response was not valid JSON.')
  }

  if (!response.ok) {
    throw new NotificationPreferencesRequestError(
      payload?.errors?.[0]?.message ?? failureFallback,
      response.status,
    )
  }

  return payload
}

function extractPreferences(
  payload: ApiEnvelope<NotificationPreferencesPayload>,
  operation: 'lookup' | 'update',
): NotificationPreferences {
  const preferences = payload.data?.preferences

  if (!preferences) {
    throw new Error(
      operation === 'lookup'
        ? 'The notification preferences response did not contain a payload.'
        : 'The notification preferences update response did not contain a payload.',
    )
  }

  return preferences
}

export async function getNotificationPreferences(
  signal?: AbortSignal,
): Promise<NotificationPreferences> {
  const response = await fetch('/api/me/notifications', {
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<NotificationPreferencesPayload>(
    response,
    `Notification preferences request failed with status ${response.status}.`,
  )

  return extractPreferences(payload, 'lookup')
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput,
  signal?: AbortSignal,
): Promise<NotificationPreferences> {
  const response = await fetch('/api/me/notifications', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<NotificationPreferencesPayload>(
    response,
    `Notification preferences update failed with status ${response.status}.`,
  )

  return extractPreferences(payload, 'update')
}
