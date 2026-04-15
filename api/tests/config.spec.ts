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
    })

    expect(config.buildSha).toBe('sha-1234')
    expect(config.region).toBe('australiaeast')
    expect(config.cosmosDatabaseName).toBe('acn')
    expect(config.cosmosEndpoint).toBe('https://cosmos.example')
  })

  it('falls back to the legacy COSMOS_ENDPOINT setting when the connection prefix is absent', () => {
    const config = getEnvironmentConfig({
      COSMOS_ENDPOINT: 'https://legacy-cosmos.example',
    })

    expect(config.cosmosEndpoint).toBe('https://legacy-cosmos.example')
  })
})
