import { describe, expect, it } from 'vitest'
import { getEnvironmentConfig } from '../src/lib/config.js'

describe('getEnvironmentConfig', () => {
  it('falls back to generated build metadata and local region defaults', () => {
    const config = getEnvironmentConfig({})

    expect(config.buildSha).toBe('local-dev')
    expect(config.region).toBe('local')
    expect(config.serviceName).toBe('artificialcontact-api')
  })

  it('uses explicit environment values when they are provided', () => {
    const config = getEnvironmentConfig({
      AZURE_REGION: 'australiaeast',
      BUILD_SHA: 'sha-1234',
      COSMOS_DATABASE_NAME: 'acn',
      COSMOS_ENDPOINT: 'https://cosmos.example',
    })

    expect(config.buildSha).toBe('sha-1234')
    expect(config.region).toBe('australiaeast')
    expect(config.cosmosDatabaseName).toBe('acn')
    expect(config.cosmosEndpoint).toBe('https://cosmos.example')
  })
})
