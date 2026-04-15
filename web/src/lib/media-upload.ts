interface ApiError {
  code: string
  message: string
  field?: string
}

interface ApiEnvelope<TData> {
  data: TData | null
  errors: ApiError[]
}

export type MediaKind = 'image' | 'gif' | 'audio' | 'video'

export interface CreateMediaUploadRequest {
  kind: MediaKind
  contentType: string
  sizeBytes: number
}

export interface MediaUploadDescriptor {
  kind: MediaKind
  contentType: string
  sizeBytes: number
  containerName: string
  blobName: string
  blobUrl: string
  uploadUrl: string
  expiresAt: string
  method: 'PUT'
  requiredHeaders: {
    'content-type': string
    'x-ms-blob-type': 'BlockBlob'
  }
}

export interface BlobUploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface UploadedBlobResult extends MediaUploadDescriptor {
  etag: string | null
  requestId: string | null
}

export interface UploadMediaFileInput {
  file: File
  kind: MediaKind
  onProgress?: (progress: BlobUploadProgress) => void
  requestMediaUploadUrl?: typeof requestMediaUploadUrl
  signal?: AbortSignal
  xhrFactory?: () => XMLHttpRequest
}

export type UploadMediaFileFn = (
  input: UploadMediaFileInput,
) => Promise<UploadedBlobResult>

async function readEnvelope<TData>(
  response: Response,
  failureFallback: string,
): Promise<ApiEnvelope<TData>> {
  let payload: ApiEnvelope<TData> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<TData>
  } catch {
    if (!response.ok) {
      throw new Error(failureFallback)
    }

    throw new Error('The media upload response was not valid JSON.')
  }

  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message ?? failureFallback)
  }

  return payload
}

function createAbortError(): Error {
  try {
    return new DOMException('The upload was aborted.', 'AbortError')
  } catch {
    return new Error('The upload was aborted.')
  }
}

export async function requestMediaUploadUrl(
  input: CreateMediaUploadRequest,
  signal?: AbortSignal,
): Promise<MediaUploadDescriptor> {
  const response = await fetch('/api/media/upload-url', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
  })

  const payload = await readEnvelope<MediaUploadDescriptor>(
    response,
    `Media upload URL request failed with status ${response.status}.`,
  )

  if (!payload.data) {
    throw new Error('The media upload URL response did not contain a payload.')
  }

  return payload.data
}

export function uploadFileToBlobStorage(
  file: File,
  descriptor: MediaUploadDescriptor,
  options: {
    onProgress?: (progress: BlobUploadProgress) => void
    signal?: AbortSignal
    xhrFactory?: () => XMLHttpRequest
  } = {},
): Promise<UploadedBlobResult> {
  const { onProgress, signal, xhrFactory } = options

  return new Promise<UploadedBlobResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const xhr = xhrFactory ? xhrFactory() : new XMLHttpRequest()

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
    }

    const rejectWith = (error: Error) => {
      cleanup()
      reject(error)
    }

    const handleAbort = () => {
      xhr.abort()
    }

    // The browser still needs XHR here because fetch upload progress is not exposed.
    xhr.upload.addEventListener('progress', (event) => {
      const total =
        event.lengthComputable && event.total > 0 ? event.total : file.size
      const loaded = event.loaded
      const percent =
        total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0

      onProgress?.({
        loaded,
        total,
        percent,
      })
    })

    xhr.addEventListener('load', () => {
      cleanup()

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Blob upload failed with status ${xhr.status}.`))
        return
      }

      resolve({
        ...descriptor,
        etag: xhr.getResponseHeader('etag'),
        requestId: xhr.getResponseHeader('x-ms-request-id'),
      })
    })
    xhr.addEventListener('error', () => {
      rejectWith(new Error('Blob upload failed before the request completed.'))
    })
    xhr.addEventListener('abort', () => {
      rejectWith(createAbortError())
    })

    signal?.addEventListener('abort', handleAbort, { once: true })

    xhr.open(descriptor.method, descriptor.uploadUrl)
    Object.entries(descriptor.requiredHeaders).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value)
    })
    xhr.send(file)
  })
}

export async function uploadMediaFile(
  input: UploadMediaFileInput,
): Promise<UploadedBlobResult> {
  const {
    file,
    kind,
    onProgress,
    requestMediaUploadUrl: requestUploadUrl = requestMediaUploadUrl,
    signal,
    xhrFactory,
  } = input

  const contentType = file.type.trim()
  if (!contentType) {
    throw new Error(
      'The selected file is missing a browser-provided content type.',
    )
  }

  const descriptor = await requestUploadUrl(
    {
      kind,
      contentType,
      sizeBytes: file.size,
    },
    signal,
  )

  return uploadFileToBlobStorage(file, descriptor, {
    onProgress,
    signal,
    xhrFactory,
  })
}
