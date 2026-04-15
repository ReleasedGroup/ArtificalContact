import type { ApiEnvelope } from './api-envelope.js'
import {
  normalizeHandleLower,
  type ExistingMirrorRecord,
} from './users-by-handle-mirror.js'

export interface StoredUserDocument {
  id: string
  handle?: string | null
  handleLower?: string | null
  displayName?: string | null
  bio?: string | null
  avatarUrl?: string | null
  bannerUrl?: string | null
  expertise?: string[] | null
  counters?: {
    posts?: number | null
    followers?: number | null
    following?: number | null
  } | null
  createdAt?: string | null
  updatedAt?: string | null
  status?: string | null
}

export interface PublicUserProfile {
  id: string
  handle: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
  counters: {
    posts: number
    followers: number
    following: number
  }
  createdAt: string | null
  updatedAt: string | null
}

export interface UserProfileStore {
  getByHandle(handle: string): Promise<ExistingMirrorRecord | null>
  getUserById(userId: string): Promise<StoredUserDocument | null>
}

export interface UserProfileLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<PublicUserProfile | null>
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => toNullableString(item))
    .filter((item): item is string => item !== null)
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function isPubliclyVisibleUser(user: StoredUserDocument): boolean {
  const status = toNullableString(user.status)
  return status === null || status === 'active'
}

export function buildPublicUserProfile(
  user: StoredUserDocument,
  mirror: ExistingMirrorRecord,
): PublicUserProfile {
  return {
    id: user.id,
    handle:
      toNullableString(user.handle) ??
      toNullableString(user.handleLower) ??
      mirror.handle,
    displayName: toNullableString(user.displayName),
    bio: toNullableString(user.bio),
    avatarUrl: toNullableString(user.avatarUrl),
    bannerUrl: toNullableString(user.bannerUrl),
    expertise: toStringArray(user.expertise),
    counters: {
      posts: toCount(user.counters?.posts),
      followers: toCount(user.counters?.followers),
      following: toCount(user.counters?.following),
    },
    createdAt: toNullableString(user.createdAt),
    updatedAt: toNullableString(user.updatedAt),
  }
}

export async function lookupPublicUserProfile(
  handle: string | undefined,
  store: UserProfileStore,
): Promise<UserProfileLookupResult> {
  const normalizedHandle = normalizeHandleLower(
    handle === undefined ? {} : { handle },
  )
  if (normalizedHandle === null) {
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

  const mirror = await store.getByHandle(normalizedHandle)
  if (mirror === null) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'user_not_found',
            message: 'No public profile exists for the requested handle.',
            field: 'handle',
          },
        ],
      },
    }
  }

  const user = await store.getUserById(mirror.userId)
  if (user === null || !isPubliclyVisibleUser(user)) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'user_not_found',
            message: 'No public profile exists for the requested handle.',
            field: 'handle',
          },
        ],
      },
    }
  }

  const currentHandle = normalizeHandleLower(user)
  if (currentHandle !== mirror.handle) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'user_not_found',
            message: 'No public profile exists for the requested handle.',
            field: 'handle',
          },
        ],
      },
    }
  }

  return {
    status: 200,
    body: {
      data: buildPublicUserProfile(user, mirror),
      errors: [],
    },
  }
}
