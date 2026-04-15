import encoding from 'k6/encoding'
import exec from 'k6/execution'
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import {
  DEFAULT_LOAD_PROFILE,
  buildScenarioOptions,
  buildSyntheticIdentity,
  sanitizeRunId,
} from './lib/golden-path-plan.js'

const tooManyRequestsRate = new Rate('too_many_requests_rate')
const searchVisibilityLag = new Trend('search_visibility_lag', true)
const notificationVisibilityLag = new Trend(
  'notification_visibility_lag',
  true,
)
const goldenPathIterations = new Counter('golden_path_iterations')
const goldenPathFailures = new Counter('golden_path_failures')

const baseUrl = normalizeBaseUrl(__ENV.LOAD_BASE_URL)
const runId = sanitizeRunId(__ENV.LOAD_RUN_ID)
const skipMediaProfileStep = readBoolean(
  __ENV.LOAD_SKIP_MEDIA_PROFILE_STEP,
  false,
)
const pollIntervalMs = readPositiveInteger(__ENV.LOAD_POLL_INTERVAL_MS, 1_000)
const searchTimeoutMs = readPositiveInteger(
  __ENV.LOAD_SEARCH_TIMEOUT_MS,
  DEFAULT_LOAD_PROFILE.maxEventualConsistencyMs,
)
const notificationTimeoutMs = readPositiveInteger(
  __ENV.LOAD_NOTIFICATION_TIMEOUT_MS,
  DEFAULT_LOAD_PROFILE.maxEventualConsistencyMs,
)
const thinkTimeSeconds = readPositiveNumber(__ENV.LOAD_THINK_TIME_SECONDS, 1)

export const options = buildScenarioOptions({
  vus: readPositiveInteger(__ENV.LOAD_VUS, DEFAULT_LOAD_PROFILE.vus),
  duration: __ENV.LOAD_DURATION || DEFAULT_LOAD_PROFILE.duration,
})

const hubIdentity = prepareIdentity('h', 'hub')
let vuState

export function setup() {
  ensureProfile(hubIdentity, { includeMedia: false })

  return {
    hubHandle: hubIdentity.handle,
  }
}

export default function goldenPath(data) {
  const state = getVuState()
  const iterationTag = buildIterationTag(exec.vu.idInTest, exec.scenario.iterationInTest)

  try {
    const createdPost = createPost(state.author, iterationTag)

    followTarget(state.author, data.hubHandle)
    reactToPost(state.replier, createdPost.id)
    replyToPost(state.replier, createdPost.id, iterationTag)

    const searchLagMs = waitForSearchVisibility(
      state.author,
      iterationTag.queryToken,
      createdPost.id,
    )
    const notificationLagMs = waitForReplyNotification(
      state.author,
      state.replier.userId,
      createdPost.id,
    )

    searchVisibilityLag.add(searchLagMs)
    notificationVisibilityLag.add(notificationLagMs)
    goldenPathIterations.add(1)
  } catch (error) {
    goldenPathFailures.add(1)
    throw error
  }

  sleep(thinkTimeSeconds)
}

function getVuState() {
  if (vuState) {
    return vuState
  }

  const vuId = exec.vu.idInTest
  const author = prepareIdentity('a', vuId)
  const replier = prepareIdentity('b', vuId)

  ensureProfile(author, { includeMedia: !skipMediaProfileStep })
  ensureProfile(replier, { includeMedia: false })

  vuState = {
    author,
    replier,
  }

  return vuState
}

function prepareIdentity(lane, slot) {
  const identity = buildSyntheticIdentity(runId, lane, slot)

  return {
    ...identity,
    principalHeader: encoding.b64encode(JSON.stringify(identity.principal)),
  }
}

function ensureProfile(identity, options = {}) {
  requestJson('GET', '/api/me', identity, null, { step: 'me' })

  let avatarUrl

  if (options.includeMedia) {
    const uploadPayload = requestJson(
      'POST',
      '/api/media/upload-url',
      identity,
      {
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 68,
      },
      { step: 'media-upload-url' },
    )

    avatarUrl = uploadPayload?.data?.blobUrl
  }

  requestJson(
    'PUT',
    '/api/me',
    identity,
    {
      ...identity.profile,
      ...(avatarUrl ? { avatarUrl } : {}),
    },
    { step: 'profile-update' },
  )
}

function createPost(identity, iterationTag) {
  const payload = requestJson(
    'POST',
    '/api/posts',
    identity,
    {
      text: `Synthetic load ${iterationTag.queryToken} #load`,
    },
    { step: 'post-create' },
  )

  const post = payload?.data?.post
  if (!post?.id) {
    throw new Error('POST /api/posts did not return a post id.')
  }

  return post
}

