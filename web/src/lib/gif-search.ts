interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export interface GifSearchResult {
  id: string
  title: string | null
  previewUrl: string
  gifUrl: string
  width: number | null
  height: number | null
}

export interface GifSearchResponse {
  mode: 'featured' | 'search'
  query: string
  results: GifSearchResult[]
}

function readErrorMessage(payload: ApiEnvelope<unknown> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

export async function searchGifs(
  query: string,
  options: {
    limit?: number
    locale?: string
    signal?: AbortSignal
  } = {},
): Promise<GifSearchResponse> {
  const normalizedQuery = query.trim()
  const searchParams = new URLSearchParams()

  if (normalizedQuery.length > 0) {
    searchParams.set('q', normalizedQuery)
  }

  if (options.locale?.trim()) {
    searchParams.set('locale', options.locale.trim())
  }

  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    searchParams.set('limit', String(Math.trunc(options.limit)))
  }

  const requestTarget = `/api/gifs/search${
    searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  }`

  const response = await fetch(requestTarget, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  })

  let payload: ApiEnvelope<GifSearchResponse> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<GifSearchResponse>
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `GIF search failed with status ${response.status}.`,
    )
  }

  if (!payload?.data) {
    throw new Error('The GIF search response did not contain any results.')
  }

  return payload.data
}
