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
import { withHttpAuth } from '../lib/http-auth.js'
import {
  buildCreatePostRequestSchema,
  createPostRepository,
  createUserPostDocument,
  mapCreatePostValidationIssues,
  resolvePostMaxLength,
  type PostRepository,
} from '../lib/posts.js'

export interface CreatePostHandlerDependencies {
  idFactory?: () => string
  maxTextLength?: number
  now?: () => Date
  repositoryFactory?: () => PostRepository
}

export function buildCreatePostHandler(
  dependencies: CreatePostHandlerDependencies = {},
) {
  const idFactory = dependencies.idFactory ?? randomUUID
  const maxTextLength = dependencies.maxTextLength ?? resolvePostMaxLength()
  const now = dependencies.now ?? (() => new Date())
  const repositoryFactory =
    dependencies.repositoryFactory ?? (() => createPostRepository())
  const requestSchema = buildCreatePostRequestSchema(maxTextLength)

  return async function createPostHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    const authorHandle = authenticatedUser?.handle ?? authenticatedUser?.handleLower

    if (
      !authenticatedUser ||
      authenticatedUser.status !== 'active' ||
      !authorHandle
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active profile before creating posts.',
      })
    }

    let repository: PostRepository

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
      const post = createUserPostDocument(
        authenticatedUser,
        parsedBody.data,
        now(),
        idFactory,
      )
      const storedPost = await repository.create(post)

      context.log('Created root post.', {
        authorId: authenticatedUser.id,
        postId: storedPost.id,
        threadId: storedPost.threadId,
      })

      return createSuccessResponse(
        {
          post: storedPost,
        },
        201,
      )
    } catch (error) {
      context.log('Failed to create the root post.', {
        error:
          error instanceof Error ? error.message : 'Unknown post creation error.',
        authorId: authenticatedUser.id,
      })

      return createErrorResponse(500, {
        code: 'server.post_create_failed',
        message: 'Unable to create the post.',
      })
    }
  }
}

export const createPostHandler = withHttpAuth(buildCreatePostHandler())

export function registerCreatePostFunction() {
  app.http('createPost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'posts',
    handler: createPostHandler,
  })
}
