import type { ApiEnvelope } from './api-envelope.js'
import type { FollowersMirrorRepository } from './follows.js'
import {
  buildPublicUserProfile,
  lookupPublicUserProfile,
  type PublicUserProfile,
  type StoredUserDocument,
  type UserProfileStore,
} from './user-profile.js'
import { normalizeHandleLower } from './users-by-handle-mirror.js'

export const DEFAULT_FOLLOWERS_PAGE_SIZE = 50
export const MAX_FOLLOWERS_PAGE_SIZE = 100
const FOLLOWER_PROFILE_READ_BATCH_SIZE = 10

export interface FollowersPage {
  users: PublicUserProfile[]
  continuationToken: string | null
}

export interface FollowersPageRequest {
  handle: string | undefined
  limit?: string | undefined
  continuationToken?: string | undefined
}

export interface FollowersLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<FollowersPage | null>
}

function buildInvalidHandleResult(): FollowersLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [
        {
          code: 'invalid_handle',
          message: 'The handle path parameter is required.',
          field: 'handle',
        },
      ],
    },
  }
}

function buildInvalidLimitResult(): FollowersLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [
        {
          code: 'invalid_limit',
          message: `The limit query parameter must be an integer between 1 and ${MAX_FOLLOWERS_PAGE_SIZE}.`,
          field: 'limit',
        },
      ],
    },
  }
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFollowersPageLimit(limit: string | undefined): number | null {
  const normalizedLimit = toNullableString(limit)
  if (normalizedLimit === null) {
    return DEFAULT_FOLLOWERS_PAGE_SIZE
  }

  if (!/^\d+$/.test(normalizedLimit)) {
    return null
  }

  const parsedLimit = Number.parseInt(normalizedLimit, 10)
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_FOLLOWERS_PAGE_SIZE
  ) {
    return null
  }

  return parsedLimit
}

function isPubliclyVisibleUser(user: StoredUserDocument): boolean {
  const status = toNullableString(user.status)
  return status === null || status === 'active'
}

function buildFollowerProfile(
  user: StoredUserDocument | null,
): PublicUserProfile | null {
  if (user === null || !isPubliclyVisibleUser(user)) {
    return null
  }

  const handle = normalizeHandleLower(user)
  if (handle === null) {
    return null
  }

  return buildPublicUserProfile(user, {
    id: handle,
    handle,
    userId: user.id,
  })
}

async function loadFollowerProfiles(
  followerIds: readonly string[],
  profileStore: UserProfileStore,
): Promise<PublicUserProfile[]> {
  const users: PublicUserProfile[] = []

  for (
    let index = 0;
    index < followerIds.length;
    index += FOLLOWER_PROFILE_READ_BATCH_SIZE
  ) {
    const batch = followerIds.slice(
      index,
      index + FOLLOWER_PROFILE_READ_BATCH_SIZE,
    )
    const batchUsers = await Promise.all(
      batch.map(async (followerId) =>
        buildFollowerProfile(await profileStore.getUserById(followerId)),
      ),
    )

    users.push(
      ...batchUsers.filter((user): user is PublicUserProfile => user !== null),
    )
  }

  return users
}

export async function lookupFollowersPage(
  request: FollowersPageRequest,
  profileStore: UserProfileStore,
  followersStore: FollowersMirrorRepository,
): Promise<FollowersLookupResult> {
  const normalizedHandle = normalizeHandleLower(
    request.handle === undefined ? {} : { handle: request.handle },
  )
  if (normalizedHandle === null) {
    return buildInvalidHandleResult()
  }

  const limit = normalizeFollowersPageLimit(request.limit)
  if (limit === null) {
    return buildInvalidLimitResult()
  }

  const targetProfile = await lookupPublicUserProfile(
    normalizedHandle,
    profileStore,
  )
  if (targetProfile.status !== 200 || targetProfile.body.data === null) {
    return {
      status: targetProfile.status,
      body: {
        data: null,
        errors: targetProfile.body.errors,
      },
    }
  }

  const continuationToken = toNullableString(request.continuationToken) ?? undefined
  const page = await followersStore.listFollowers(targetProfile.body.data.id, {
    limit,
    ...(continuationToken === undefined ? {} : { continuationToken }),
  })
  const users = await loadFollowerProfiles(
    page.follows.map((follow) => follow.followerId),
    profileStore,
  )

  return {
    status: 200,
    body: {
      data: {
        users,
        continuationToken: page.continuationToken ?? null,
      },
      errors: [],
    },
  }
}
