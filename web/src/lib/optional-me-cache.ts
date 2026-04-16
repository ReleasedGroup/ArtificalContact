import type { QueryClient } from '@tanstack/react-query'
import type { MeProfile, ResolvedMeProfile } from './me'

export const OPTIONAL_ME_QUERY_KEY = ['optional-me'] as const

export function createResolvedMeProfileSnapshot(
  user: MeProfile,
): ResolvedMeProfile {
  return {
    isNewUser: false,
    user,
  }
}

export function updateCachedOptionalMe(
  queryClient: QueryClient,
  fallbackUser: MeProfile,
  updater: (user: MeProfile) => MeProfile,
): void {
  queryClient.setQueryData<ResolvedMeProfile | null>(
    OPTIONAL_ME_QUERY_KEY,
    (current) => {
      if (current === null) {
        return current
      }

      const baseUser = current?.user ?? fallbackUser

      return {
        isNewUser: current?.isNewUser ?? false,
        user: updater(baseUser),
      }
    },
  )
}
