import type { HttpResponseInit } from '@azure/functions'

export interface ApiError {
  code: string
  message: string
  field?: string
}

export interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
  cursor?: string | null
}

const defaultJsonHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const

export function createJsonEnvelopeResponse<TData>(
  status: number,
  body: ApiEnvelope<TData>,
  headers: Record<string, string> = {},
): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      ...defaultJsonHeaders,
      ...headers,
    },
  }
}

export function createSuccessResponse<TData>(
  data: TData,
  status = 200,
): HttpResponseInit {
  return createJsonEnvelopeResponse(status, {
    data,
    errors: [],
  })
}

export function createErrorResponse(
  status: number,
  error: ApiError,
): HttpResponseInit {
  return createJsonEnvelopeResponse(status, {
    data: null,
    errors: [error],
  })
}
