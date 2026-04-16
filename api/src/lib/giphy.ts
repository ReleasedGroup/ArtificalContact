import { readOptionalValue } from './strings.js'

const DEFAULT_GIPHY_LIMIT = 12
const MAX_GIPHY_LIMIT = 24
const DEFAULT_GIPHY_RATING = 'pg-13'

export interface GiphyConfig {
  apiKey: string
}

export interface SearchGiphyGifsOptions {
  limit?: number
  locale?: string
  query?: string
}

export interface GiphyGifSearchResult {
  id: string
  title: string | null
  previewUrl: string
  gifUrl: string
  width: number | null
  height: number | null
}

export interface GiphyGifSearchResponse {
  mode: 'featured' | 'search'
  query: string
  results: GiphyGifSearchResult[]
}

export class GiphyConfigurationError extends Error {
  constructor(message = 'The GIPHY integration is not configured.') {
    super(message)
    this.name = 'GiphyConfigurationError'
  }
}

export class GiphyUpstreamError extends Error {
  constructor(message = 'GIPHY GIF search is temporarily unavailable.') {
    super(message)
    this.name = 'GiphyUpstreamError'
  }
}

function clampGiphyLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GIPHY_LIMIT
  }

  return Math.min(MAX_GIPHY_LIMIT, Math.max(1, Math.trunc(value ?? 0)))
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullableDimension(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toGiphyImage(
  value: unknown,
): { url: string; width: number | null; height: number | null } | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const url = toNullableString((value as { url?: unknown }).url)
  if (url === null) {
    return null
  }

  return {
    url,
    width: toNullableDimension((value as { width?: unknown }).width),
    height: toNullableDimension((value as { height?: unknown }).height),
  }
}

function pickFirstImage(
  images: Record<string, unknown>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const image = toGiphyImage(images[key])
    if (image !== null) {
      return image
    }
  }

  return null
}

function mapGiphyGifSearchResult(value: unknown): GiphyGifSearchResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const id = toNullableString((value as { id?: unknown }).id)
  if (id === null) {
    return null
  }

  const images =
    typeof (value as { images?: unknown }).images === 'object' &&
    (value as { images?: unknown }).images !== null
      ? ((value as { images: Record<string, unknown> }).images ?? {})
      : {}

  const preview = pickFirstImage(images, [
    'fixed_width_small',
    'fixed_width',
    'preview_gif',
    'downsized',
    'original',
  ])
  const gif = pickFirstImage(images, [
    'original',
    'downsized',
    'fixed_width',
    'fixed_width_downsampled',
    'fixed_height',
  ])

  if (preview === null || gif === null) {
    return null
  }

  return {
    id,
    title:
      toNullableString((value as { title?: unknown }).title) ??
      toNullableString((value as { alt_text?: unknown }).alt_text) ??
      toNullableString((value as { slug?: unknown }).slug),
    previewUrl: preview.url,
    gifUrl: gif.url,
    width: gif.width ?? preview.width,
    height: gif.height ?? preview.height,
  }
}

function normalizeGiphyLang(locale: string | undefined): string | null {
  const normalized = locale?.trim()
  if (!normalized) {
    return null
  }

  const [language] = normalized.split(/[-_]/)
  const lower = language?.trim().toLowerCase()
  return lower ? lower : null
}

function buildGiphyUrl(config: GiphyConfig, options: SearchGiphyGifsOptions): URL {
  const query = options.query?.trim() ?? ''
  const mode = query.length > 0 ? 'search' : 'trending'
  const url = new URL(`https://api.giphy.com/v1/gifs/${mode}`)

  url.searchParams.set('api_key', config.apiKey)
  url.searchParams.set('limit', String(clampGiphyLimit(options.limit)))
  url.searchParams.set('rating', DEFAULT_GIPHY_RATING)

  if (mode === 'search') {
    url.searchParams.set('q', query)

    const lang = normalizeGiphyLang(options.locale)
    if (lang) {
      url.searchParams.set('lang', lang)
    }
  }

  return url
}

export function getGiphyConfig(
  env: NodeJS.ProcessEnv = process.env,
): GiphyConfig {
  const apiKey = readOptionalValue(env.GIPHY_API_KEY)
  if (!apiKey) {
    throw new GiphyConfigurationError()
  }

  return {
    apiKey,
  }
}

export async function searchGiphyGifs(
  options: SearchGiphyGifsOptions = {},
  dependencies: {
    config?: GiphyConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<GiphyGifSearchResponse> {
  const config = dependencies.config ?? getGiphyConfig()
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const url = buildGiphyUrl(config, options)
  const normalizedQuery = options.query?.trim() ?? ''

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new GiphyUpstreamError(
      `GIPHY GIF search failed with status ${response.status}.`,
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new GiphyUpstreamError('GIPHY GIF search returned invalid JSON.')
  }

  const rawResults = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: unknown[] }).data ?? [])
    : []

  return {
    mode: normalizedQuery.length > 0 ? 'search' : 'featured',
    query: normalizedQuery,
    results: rawResults
      .map((item) => mapGiphyGifSearchResult(item))
      .filter((item): item is GiphyGifSearchResult => item !== null),
  }
}
