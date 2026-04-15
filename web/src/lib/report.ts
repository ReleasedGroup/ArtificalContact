interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export const reportReasonOptions = [
  {
    code: 'spam',
    label: 'Spam',
    description: 'Promotional, repetitive, or deceptive content.',
  },
  {
    code: 'harassment',
    label: 'Harassment',
    description: 'Abuse, threats, dogpiling, or targeted hostility.',
  },
  {
    code: 'misinformation',
    label: 'Misinformation',
    description: 'False or misleading claims presented as factual.',
  },
  {
    code: 'impersonation',
    label: 'Impersonation',
    description: 'Pretending to be a person, team, or organization.',
  },
  {
    code: 'nsfw',
    label: 'NSFW',
    description: 'Sexual or graphic material that should be reviewed.',
  },
  {
    code: 'other',
    label: 'Other',
    description: 'Anything else that needs moderator attention.',
  },
] as const

export type ReportReasonCode = (typeof reportReasonOptions)[number]['code']
export type ReportTargetType = 'post' | 'reply' | 'media' | 'user'

export interface CreateReportInput {
  targetType: ReportTargetType
  targetId: string
  targetPostId?: string | null
  reasonCode: ReportReasonCode
  details?: string | null
  mediaUrl?: string | null
  targetProfileHandle?: string | null
}

export interface CreatedReport {
  id: string
  status: 'open' | 'triaged' | 'resolved'
  targetType: ReportTargetType
  targetId: string
  reasonCode: ReportReasonCode
  createdAt: string
}

function readErrorMessage<TData>(payload: ApiEnvelope<TData> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

async function readEnvelope<TData>(
  response: Response,
  fallbackMessage: string,
  invalidJsonMessage: string,
): Promise<ApiEnvelope<TData>> {
  let payload: ApiEnvelope<TData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<TData>
  } catch {
    if (!response.ok) {
      throw new Error(fallbackMessage)
    }

    throw new Error(invalidJsonMessage)
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? fallbackMessage)
  }

  return payload
}

export async function createReport(
  input: CreateReportInput,
  signal?: AbortSignal,
): Promise<CreatedReport> {
  const response = await fetch('/api/reports', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<{ report: CreatedReport }>(
    response,
    `Report submission failed with status ${response.status}.`,
    'The report submission response was not valid JSON.',
  )

  if (!payload.data?.report) {
    throw new Error('The report submission response did not contain a report payload.')
  }

  return payload.data.report
}
