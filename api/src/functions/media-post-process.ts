import '@azure/functions-extensions-blob'
import { app, type InvocationContext } from '@azure/functions'
import type { StorageBlobClient } from '@azure/functions-extensions-blob'
import { getEnvironmentConfig } from '../lib/config.js'
import { CosmosMediaStore, type MediaStore } from '../lib/media.js'
import {
  AzureContentSafetyScanner,
  DefaultMediaVisualGenerator,
  processMediaBlob,
  type ContentSafetyScanner,
  type MediaVisualGenerator,
} from '../lib/media-post-process.js'

type SupportedMediaContainer = 'images' | 'video' | 'audio' | 'gif'

let cachedMediaStore: MediaStore | undefined
let cachedVisualGenerator: MediaVisualGenerator | undefined
let cachedContentSafetyScanner: ContentSafetyScanner | undefined

function getMediaStore(): MediaStore {
  cachedMediaStore ??= CosmosMediaStore.fromEnvironment()
  return cachedMediaStore
}

function getMediaVisualGenerator(): MediaVisualGenerator {
  cachedVisualGenerator ??= new DefaultMediaVisualGenerator(
    getEnvironmentConfig().ffmpegPath,
  )
  return cachedVisualGenerator
}

function getContentSafetyScanner(): ContentSafetyScanner {
  if (cachedContentSafetyScanner === undefined) {
    const config = getEnvironmentConfig()

    cachedContentSafetyScanner = new AzureContentSafetyScanner({
      endpoint: config.contentSafetyEndpoint,
      key: config.contentSafetyKey,
      threshold: config.contentSafetyThreshold,
    })
  }

  return cachedContentSafetyScanner
}

export interface MediaPostProcessDependencies {
  mediaStoreFactory?: () => MediaStore
  mediaVisualGeneratorFactory?: () => MediaVisualGenerator
  contentSafetyScannerFactory?: () => ContentSafetyScanner
  publicBaseUrl?: string | undefined
  now?: (() => Date) | undefined
}

export function buildMediaPostProcessFn(
  _containerName: SupportedMediaContainer,
  dependencies: MediaPostProcessDependencies = {},
) {
  const mediaStoreFactory = dependencies.mediaStoreFactory ?? getMediaStore
  const mediaVisualGeneratorFactory =
    dependencies.mediaVisualGeneratorFactory ?? getMediaVisualGenerator
  const contentSafetyScannerFactory =
    dependencies.contentSafetyScannerFactory ?? getContentSafetyScanner

  return async function mediaPostProcessFn(
    blob: StorageBlobClient,
    context: InvocationContext,
  ): Promise<void> {
    await processMediaBlob(
      blob,
      {
        mediaStore: mediaStoreFactory(),
        mediaVisualGenerator: mediaVisualGeneratorFactory(),
        contentSafetyScanner: contentSafetyScannerFactory(),
        publicBaseUrl:
          dependencies.publicBaseUrl ?? getEnvironmentConfig().mediaBaseUrl,
        now: dependencies.now,
      },
      context,
    )
  }
}

export function registerMediaPostProcessFunctions() {
  const registrations: Array<{
    functionName: string
    containerName: SupportedMediaContainer
  }> = [
    {
      functionName: 'mediaPostProcessImagesFn',
      containerName: 'images',
    },
    {
      functionName: 'mediaPostProcessVideoFn',
      containerName: 'video',
    },
    {
      functionName: 'mediaPostProcessAudioFn',
      containerName: 'audio',
    },
    {
      functionName: 'mediaPostProcessGifFn',
      containerName: 'gif',
    },
  ]

  for (const registration of registrations) {
    app.storageBlob(registration.functionName, {
      path: `${registration.containerName}/{name}`,
      connection: 'AzureWebJobsStorage',
      sdkBinding: true,
      handler: buildMediaPostProcessFn(registration.containerName),
    })
  }
}
