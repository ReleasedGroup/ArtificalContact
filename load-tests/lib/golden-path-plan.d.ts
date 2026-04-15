export interface SyntheticIdentity {
  displayName: string
  email: string
  handle: string
  principal: {
    identityProvider: string
    userDetails: string
    userId: string
    userRoles: string[]
    claims: Array<{
      typ: string
      val: string
    }>
  }
  profile: {
    handle: string
    displayName: string
    bio: string
    expertise: string[]
    links: Record<string, string>
  }
  userId: string
}

export interface LoadProfile {
  vus: number
  duration: string
  maxHttpFailureRate: number
  maxTooManyRequestsRate: number
  maxSearchP95Ms: number
  maxEventualConsistencyMs: number
}

export const DEFAULT_LOAD_PROFILE: Readonly<LoadProfile>

export function sanitizeRunId(runId: unknown): string

export function buildSyntheticIdentity(
  runId: unknown,
  lane: unknown,
  slot: unknown,
): SyntheticIdentity

export function buildThresholds(
  profile?: LoadProfile,
): Record<string, string[]>

export function buildScenarioOptions(
  overrides?: Partial<LoadProfile>,
): {
  scenarios: {
    golden_path: {
      executor: 'constant-vus'
      vus: number
      duration: string
    }
  }
  summaryTrendStats: string[]
  thresholds: Record<string, string[]>
}
