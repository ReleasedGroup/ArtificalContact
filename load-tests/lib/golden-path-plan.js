export const DEFAULT_LOAD_PROFILE = Object.freeze({
  vus: 500,
  duration: '30m',
  maxHttpFailureRate: 0.01,
  maxTooManyRequestsRate: 0.005,
  maxSearchP95Ms: 500,
  maxEventualConsistencyMs: 60_000,
})

function normalizeFragment(value, fallback, maxLength) {
  const normalizedValue = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, maxLength)

  return normalizedValue.length > 0 ? normalizedValue : fallback
}

export function sanitizeRunId(runId) {
  return normalizeFragment(runId, 'load', 8)
}

export function buildSyntheticIdentity(runId, lane, slot) {
  const normalizedRunId = sanitizeRunId(runId)
  const normalizedLane = normalizeFragment(lane, 'u', 2)
  const normalizedSlot = normalizeFragment(slot, '0', 12)
  const handle = `lt${normalizedRunId}${normalizedLane}${normalizedSlot}`.slice(
    0,
    32,
  )
  const userId = `${normalizedRunId}-${normalizedLane}-${normalizedSlot}`
  const displayName = `Load ${normalizedLane.toUpperCase()} ${normalizedSlot}`
  const email = `${handle}@example.test`

  return {
    displayName,
    email,
    handle,
    principal: {
      identityProvider: 'github',
      userDetails: handle,
      userId,
      userRoles: ['authenticated'],
      claims: [
        {
          typ: 'email',
          val: email,
        },
        {
          typ: 'name',
          val: displayName,
        },
      ],
    },
    profile: {
      handle,
      displayName,
      bio: `Synthetic load actor ${userId}.`,
      expertise: ['load', 'golden'],
      links: {
        github: `https://example.test/${handle}`,
      },
    },
    userId,
  }
}

export function buildThresholds(
  profile = DEFAULT_LOAD_PROFILE,
) {
  return {
    http_req_failed: [`rate<${profile.maxHttpFailureRate}`],
    too_many_requests_rate: [`rate<${profile.maxTooManyRequestsRate}`],
    'http_req_duration{step:search}': [`p(95)<${profile.maxSearchP95Ms}`],
    notification_visibility_lag: [
      `p(95)<${profile.maxEventualConsistencyMs}`,
    ],
    search_visibility_lag: [`p(95)<${profile.maxEventualConsistencyMs}`],
  }
}

export function buildScenarioOptions(overrides = {}) {
  const profile = {
    ...DEFAULT_LOAD_PROFILE,
    ...overrides,
  }

  return {
    scenarios: {
      golden_path: {
        executor: 'constant-vus',
        vus: profile.vus,
        duration: profile.duration,
      },
    },
    summaryTrendStats: ['avg', 'min', 'med', 'p90', 'p95', 'p99', 'max'],
    thresholds: buildThresholds(profile),
  }
}
