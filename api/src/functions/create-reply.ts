import { randomUUID } from 'node:crypto'
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import {
  createErrorResponse,
  createJsonEnvelopeResponse,
  createSuccessResponse,
} from '../lib/api-envelope.js'
import { CosmosPostStore } from '../lib/cosmos-post-store.js'
import { withHttpAuth } from '../lib/http-auth.js'
import {
  buildCreateReplyRequestSchema,
  createUserReplyDocument,
  isPubliclyVisiblePost,
  mapCreatePostValidationIssues,
  resolvePostMaxLength,
  type ReadablePostRepository,
} from '../lib/posts.js'
import { withRateLimit } from '../lib/rate-limit.js'

export interface CreateReplyHandlerDependencies {
  idFactory?: () => string
  maxTextLength?: number
  now?: () => Date
  repositoryFactory?: () => ReadablePostRepository
}

let cachedStore: CosmosPostStore | undefined

function getStore(): CosmosPostStore {
  cachedStore ??= CosmosPostStore.fromEnvironment()
  return cachedStore
}

function normalizeRoutePostId(postId: string | undefined): string | null {
  const trimmed = postId?.trim()
  return trimmed ? trimmed : null
}

export function buildCreateReplyHandler(
  dependencies: CreateReplyHandlerDependencies = {},
) {
  const idFactory = dependencies.idFactory ?? randomUUID
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory = dependencies.repositoryFactory ?? (() => getStore())

  return async function createReplyHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const authorHandle =
      authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !authorHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before creating replies.',
      })
    }

    const parentPostId = normalizeRoutePostId(request.params.id)
    if (parentPostId === null) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: [
          {
            code: 'invalid_post_id',
            message: 'The post id path parameter is required.',
            field: 'id',
          },
        ],
      })
    }

    let requestSchema: ReturnType<typeof buildCreateReplyRequestSchema>

    try {
      const maxTextLength = dependencies.maxTextLength ?? resolvePostMaxLength()
      requestSchema = buildCreateReplyRequestSchema(maxTextLength)
    } catch (error) {
      context.log('Failed to configure the reply validation rules.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown reply validation configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The reply validation configuration is invalid.',
      })
    }

    let repository: ReadablePostRepository

    try {
      repository = repositoryFactory()
    } catch (error) {
      context.log('Failed to configure the post repository.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown repository configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The post store is not configured.',
      })
    }

    let requestBody: unknown

    try {
      requestBody = await request.json()
    } catch {
      return createErrorResponse(400, {
        code: 'invalid_json',
        message: 'The request body must be valid JSON.',
      })
    }

    const parsedBody = requestSchema.safeParse(requestBody)
    if (!parsedBody.success) {
      return createJsonEnvelopeResponse(400, {
        data: null,
        errors: mapCreatePostValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const parentPost = await repository.getPostById(parentPostId)
      if (parentPost === null || !isPubliclyVisiblePost(parentPost)) {
        return createJsonEnvelopeResponse(404, {
          data: null,
          errors: [
            {
              code: 'post_not_found',
              message: 'No public post exists for the requested id.',
              field: 'id',
            },
          ],
        })
      }

      const reply = createUserReplyDocument(
        authenticatedUser,
        parentPost,
        parsedBody.data,
        now(),
        idFactory,
      )
      const storedReply = await repository.create(reply)

      context.log('Created reply post.', {
        authorId: authenticatedUser.id,
        parentId: parentPostId,
        replyId: storedReply.id,
        threadId: storedReply.threadId,
      })

      return createSuccessResponse(
        {
          post: storedReply,
        },
        201,
      )
    } catch (error) {
      context.log('Failed to create the reply.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown reply creation error.',
        authorId: authenticatedUser.id,
        parentId: parentPostId,
      })

      return createErrorResponse(500, {
        code: 'server.reply_create_failed',
        message: 'Unable to create the reply.',
      })
    }
  }
}

export const createReplyHandler = withHttpAuth(
  withRateLimit(buildCreateReplyHandler(), {
    endpointClass: 'posts',
  }),
)

export function registerCreateReplyFunction() {
  app.http('replyToPost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'posts/{id}/replies',
    handler: createReplyHandler,
  })
}
