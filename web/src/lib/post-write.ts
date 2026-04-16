import type { PublicPost } from './public-post'
import { uploadMediaFile } from './media-upload'

interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

interface PostMutationPayload {
  post: PublicPost & {
    deletedAt?: string | null
    moderationState?: string | null
  }
}

interface DeletePostPayload {
  id: string
  threadId: string
  deletedAt: string
  alreadyDeleted: boolean
}

export interface CreatePostMediaFileInput {
  altText: string
  file: File
}

export interface CreatePostImageMediaInput {
  id: string
  kind: 'image'
  url: string
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
}

export interface CreatePostGifMediaInput {
  id: string
  kind: 'gif'
  url: string
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
}

export type CreatePostMediaInput =
  | CreatePostImageMediaInput
  | CreatePostGifMediaInput

interface CreatePostInput {
  text?: string
  media?: CreatePostMediaInput[]
  mediaFiles?: CreatePostMediaFileInput[]
}

export interface ReplyGifMediaInput {
  id: string
  kind: 'gif'
  url: string
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
}

interface CreateReplyInput {
  text?: string
  media?: ReplyGifMediaInput[]
}

function readErrorMessage<TData>(payload: ApiEnvelope<TData> | null): string | null {
  const firstError = payload?.errors?.[0]
  return firstError?.message?.trim() ? firstError.message : null
}

async function readEnvelope<TData>(
  response: Response,
  fallbackMessage: string,
  invalidJsonMessage: string,
): Promise<ApiEnvelope<TData>> {
  let payload: ApiEnvelope<TData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<TData>
  } catch {
    if (!response.ok) {
      throw new Error(fallbackMessage)
    }

    throw new Error(invalidJsonMessage)
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? fallbackMessage)
  }

  return payload
}

function normalizePostText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function resolvePostMediaKind(file: File): 'image' | 'gif' {
  return file.type.trim().toLowerCase() === 'image/gif' ? 'gif' : 'image'
}

async function uploadPostMediaFiles(
  mediaFiles: readonly CreatePostMediaFileInput[],
  signal?: AbortSignal,
): Promise<CreatePostMediaInput[]> {
  const uploadedMedia = await Promise.all(
    mediaFiles.map(async ({ file }) => {
      const mediaKind = resolvePostMediaKind(file)
      const uploadedBlob = await uploadMediaFile({
        file,
        kind: mediaKind,
        signal,
      })

      return {
        id: uploadedBlob.blobName,
        kind: mediaKind,
        url: uploadedBlob.blobUrl,
        thumbUrl: uploadedBlob.blobUrl,
        width: null,
        height: null,
      } satisfies CreatePostMediaInput
    }),
  )

  return uploadedMedia
}

export async function createPost(
  input: CreatePostInput,
  signal?: AbortSignal,
): Promise<PostMutationPayload> {
  const normalizedText = normalizePostText(input.text)
  const uploadedMedia =
    input.mediaFiles && input.mediaFiles.length > 0
      ? await uploadPostMediaFiles(input.mediaFiles, signal)
      : []
  const resolvedMedia = [...(input.media ?? []), ...uploadedMedia]

  const response = await fetch('/api/posts', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(normalizedText.length > 0 ? { text: normalizedText } : {}),
      ...(resolvedMedia.length > 0 ? { media: resolvedMedia } : {}),
    }),
    signal,
  })

  const payload = await readEnvelope<PostMutationPayload>(
    response,
    `Post publish failed with status ${response.status}.`,
    'The post publish response was not valid JSON.',
  )

  if (!payload.data?.post) {
    throw new Error('The post publish response did not contain a post payload.')
  }

  return payload.data
}

export async function createReply(
  postId: string,
  input: CreateReplyInput,
  signal?: AbortSignal,
): Promise<PostMutationPayload> {
  const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/replies`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<PostMutationPayload>(
    response,
    `Reply publish failed with status ${response.status}.`,
    'The reply publish response was not valid JSON.',
  )

  if (!payload.data?.post) {
    throw new Error('The reply publish response did not contain a post payload.')
  }

  return payload.data
}

export async function deletePost(
  postId: string,
  signal?: AbortSignal,
): Promise<DeletePostPayload> {
  const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
    signal,
  })

  const payload = await readEnvelope<DeletePostPayload>(
    response,
    `Post delete failed with status ${response.status}.`,
    'The post delete response was not valid JSON.',
  )

  if (!payload.data) {
    throw new Error('The post delete response did not contain a payload.')
  }

  return payload.data
}
