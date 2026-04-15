import { describe, expect, it, vi } from 'vitest'
import { signOut, swaLogoutHref } from './auth'
import { createQueryClient } from './query-client'

describe('signOut', () => {
  it('clears the TanStack Query cache before redirecting to SWA logout', () => {
    const queryClient = createQueryClient()
    const location = {
      assign: vi.fn(),
    }

    queryClient.setQueryData(['health'], {
      buildSha: 'sha-1234',
      cosmos: { status: 'ok' },
      region: 'australiaeast',
      service: 'artificialcontact-api',
      status: 'ok',
      timestamp: '2026-04-15T00:00:00.000Z',
    })

    signOut({ queryClient, location })

    expect(queryClient.getQueryData(['health'])).toBeUndefined()
    expect(location.assign).toHaveBeenCalledWith(swaLogoutHref)
  })
})
