import type { ApiEnvelope } from './api-envelope.js'
import type { FollowingListRepository } from './follows.js'
import {
  buildPublicUserProfileFromUser,
  lookupPublicUserProfile,
  type PublicUserProfile,
  type UserProfileStore,
} from './user-profile.js'

export const DEFAULT_FOLLOWING_PAGE_SIZE = 50
export const MAX_FOLLOWING_PAGE_SIZE = 100
const FOLLOWEE_PROFILE_LOOKUP_CONCURRENCY = 10

export interface FollowingPage {
  handle: string
  following: PublicUserProfile[]
  continuationToken: string | null
}

export interface FollowingPageRequest {
  handle: string | undefined
  limit?: string | undefined
  continuationToken?: string | undefined
}

export interface FollowingLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<FollowingPage | null>
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFollowingPageLimit(limit: string | undefined): number | null {
  const normalizedLimit = toNullableString(limit)
  if (normalizedLimit === null) {
    return DEFAULT_FOLLOWING_PAGE_SIZE
  }

  if (!/^\d+$/.test(normalizedLimit)) {
    return null
  }

  const parsedLimit = Number.parseInt(normalizedLimit, 10)
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_FOLLOWING_PAGE_SIZE
  ) {
    return null
  }

  return parsedLimit
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: readonly TInput[],
  concurrencyLimit: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<TOutput>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrencyLimit, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(items[currentIndex]!)
      }
    }),
  )

  return results
}

export async function lookupFollowing(
  request: FollowingPageRequest,
  repository: FollowingListRepository,
  store: UserProfileStore,
): Promise<FollowingLookupResult> {
  const sourceProfileResult = await lookupPublicUserProfile(
    request.handle,
    store,
  )
  if (sourceProfileResult.status !== 200 || !sourceProfileResult.body.data) {
    return {
      status: sourceProfileResult.status,
      body: {
        data: null,
        errors: sourceProfileResult.body.errors,
      },
    }
  }

  const limit = normalizeFollowingPageLimit(request.limit)
  if (limit === null) {
    return {
      status: 400,
      body: {
        data: null,
        errors: [
          {
            code: 'invalid_limit',
            message: `The limit query parameter must be an integer between 1 and ${MAX_FOLLOWING_PAGE_SIZE}.`,
            field: 'limit',
          },
        ],
      },
    }
  }

  const continuationToken =
    toNullableString(request.continuationToken) ?? undefined
  const page = await repository.listByFollowerId(
    sourceProfileResult.body.data.id,
    {
      limit,
      ...(continuationToken === undefined ? {} : { continuationToken }),
    },
  )

  const followeeProfiles = await mapWithConcurrencyLimit(
    page.follows,
    FOLLOWEE_PROFILE_LOOKUP_CONCURRENCY,
    async (follow) => {
      const user = await store.getUserById(follow.followedId)
      if (user === null) {
        return null
      }

      return buildPublicUserProfileFromUser(user)
    },
  )

  return {
    status: 200,
    body: {
      data: {
        handle: sourceProfileResult.body.data.handle,
        following: followeeProfiles.filter(
          (profile): profile is PublicUserProfile => profile !== null,
        ),
        continuationToken: page.continuationToken ?? null,
      },
      errors: [],
    },
  }
}
