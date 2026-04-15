import { AsyncLocalStorage } from 'node:async_hooks'
import type { HttpRequest, InvocationContext } from '@azure/functions'

interface RequestMetricsContextValue {
  endpoint: string
}

const requestMetricsStorage =
  new AsyncLocalStorage<RequestMetricsContextValue>()

function normalizeEndpointName(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : 'unknown'
}

function readInvocationFunctionName(
  context: InvocationContext,
): string | undefined {
  const record = context as unknown as Record<string, unknown>
  const functionName = record.functionName
  return typeof functionName === 'string' ? functionName : undefined
}

export function getRequestMetricsEndpoint(): string | null {
  return requestMetricsStorage.getStore()?.endpoint ?? null
}

export function runWithRequestMetricsContext<T>(
  endpoint: string,
  callback: () => T,
): T {
  return requestMetricsStorage.run(
    {
      endpoint: normalizeEndpointName(endpoint),
    },
    callback,
  )
}

export function withRequestMetricsContext<
  THandler extends (
    request: HttpRequest,
    context: InvocationContext,
  ) => unknown,
>(handler: THandler, endpointName?: string): THandler {
  return function requestMetricsContextHandler(
    request: HttpRequest,
    context: InvocationContext,
  ) {
    return runWithRequestMetricsContext(
      readInvocationFunctionName(context) ?? endpointName ?? 'unknown',
      () => handler(request, context),
    )
  } as THandler
}
