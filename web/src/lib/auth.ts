import type { QueryClient } from '@tanstack/react-query'

export const swaLogoutHref = '/.auth/logout'

interface SignOutOptions {
  queryClient: QueryClient
  location?: Pick<Location, 'assign'>
}

export function signOut({
  queryClient,
  location = window.location,
}: SignOutOptions) {
  queryClient.clear()
  location.assign(swaLogoutHref)
}
