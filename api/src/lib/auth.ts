const CLIENT_PRINCIPAL_HEADER = 'x-ms-client-principal'

const emailClaimTypes = [
  'email',
  'emails',
  'preferred_username',
  'upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
] as const

const nameClaimTypes = [
  'name',
  'preferred_username',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
] as const

export interface ClientPrincipalClaim {
  typ: string
  val: string
}

export interface StaticWebAppsClientPrincipal {
  identityProvider: string
  userId: string
  userDetails: string
  userRoles: string[]
  claims: ClientPrincipalClaim[]
}

export interface AuthenticatedPrincipal extends StaticWebAppsClientPrincipal {
  subject: string
  displayName: string
  email?: string
}

type PrincipalResolutionErrorCode =
  | 'auth.missing_principal'
  | 'auth.invalid_principal'
  | 'auth.unauthenticated'

export type PrincipalResolution =
  | {
      ok: true
      principal: AuthenticatedPrincipal
    }
  | {
      ok: false
      errorCode: PrincipalResolutionErrorCode
      message: string
    }

interface HeaderCollectionLike {
  get(name: string): string | null
}

interface RequestLike {
  headers: HeaderCollectionLike
}

interface PrincipalRecord {
  claims?: unknown
  identityProvider?: unknown
  typ?: unknown
  userDetails?: unknown
  userId?: unknown
  userRoles?: unknown
  val?: unknown
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function readClaims(value: unknown): ClientPrincipalClaim[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }

    const record = item as PrincipalRecord
    const typ = readNonEmptyString(record.typ)
    const val = readNonEmptyString(record.val)

    if (!typ || !val) {
      return []
    }

    return [{ typ, val }]
  })
}

function isRecord(value: unknown): value is PrincipalRecord {
  return typeof value === 'object' && value !== null
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function getClaimValue(
  principal: Pick<StaticWebAppsClientPrincipal, 'claims'>,
  claimTypes: readonly string[],
): string | undefined {
  const normalizedClaimTypes = claimTypes.map((claimType) =>
    claimType.toLowerCase(),
  )

  for (const claim of principal.claims) {
    if (normalizedClaimTypes.includes(claim.typ.toLowerCase())) {
      return claim.val
    }
  }

  return undefined
}

export function decodeClientPrincipalHeader(
  headerValue: string,
): StaticWebAppsClientPrincipal | null {
  const trimmedHeaderValue = readNonEmptyString(headerValue)
  if (!trimmedHeaderValue) {
    return null
  }

  try {
    const decodedJson = Buffer.from(trimmedHeaderValue, 'base64').toString(
      'utf8',
    )
    const parsedValue: unknown = JSON.parse(decodedJson)

    if (!isRecord(parsedValue)) {
      return null
    }

    const identityProvider = readNonEmptyString(parsedValue.identityProvider)
    const userId = readNonEmptyString(parsedValue.userId)

    if (!identityProvider || !userId) {
      return null
    }

    return {
      identityProvider,
      userId,
      userDetails: readNonEmptyString(parsedValue.userDetails) ?? '',
      userRoles: readStringArray(parsedValue.userRoles),
      claims: readClaims(parsedValue.claims),
    }
  } catch {
    return null
  }
}

function resolveDisplayName(principal: StaticWebAppsClientPrincipal): string {
  const claimedName = getClaimValue(principal, nameClaimTypes)
  if (claimedName) {
    return claimedName
  }

  if (principal.userDetails && !looksLikeEmail(principal.userDetails)) {
    return principal.userDetails
  }

  const email = getClaimValue(principal, emailClaimTypes)
  if (email) {
    const localPart = email.split('@')[0]
    return localPart || principal.userId
  }

  return principal.userId
}

export function resolveAuthenticatedPrincipal(
  request: RequestLike,
): PrincipalResolution {
  const headerValue = request.headers.get(CLIENT_PRINCIPAL_HEADER)

  if (!headerValue) {
    return {
      ok: false,
      errorCode: 'auth.missing_principal',
      message: 'Authentication is required.',
    }
  }

  const principal = decodeClientPrincipalHeader(headerValue)

  if (!principal) {
    return {
      ok: false,
      errorCode: 'auth.invalid_principal',
      message: 'The authentication context is invalid.',
    }
  }

  const normalizedRoles = principal.userRoles.map((role) => role.toLowerCase())
  if (!normalizedRoles.includes('authenticated')) {
    return {
      ok: false,
      errorCode: 'auth.unauthenticated',
      message: 'Authentication is required.',
    }
  }

  const email = getClaimValue(principal, emailClaimTypes)

  return {
    ok: true,
    principal: {
      ...principal,
      subject: `${principal.identityProvider.toLowerCase()}:${principal.userId}`,
      displayName: resolveDisplayName(principal),
      ...(email ? { email } : {}),
    },
  }
}

export { CLIENT_PRINCIPAL_HEADER }