function followTarget(identity, targetHandle) {
  requestJson(
    'POST',
    `/api/users/${encodeURIComponent(targetHandle)}/follow`,
    identity,
    null,
    { step: 'follow' },
  )
}

function reactToPost(identity, postId) {
  requestJson(
    'POST',
    `/api/posts/${encodeURIComponent(postId)}/reactions`,
    identity,
    {
      type: 'like',
    },
    { step: 'reaction' },
  )
}

function replyToPost(identity, postId, iterationTag) {
  requestJson(
    'POST',
    `/api/posts/${encodeURIComponent(postId)}/replies`,
    identity,
    {
      text: `Synthetic reply ${iterationTag.replyToken}`,
    },
    { step: 'reply' },
  )
}

function waitForSearchVisibility(identity, queryToken, postId) {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= searchTimeoutMs) {
    const payload = requestJson(
      'GET',
      `/api/search?${buildQueryString({
        q: queryToken,
        type: 'posts',
      })}`,
      identity,
      null,
      { step: 'search' },
    )

    const results = payload?.data?.results ?? []
    const foundPost = Array.isArray(results)
      ? results.some((result) => result?.id === postId)
      : false

    if (foundPost) {
      return Date.now() - startedAt
    }

    sleep(pollIntervalMs / 1_000)
  }

  throw new Error(
    `Search did not surface post ${postId} within ${searchTimeoutMs} ms.`,
  )
}

function waitForReplyNotification(identity, actorUserId, postId) {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= notificationTimeoutMs) {
    const payload = requestJson(
      'GET',
      `/api/notifications?${buildQueryString({
        limit: 20,
      })}`,
      identity,
      null,
      { step: 'notifications' },
    )

    const notifications = payload?.data?.notifications ?? []
    const foundNotification = Array.isArray(notifications)
      ? notifications.some(
          (notification) =>
            notification?.eventType === 'reply' &&
            notification?.actorUserId === actorUserId &&
            notification?.postId === postId,
        )
      : false

    if (foundNotification) {
      return Date.now() - startedAt
    }

    sleep(pollIntervalMs / 1_000)
  }

  throw new Error(
    `Reply notification for post ${postId} did not materialize within ${notificationTimeoutMs} ms.`,
  )
}

function requestJson(method, path, identity, body, tags) {
  const response = http.request(
    method,
    `${baseUrl}${path}`,
    body === null ? null : JSON.stringify(body),
    {
      headers: buildHeaders(identity, body !== null),
      tags,
    },
  )

  tooManyRequestsRate.add(response.status === 429 ? 1 : 0)

  const success = check(response, {
    [`${method} ${path} completed successfully`]: (result) =>
      result.status >= 200 && result.status < 400,
  })

  let payload = null

  if (response.body) {
    try {
      payload = response.json()
    } catch {
      payload = null
    }
  }

  if (!success) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${readErrorMessage(payload)}`,
    )
  }

  return payload
}

function buildHeaders(identity, hasJsonBody) {
  const headers = {
    Accept: 'application/json',
    'x-ms-client-principal': identity.principalHeader,
  }

  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json'
  }

  return headers
}

function readErrorMessage(payload) {
  const apiMessage = payload?.errors?.[0]?.message

  if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) {
    return apiMessage.trim()
  }

  return 'Unknown API failure.'
}

function buildIterationTag(vuId, iterationInTest) {
  const normalizedVuId = String(vuId)
  const normalizedIteration = String(iterationInTest)
  const queryToken = `lt${runId}v${normalizedVuId}i${normalizedIteration}`

  return {
    queryToken,
    replyToken: `${queryToken}-reply`,
  }
}

function buildQueryString(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&')
}

function normalizeBaseUrl(value) {
  const trimmedValue = String(value ?? '').trim().replace(/\/+$/, '')

  if (!trimmedValue) {
    throw new Error(
      'LOAD_BASE_URL is required. Point it at the Functions origin, for example http://127.0.0.1:7071 or https://<functionapp>.azurewebsites.net.',
    )
  }

  return trimmedValue
}

function readBoolean(value, fallback) {
  if (value === undefined) {
    return fallback
  }

  const normalizedValue = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false
  }

  return fallback
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return fallback
  }

  const parsedValue = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`Expected a positive integer but received "${value}".`)
  }

  return parsedValue
}

function readPositiveNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return fallback
  }

  const parsedValue = Number(String(value))
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`Expected a positive number but received "${value}".`)
  }

  return parsedValue
}
