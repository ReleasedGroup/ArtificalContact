import { z, type ZodIssue } from 'zod'
import type { ApiError } from './api-envelope.js'
import type { UserDocument } from './users.js'

function normalizeOptionalText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const optionalTextFieldSchema = z.preprocess(
  normalizeOptionalText,
  z.string().trim().nullable(),
)

const optionalUrlFieldSchema = z.preprocess(
  normalizeOptionalText,
  z.string().trim().url().nullable(),
)

const expertiseSchema = z
  .array(z.string().trim().min(1))
  .transform((values) => {
    const normalizedValues = new Set<string>()

    for (const value of values) {
      normalizedValues.add(value.toLowerCase())
    }

    return [...normalizedValues]
  })

const linksSchema = z
  .record(z.string(), z.string().trim().url())
  .transform((value, context) => {
    const normalizedEntries: [string, string][] = []

    for (const [rawKey, rawUrl] of Object.entries(value)) {
      const normalizedKey = rawKey.trim().toLowerCase()

      if (normalizedKey.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Link keys must not be empty.',
          path: [rawKey],
        })
        continue
      }

      normalizedEntries.push([normalizedKey, rawUrl.trim()])
    }

    if (context.issues.length > 0) {
      return z.NEVER
    }

    return Object.fromEntries(normalizedEntries)
  })

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).optional(),
    bio: optionalTextFieldSchema.optional(),
    avatarUrl: optionalUrlFieldSchema.optional(),
    bannerUrl: optionalUrlFieldSchema.optional(),
    expertise: expertiseSchema.optional(),
    links: linksSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field must be provided.',
  })

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>

export function mapValidationIssues(issues: readonly ZodIssue[]): ApiError[] {
  return issues.map((issue) => ({
    code: 'invalid_profile',
    message: issue.message,
    ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
  }))
}

export function applyProfileUpdate(
  user: UserDocument,
  update: UpdateProfileRequest,
  updatedAt: Date,
): UserDocument {
  const nextUser: UserDocument = {
    ...user,
    updatedAt: updatedAt.toISOString(),
  }

  if (update.displayName !== undefined) {
    nextUser.displayName = update.displayName
  }

  if (update.expertise !== undefined) {
    nextUser.expertise = [...update.expertise]
  }

  if (update.links !== undefined) {
    nextUser.links = { ...update.links }
  }

  if (update.bio !== undefined) {
    if (update.bio === null) {
      delete nextUser.bio
    } else {
      nextUser.bio = update.bio
    }
  }

  if (update.avatarUrl !== undefined) {
    if (update.avatarUrl === null) {
      delete nextUser.avatarUrl
    } else {
      nextUser.avatarUrl = update.avatarUrl
    }
  }

  if (update.bannerUrl !== undefined) {
    if (update.bannerUrl === null) {
      delete nextUser.bannerUrl
    } else {
      nextUser.bannerUrl = update.bannerUrl
    }
  }

  return nextUser
}
