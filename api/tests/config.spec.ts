import { describe, expect, it } from 'vitest'
import { API_BUILD_SHA } from '../src/build-meta.generated.js'
import { getEnvironmentConfig } from '../src/lib/config.js'

describe('getEnvironmentConfig', () => {
  it('falls back to generated build metadata and local region defaults', () => {
    const config = getEnvironmentConfig({})

    expect(config.buildSha).toBe(API_BUILD_SHA)
    expect(config.region).toBe('local')
    expect(config.serviceName).toBe('artificialcontact-api')
  })

  it('uses explicit environment values when they are provided', () => {
    const config = getEnvironmentConfig({
      AZURE_REGION: 'australiaeast',
      BUILD_SHA: 'sha-1234',
      COSMOS_DATABASE_NAME: 'acn',
      COSMOS_CONNECTION__accountEndpoint: 'https://cosmos.example',
      MEDIA_BASE_URL: 'https://cdn.example.com',
      MEDIA_CONTAINER_NAME: 'media',
      CONTENT_SAFETY_ENDPOINT: 'https://safety.example.com',
      CONTENT_SAFETY_KEY: 'secret-key',
      CONTENT_SAFETY_THRESHOLD: '6',
      FFMPEG_PATH: '/tools/ffmpeg',
    })

    expect(config.buildSha).toBe('sha-1234')
    expect(config.region).toBe('australiaeast')
    expect(config.cosmosDatabaseName).toBe('acn')
    expect(config.cosmosEndpoint).toBe('https://cosmos.example')
    expect(config.mediaBaseUrl).toBe('https://cdn.example.com')
    expect(config.mediaContainerName).toBe('media')
    expect(config.contentSafetyEndpoint).toBe('https://safety.example.com')
    expect(config.contentSafetyKey).toBe('secret-key')
    expect(config.contentSafetyThreshold).toBe(6)
    expect(config.ffmpegPath).toBe('/tools/ffmpeg')
  })

  it('falls back to the legacy COSMOS_ENDPOINT setting when the connection prefix is absent', () => {
    const config = getEnvironmentConfig({
      COSMOS_ENDPOINT: 'https://legacy-cosmos.example',
    })

    expect(config.cosmosEndpoint).toBe('https://legacy-cosmos.example')
  })

  it('clamps invalid content safety threshold values to the supported range', () => {
    const invalidThreshold = getEnvironmentConfig({
      CONTENT_SAFETY_THRESHOLD: 'nan',
    })
    const highThreshold = getEnvironmentConfig({
      CONTENT_SAFETY_THRESHOLD: '99',
    })

    expect(invalidThreshold.contentSafetyThreshold).toBe(4)
    expect(highThreshold.contentSafetyThreshold).toBe(7)
  })
})
