import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { buildHealthHandler } from '../src/functions/health.js'
import { createHealthReport } from '../src/lib/health.js'

describe('createHealthReport', () => {
  it('returns build metadata and the Cosmos ping result', async () => {
    const report = await createHealthReport({
      now: () => new Date('2026-04-15T00:00:00.000Z'),
      environment: {
        serviceName: 'artificialcontact-api',
        buildSha: 'sha-1234',
        region: 'australiaeast',
        cosmosConnectionString: undefined,
        cosmosDatabaseName: 'acn',
        cosmosEndpoint: undefined,
        mediaBaseUrl: undefined,
        mediaContainerName: undefined,
        contentSafetyEndpoint: undefined,
        contentSafetyKey: undefined,
        contentSafetyThreshold: 4,
        searchEndpoint: undefined,
        searchPostsIndexName: 'posts-v1',
        searchUsersIndexName: 'users-v1',
        ffmpegPath: undefined,
      },
      cosmosPing: async () => ({
        status: 'ok',
        databaseName: 'acn',
      }),
    })

    expect(report).toEqual({
      data: {
        service: 'artificialcontact-api',
        status: 'ok',
        buildSha: 'sha-1234',
        region: 'australiaeast',
        timestamp: '2026-04-15T00:00:00.000Z',
        cosmos: {
          status: 'ok',
          databaseName: 'acn',
        },
      },
      errors: [],
    })
  })
})

describe('healthHandler', () => {
  it('returns an HTTP 200 response with the health envelope', async () => {
    const handler = buildHealthHandler(async () => ({
      data: {
        service: 'artificialcontact-api',
        status: 'ok',
        buildSha: 'sha-5678',
        region: 'australiaeast',
        timestamp: '2026-04-15T00:00:00.000Z',
        cosmos: {
          status: 'skipped',
          details: 'COSMOS_ENDPOINT is not configured.',
        },
      },
      errors: [],
    }))

    const context = {
      log: vi.fn(),
    } as unknown as InvocationContext

    const response = await handler({} as HttpRequest, context)

    expect(response.status).toBe(200)
    expect(response.jsonBody).toMatchObject({
      data: {
        buildSha: 'sha-5678',
        cosmos: {
          status: 'skipped',
        },
      },
      errors: [],
    })
  })

  it('returns a predictable 500 envelope when the health payload is missing', async () => {
    const handler = buildHealthHandler(async () => ({
      data: null,
      errors: [],
    }))

    const context = {
      log: vi.fn(),
    } as unknown as InvocationContext

    const response = await handler({} as HttpRequest, context)

    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({
      data: null,
      errors: [
        {
          code: 'server.invalid_health_report',
          message: 'The health report payload was not available.',
        },
      ],
    })
  })
})
