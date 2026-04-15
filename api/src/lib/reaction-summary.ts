import type { ApiEnvelope } from './api-envelope.js'
import { isPubliclyVisiblePost, type PostStore } from './posts.js'
import type {
  ReactionDocument,
  ReactionListRepository,
  ReactionListType,
} from './reactions.js'
import {
  buildPublicUserProfileFromUser,
  type UserProfileStore,
} from './user-profile.js'

export const DEFAULT_REACTION_SUMMARY_PAGE_SIZE = 8
export const MAX_REACTION_SUMMARY_PAGE_SIZE = 100
const REACTION_PROFILE_READ_BATCH_SIZE = 10

export interface PublicReactionActor {
  id: string
  handle: string
  displayName: string | null
  avatarUrl: string | null
}

export interface PublicReactionSummaryEntry {
  actor: PublicReactionActor
  sentiment: 'like' | 'dislike' | null
  emojiValues: string[]
  gifValue: string | null
  reactedAt: string | null
}

export interface PublicReactionSummaryPage {
  reactions: PublicReactionSummaryEntry[]
  continuationToken: string | null
}

export interface ReactionSummaryPageRequest {
  postId: string | undefined
  limit?: string | undefined
  continuationToken?: string | undefined
  type?: string | undefined
}

export interface ReactionSummaryLookupResult {
  status: 200 | 400 | 404
  body: ApiEnvelope<PublicReactionSummaryPage | null>
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

function normalizeReactionSummaryPageLimit(
  limit: string | undefined,
): number | null {
  const normalizedLimit = toNullableString(limit)
  if (normalizedLimit === null) {
    return DEFAULT_REACTION_SUMMARY_PAGE_SIZE
  }

  if (!/^\d+$/.test(normalizedLimit)) {
    return null
  }

  const parsedLimit = Number.parseInt(normalizedLimit, 10)
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_REACTION_SUMMARY_PAGE_SIZE
  ) {
    return null
  }

  return parsedLimit
}

function normalizeReactionListType(
  value: string | undefined,
): ReactionListType | null {
  const normalizedValue = toNullableString(value)
  if (normalizedValue === null) {
    return 'all'
  }

  switch (normalizedValue.toLowerCase()) {
    case 'all':
    case 'like':
    case 'dislike':
    case 'emoji':
    case 'gif':
      return normalizedValue.toLowerCase() as ReactionListType
    default:
      return null
  }
}

function buildInvalidPostIdResult(): ReactionSummaryLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [
        {
          code: 'invalid_post_id',
          message: 'The post id path parameter is required.',
          field: 'id',
        },
      ],
    },
  }
}

function buildInvalidLimitResult(): ReactionSummaryLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [
        {
          code: 'invalid_limit',
          message: `The limit query parameter must be an integer between 1 and ${MAX_REACTION_SUMMARY_PAGE_SIZE}.`,
          field: 'limit',
        },
      ],
    },
  }
}

function buildInvalidTypeResult(): ReactionSummaryLookupResult {
  return {
    status: 400,
    body: {
      data: null,
      errors: [
        {
          code: 'invalid_reaction_type',
          message:
            'The type query parameter must be one of all, like, dislike, emoji, or gif.',
          field: 'type',
        },
      ],
    },
  }
}

function buildPublicReactionSummaryEntry(
  reaction: ReactionDocument,
  actor: PublicReactionActor,
): PublicReactionSummaryEntry {
  return {
    actor,
    sentiment: reaction.sentiment,
    emojiValues: toStringArray(reaction.emojiValues),
    gifValue: toNullableString(reaction.gifValue),
    reactedAt:
      toNullableString(reaction.updatedAt) ??
      toNullableString(reaction.createdAt),
  }
}

async function loadReactionSummaryEntries(
  reactions: readonly ReactionDocument[],
  profileStore: UserProfileStore,
): Promise<PublicReactionSummaryEntry[]> {
  const entries: PublicReactionSummaryEntry[] = []

  for (
    let index = 0;
    index < reactions.length;
    index += REACTION_PROFILE_READ_BATCH_SIZE
  ) {
    const batch = reactions.slice(
      index,
      index + REACTION_PROFILE_READ_BATCH_SIZE,
    )
    const batchEntries = await Promise.all(
      batch.map(async (reaction) => {
        const user = await profileStore.getUserById(reaction.userId)
        if (user === null) {
          return null
        }

        const publicProfile = buildPublicUserProfileFromUser(user)
        if (publicProfile === null) {
          return null
        }

        return buildPublicReactionSummaryEntry(reaction, {
          id: publicProfile.id,
          handle: publicProfile.handle,
          displayName: publicProfile.displayName,
          avatarUrl: publicProfile.avatarUrl,
        })
      }),
    )

    entries.push(
      ...batchEntries.filter(
        (entry): entry is PublicReactionSummaryEntry => entry !== null,
      ),
    )
  }

  return entries
}

export async function lookupReactionSummaryPage(
  request: ReactionSummaryPageRequest,
  postStore: PostStore,
  reactionStore: ReactionListRepository,
  profileStore: UserProfileStore,
): Promise<ReactionSummaryLookupResult> {
  const postId = toNullableString(request.postId)
  if (postId === null) {
    return buildInvalidPostIdResult()
  }

  const limit = normalizeReactionSummaryPageLimit(request.limit)
  if (limit === null) {
    return buildInvalidLimitResult()
  }

  const type = normalizeReactionListType(request.type)
  if (type === null) {
    return buildInvalidTypeResult()
  }

  const post = await postStore.getPostById(postId)
  if (post === null || !isPubliclyVisiblePost(post)) {
    return {
      status: 404,
      body: {
        data: null,
        errors: [
          {
            code: 'post_not_found',
            message: 'No public post exists for the requested id.',
            field: 'id',
          },
        ],
      },
    }
  }

  const continuationToken =
    toNullableString(request.continuationToken) ?? undefined
  const page = await reactionStore.listByPostId(postId, {
    limit,
    type,
    ...(continuationToken === undefined ? {} : { continuationToken }),
  })
  const reactions = await loadReactionSummaryEntries(
    page.reactions,
    profileStore,
  )

  return {
    status: 200,
    body: {
      data: {
        reactions,
        continuationToken: page.continuationToken ?? null,
      },
      errors: [],
    },
  }
}
