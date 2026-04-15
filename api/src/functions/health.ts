import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { createHealthReport } from '../lib/health.js'

export function buildHealthHandler(
  reportFactory: typeof createHealthReport = createHealthReport,
) {
  return async function healthHandler(
    _request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const report = await reportFactory()
    const healthPayload = report.data

    if (!healthPayload) {
      throw new Error('Health report did not include a payload.')
    }

    context.log('Health probe completed.', {
      buildSha: healthPayload.buildSha,
      cosmosStatus: healthPayload.cosmos.status,
      region: healthPayload.region,
    })

    return {
      status: 200,
      jsonBody: report,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    }
  }
}

export const healthHandler = buildHealthHandler()

export function registerHealthFunction() {
  app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health',
    handler: healthHandler,
  })
}
