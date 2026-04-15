import { readOptionalValue } from './strings.js'

const DEFAULT_TENOR_CLIENT_KEY = 'artificialcontact-web'
const DEFAULT_TENOR_CONTENT_FILTER = 'medium'
const DEFAULT_TENOR_LIMIT = 12
const MAX_TENOR_LIMIT = 24

export interface TenorConfig {
  apiKey: string
  clientKey: string
}

export interface SearchTenorGifsOptions {
  limit?: number
  locale?: string
  query?: string
}

export interface TenorGifSearchResult {
  id: string
  title: string | null
  previewUrl: string
  gifUrl: string
  width: number | null
  height: number | null
}

export interface TenorGifSearchResponse {
  mode: 'featured' | 'search'
  query: string
  results: TenorGifSearchResult[]
}

export class TenorConfigurationError extends Error {
  constructor(message = 'The Tenor integration is not configured.') {
    super(message)
    this.name = 'TenorConfigurationError'
  }
}

export class TenorUpstreamError extends Error {
  constructor(message = 'Tenor GIF search is temporarily unavailable.') {
    super(message)
    this.name = 'TenorUpstreamError'
  }
}

function clampTenorLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TENOR_LIMIT
  }

  return Math.min(MAX_TENOR_LIMIT, Math.max(1, Math.trunc(value ?? 0)))
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullableDimensions(
  value: unknown,
): { width: number | null; height: number | null } {
  if (!Array.isArray(value) || value.length < 2) {
    return {
      width: null,
      height: null,
    }
  }

  const width = value[0]
  const height = value[1]

  return {
    width:
      typeof width === 'number' && Number.isFinite(width) && width > 0
        ? width
        : null,
    height:
      typeof height === 'number' && Number.isFinite(height) && height > 0
        ? height
        : null,
  }
}

function toTenorMedia(
  value: unknown,
): { url: string; width: number | null; height: number | null } | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const url = toNullableString((value as { url?: unknown }).url)
  if (url === null) {
    return null
  }

  const { width, height } = toNullableDimensions(
    (value as { dims?: unknown }).dims,
  )

  return {
    url,
    width,
    height,
  }
}

function mapTenorGifSearchResult(value: unknown): TenorGifSearchResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const id = toNullableString((value as { id?: unknown }).id)
  if (id === null) {
    return null
  }

  const mediaFormats =
    typeof (value as { media_formats?: unknown }).media_formats === 'object' &&
    (value as { media_formats?: unknown }).media_formats !== null
      ? ((value as { media_formats: Record<string, unknown> }).media_formats ??
          {})
      : {}

  const preview =
    toTenorMedia(mediaFormats.tinygif) ?? toTenorMedia(mediaFormats.gif)
  const gif = toTenorMedia(mediaFormats.gif) ?? preview

  if (preview === null || gif === null) {
    return null
  }

  return {
    id,
    title:
      toNullableString((value as { content_description?: unknown }).content_description) ??
      toNullableString((value as { title?: unknown }).title),
    previewUrl: preview.url,
    gifUrl: gif.url,
    width: gif.width ?? preview.width,
    height: gif.height ?? preview.height,
  }
}

function buildTenorUrl(
  config: TenorConfig,
  options: SearchTenorGifsOptions,
): URL {
  const query = options.query?.trim() ?? ''
  const mode = query.length > 0 ? 'search' : 'featured'
  const url = new URL(`https://tenor.googleapis.com/v2/${mode}`)

  url.searchParams.set('key', config.apiKey)
  url.searchParams.set('client_key', config.clientKey)
  url.searchParams.set('limit', String(clampTenorLimit(options.limit)))
  url.searchParams.set('media_filter', 'tinygif,gif')
  url.searchParams.set('contentfilter', DEFAULT_TENOR_CONTENT_FILTER)

  if (query.length > 0) {
    url.searchParams.set('q', query)
  }

  const locale = options.locale?.trim()
  if (locale) {
    url.searchParams.set('locale', locale.replace(/-/g, '_'))
  }

  return url
}

export function getTenorConfig(
  env: NodeJS.ProcessEnv = process.env,
): TenorConfig {
  const apiKey = readOptionalValue(env.TENOR_API_KEY)
  if (!apiKey) {
    throw new TenorConfigurationError()
  }

  return {
    apiKey,
    clientKey:
      readOptionalValue(env.TENOR_CLIENT_KEY) ?? DEFAULT_TENOR_CLIENT_KEY,
  }
}

export async function searchTenorGifs(
  options: SearchTenorGifsOptions = {},
  dependencies: {
    config?: TenorConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<TenorGifSearchResponse> {
  const config = dependencies.config ?? getTenorConfig()
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const url = buildTenorUrl(config, options)
  const mode = (options.query?.trim() ?? '').length > 0 ? 'search' : 'featured'

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new TenorUpstreamError(
      `Tenor GIF search failed with status ${response.status}.`,
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new TenorUpstreamError('Tenor GIF search returned invalid JSON.')
  }

  const rawResults = Array.isArray((payload as { results?: unknown }).results)
    ? ((payload as { results: unknown[] }).results ?? [])
    : []

  return {
    mode,
    query: options.query?.trim() ?? '',
    results: rawResults
      .map((item) => mapTenorGifSearchResult(item))
      .filter((item): item is TenorGifSearchResult => item !== null),
  }
}
