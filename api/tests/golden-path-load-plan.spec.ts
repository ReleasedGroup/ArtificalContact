import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOAD_PROFILE,
  buildScenarioOptions,
  buildSyntheticIdentity,
  buildThresholds,
  sanitizeRunId,
} from '../../load-tests/lib/golden-path-plan.js'

describe('sanitizeRunId', () => {
  it('keeps lowercase alphanumerics and trims to eight characters', () => {
    expect(sanitizeRunId(' Sprint-8_Run! ')).toBe('sprint8r')
  })

  it('falls back to the default token when the value is empty', () => {
    expect(sanitizeRunId('***')).toBe('load')
  })
})

describe('buildSyntheticIdentity', () => {
  it('creates deterministic handles, profile fields, and SWA principal claims', () => {
    const identity = buildSyntheticIdentity('s8', 'a', 12)

    expect(identity).toEqual({
      displayName: 'Load A 12',
      email: 'lts8a12@example.test',
      handle: 'lts8a12',
      principal: {
        identityProvider: 'github',
        userDetails: 'lts8a12',
        userId: 's8-a-12',
        userRoles: ['authenticated'],
        claims: [
          {
            typ: 'email',
            val: 'lts8a12@example.test',
          },
          {
            typ: 'name',
            val: 'Load A 12',
          },
        ],
      },
      profile: {
        handle: 'lts8a12',
        displayName: 'Load A 12',
        bio: 'Synthetic load actor s8-a-12.',
        expertise: ['load', 'golden'],
        links: {
          github: 'https://example.test/lts8a12',
        },
      },
      userId: 's8-a-12',
    })
  })

  it('keeps different lanes isolated for the same slot', () => {
    const author = buildSyntheticIdentity('s8', 'a', 7)
    const replier = buildSyntheticIdentity('s8', 'b', 7)

    expect(author.handle).not.toBe(replier.handle)
    expect(author.userId).not.toBe(replier.userId)
  })
})

describe('buildThresholds', () => {
  it('maps the observability profile into k6-compatible threshold expressions', () => {
    expect(buildThresholds(DEFAULT_LOAD_PROFILE)).toEqual({
      http_req_failed: ['rate<0.01'],
      too_many_requests_rate: ['rate<0.005'],
      'http_req_duration{step:search}': ['p(95)<500'],
      notification_visibility_lag: ['p(95)<60000'],
      search_visibility_lag: ['p(95)<60000'],
    })
  })
})

describe('buildScenarioOptions', () => {
  it('creates a constant-vus scenario with the requested duration and thresholds', () => {
    expect(
      buildScenarioOptions({
        vus: 5,
        duration: '1m',
      }),
    ).toEqual({
      scenarios: {
        golden_path: {
          executor: 'constant-vus',
          vus: 5,
          duration: '1m',
        },
      },
      summaryTrendStats: ['avg', 'min', 'med', 'p90', 'p95', 'p99', 'max'],
      thresholds: buildThresholds({
        ...DEFAULT_LOAD_PROFILE,
        vus: 5,
        duration: '1m',
      }),
    })
  })
})
