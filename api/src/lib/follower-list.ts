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

export async function lookupFollowersPage(
  request: FollowersPageRequest,
  profileStore: UserProfileStore,
  followersStore: FollowersMirrorRepository,
): Promise<FollowersLookupResult> {
  const targetProfile = await lookupPublicUserProfile(request.handle, profileStore)
  if (targetProfile.status !== 200 || targetProfile.body.data === null) {
    return {
      status: targetProfile.status,
      body: {
        data: null,
        errors: targetProfile.body.errors,
      },
    }
  }

  const limit = normalizeFollowersPageLimit(request.limit)
  if (limit === null) {
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

  const continuationToken = toNullableString(request.continuationToken) ?? undefined
  const page = await followersStore.listFollowers(targetProfile.body.data.id, {
    limit,
    ...(continuationToken === undefined ? {} : { continuationToken }),
  })
  const users = await Promise.all(
    page.follows.map(async (follow) => profileStore.getUserById(follow.followerId)),
  )

  return {
    status: 200,
    body: {
      data: {
        users: users
          .map((user) => buildFollowerProfile(user))
          .filter((user): user is PublicUserProfile => user !== null),
        continuationToken: page.continuationToken ?? null,
      },
      errors: [],
    },
  }
}
