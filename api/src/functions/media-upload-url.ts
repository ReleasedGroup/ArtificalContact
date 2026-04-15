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
  MediaDurationTooLongError,
  MediaFileTooLargeError,
  UnsupportedMediaContentTypeError,
  buildCreateMediaUploadRequestSchema,
  getMediaUploadUrlIssuer,
  mapCreateMediaUploadValidationIssues,
  type MediaUploadUrlIssuer,
} from '../lib/media-upload.js'
import { withRateLimit } from '../lib/rate-limit.js'

export interface MediaUploadUrlHandlerDependencies {
  issuerFactory?: () => MediaUploadUrlIssuer
}

const allowedUserStatuses = new Set(['active', 'pending'])

export function buildMediaUploadUrlHandler(
  dependencies: MediaUploadUrlHandlerDependencies = {},
) {
  const issuerFactory = dependencies.issuerFactory ?? getMediaUploadUrlIssuer
  const requestSchema = buildCreateMediaUploadRequestSchema()
  let cachedIssuer: MediaUploadUrlIssuer | undefined

  function getIssuer(): MediaUploadUrlIssuer {
    cachedIssuer ??= issuerFactory()
    return cachedIssuer
  }

  return async function mediaUploadUrlHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const authenticatedUser = context.auth?.user
    if (
      !authenticatedUser ||
      !allowedUserStatuses.has(authenticatedUser.status)
    ) {
      return createErrorResponse(403, {
        code: 'auth.forbidden',
        message:
          'The authenticated user must have an active or pending profile before requesting media uploads.',
      })
    }

    let issuer: MediaUploadUrlIssuer

    try {
      issuer = getIssuer()
    } catch (error) {
      context.log('Failed to configure the media upload service.', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown media upload configuration error.',
      })

      return createErrorResponse(500, {
        code: 'server.configuration_error',
        message: 'The media upload service is not configured.',
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
        errors: mapCreateMediaUploadValidationIssues(parsedBody.error.issues),
      })
    }

    try {
      const upload = await issuer(authenticatedUser, parsedBody.data)

      context.log('Issued a media upload URL.', {
        authorId: authenticatedUser.id,
        blobName: upload.blobName,
        containerName: upload.containerName,
        kind: upload.kind,
      })

      return createSuccessResponse(upload)
    } catch (error) {
      if (error instanceof UnsupportedMediaContentTypeError) {
        return createErrorResponse(error.status, {
          code: error.code,
          field: error.field,
          message: `${error.message} Allowed types: ${error.allowedContentTypes.join(', ')}.`,
        })
      }

      if (error instanceof MediaFileTooLargeError) {
        return createErrorResponse(error.status, {
          code: error.code,
          field: error.field,
          message: `The uploaded ${error.kind} exceeds the ${error.maxSizeBytes}-byte limit.`,
        })
      }

      if (error instanceof MediaDurationTooLongError) {
        return createErrorResponse(error.status, {
          code: error.code,
          field: error.field,
          message: `The uploaded ${error.kind} exceeds the ${error.maxDurationSeconds}-second duration limit.`,
        })
      }

      context.log('Failed to issue a media upload URL.', {
        authorId: authenticatedUser.id,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown media upload issuance error.',
      })

      return createErrorResponse(500, {
        code: 'server.media_upload_url_failed',
        message: 'Unable to create the media upload URL.',
      })
    }
  }
}

export const mediaUploadUrlHandler = withHttpAuth(
  withRateLimit(buildMediaUploadUrlHandler(), {
    endpointClass: 'media',
  }),
)

export function registerMediaUploadUrlFunction() {
  app.http('mediaUploadUrl', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'media/upload-url',
    handler: mediaUploadUrlHandler,
  })
}
