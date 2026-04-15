import { describe, expect, it } from 'vitest'
import {
  CLIENT_PRINCIPAL_HEADER,
  decodeClientPrincipalHeader,
  resolveAuthenticatedPrincipal,
} from '../src/lib/auth.js'

function createPrincipalHeaderValue(
  principal: Record<string, unknown>,
): string {
  return Buffer.from(JSON.stringify(principal)).toString('base64')
}

function createRequestWithPrincipal(principal?: Record<string, unknown>) {
  const encodedPrincipal = principal
    ? createPrincipalHeaderValue(principal)
    : null

  return {
    headers: {
      get(name: string) {
        if (name.toLowerCase() !== CLIENT_PRINCIPAL_HEADER) {
          return null
        }

        return encodedPrincipal
      },
    },
  }
}

describe('decodeClientPrincipalHeader', () => {
  it('returns null when the header is not valid JSON', () => {
    const encodedPrincipal = Buffer.from('not-json').toString('base64')

    expect(decodeClientPrincipalHeader(encodedPrincipal)).toBeNull()
  })
})

describe('resolveAuthenticatedPrincipal', () => {
  it('decodes a valid authenticated principal', () => {
    const result = resolveAuthenticatedPrincipal(
      createRequestWithPrincipal({
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: [' anonymous ', 'authenticated', 'USER'],
        claims: [
          { typ: 'name', val: 'Nick Beaugeard' },
          { typ: 'emails', val: 'nick@example.com' },
        ],
      }),
    )

    expect(result).toEqual({
      ok: true,
      principal: {
        identityProvider: 'github',
        userId: 'abc123',
        userDetails: 'nickbeau',
        userRoles: ['anonymous', 'authenticated', 'user'],
        claims: [
          { typ: 'name', val: 'Nick Beaugeard' },
          { typ: 'emails', val: 'nick@example.com' },
        ],
        subject: 'github:abc123',
        displayName: 'Nick Beaugeard',
        email: 'nick@example.com',
      },
    })
  })

  it('rejects requests without an authentication header', () => {
    const result = resolveAuthenticatedPrincipal(createRequestWithPrincipal())

    expect(result).toEqual({
      ok: false,
      errorCode: 'auth.missing_principal',
      message: 'Authentication is required.',
    })
  })

  it('rejects anonymous principals', () => {
    const result = resolveAuthenticatedPrincipal(
      createRequestWithPrincipal({
        identityProvider: 'aad',
        userId: 'abc123',
        userDetails: 'Nick',
        userRoles: ['anonymous'],
        claims: [],
      }),
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'auth.unauthenticated',
      message: 'Authentication is required.',
    })
  })

  it('rejects principals that do not explicitly include the authenticated role', () => {
    const result = resolveAuthenticatedPrincipal(
      createRequestWithPrincipal({
        identityProvider: 'aad',
        userId: 'abc123',
        userDetails: 'Nick',
        userRoles: ['user'],
        claims: [],
      }),
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'auth.unauthenticated',
      message: 'Authentication is required.',
    })
  })

  it('rejects malformed authentication headers', () => {
    const result = resolveAuthenticatedPrincipal({
      headers: {
        get(name: string) {
          if (name.toLowerCase() !== CLIENT_PRINCIPAL_HEADER) {
            return null
          }

          return createPrincipalHeaderValue({
            identityProvider: 'github',
            claims: [],
          })
        },
      },
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'auth.invalid_principal',
      message: 'The authentication context is invalid.',
    })
  })
})
