import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { CosmosUserProfileStore } from '../lib/cosmos-user-profile-store.js'
import {
  lookupPublicUserProfile,
  type UserProfileStore,
} from '../lib/user-profile.js'

let cachedStore: CosmosUserProfileStore | undefined

function getStore(): CosmosUserProfileStore {
  cachedStore ??= CosmosUserProfileStore.fromEnvironment()
  return cachedStore
}

export function buildGetUserHandler(
  storeFactory: () => UserProfileStore = getStore,
) {
  return async function getUserHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const result = await lookupPublicUserProfile(request.params.handle, storeFactory())

    context.log('Public profile lookup completed.', {
      handle: request.params.handle ?? null,
      status: result.status,
    })

    return {
      status: result.status,
      jsonBody: result.body,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    }
  }
}

export const getUserHandler = buildGetUserHandler()

export function registerGetUserFunction() {
  app.http('getUser', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/{handle}',
    handler: getUserHandler,
  })
}
