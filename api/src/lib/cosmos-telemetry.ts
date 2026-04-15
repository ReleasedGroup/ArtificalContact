import { Item, Items } from '@azure/cosmos'
import { getRequestMetricsEndpoint } from './request-metrics-context.js'
import { trackCosmosRuConsumed } from './telemetry.js'

const wrappedIteratorFlag = Symbol('wrapped-cosmos-query-iterator')

let telemetryPatched = false

function normalizeContainerName(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'unknown'
}

function readContainerName(target: Record<string, unknown>): string {
  if (typeof target.container !== 'object' || target.container === null) {
    return 'unknown'
  }

  const containerRecord = target.container as Record<string, unknown>
  return normalizeContainerName(containerRecord.id)
}

function recordRequestCharge(
  response: unknown,
  containerName: string,
  operationClass: string,
) {
  if (typeof response !== 'object' || response === null) {
    return
  }

  const record = response as Record<string, unknown>
  const requestCharge = record.requestCharge
  if (typeof requestCharge !== 'number' || !Number.isFinite(requestCharge)) {
    return
  }

  trackCosmosRuConsumed(requestCharge, {
    container: containerName,
    endpoint: getRequestMetricsEndpoint() ?? 'background',
    operationClass,
  })
}

function wrapQueryIterator(
  iterator: unknown,
  containerName: string,
  operationClass: string,
) {
  if (typeof iterator !== 'object' || iterator === null) {
    return iterator
  }

  const iteratorRecord = iterator as Record<PropertyKey, unknown>
  if (iteratorRecord[wrappedIteratorFlag]) {
    return iterator
  }

  const fetchNext = iteratorRecord.fetchNext
  if (typeof fetchNext === 'function') {
    iteratorRecord.fetchNext = async (...args: unknown[]) => {
      const response = await fetchNext.apply(iterator, args)
      recordRequestCharge(response, containerName, operationClass)
      return response
    }
  }

  const fetchAll = iteratorRecord.fetchAll
  if (typeof fetchAll === 'function') {
    iteratorRecord.fetchAll = async (...args: unknown[]) => {
      const response = await fetchAll.apply(iterator, args)
      recordRequestCharge(response, containerName, operationClass)
      return response
    }
  }

  iteratorRecord[wrappedIteratorFlag] = true
  return iterator
}

function patchAsyncMethod(
  prototype: Record<string, unknown>,
  methodName: string,
  operationClass: string,
  containerSelector: (target: Record<string, unknown>) => string,
) {
  const originalMethod = prototype[methodName]
  if (typeof originalMethod !== 'function') {
    return
  }

  prototype[methodName] = async function patchedMethod(
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    const response = await originalMethod.apply(this, args)
    recordRequestCharge(response, containerSelector(this), operationClass)
    return response
  }
}

export function ensureCosmosTelemetryPatched(): void {
  if (telemetryPatched) {
    return
  }

  telemetryPatched = true

  patchAsyncMethod(
    Items.prototype as unknown as Record<string, unknown>,
    'create',
    'create',
    readContainerName,
  )
  patchAsyncMethod(
    Items.prototype as unknown as Record<string, unknown>,
    'upsert',
    'upsert',
    readContainerName,
  )
  patchAsyncMethod(
    Items.prototype as unknown as Record<string, unknown>,
    'read',
    'read',
    readContainerName,
  )
  patchAsyncMethod(
    Item.prototype as unknown as Record<string, unknown>,
    'delete',
    'delete',
    readContainerName,
  )
  patchAsyncMethod(
    Item.prototype as unknown as Record<string, unknown>,
    'patch',
    'patch',
    readContainerName,
  )
  patchAsyncMethod(
    Item.prototype as unknown as Record<string, unknown>,
    'replace',
    'replace',
    readContainerName,
  )

  const itemsPrototype = Items.prototype as unknown as Record<string, unknown>
  const originalQuery = itemsPrototype.query
  if (typeof originalQuery === 'function') {
    itemsPrototype.query = function patchedQuery(
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      const iterator = originalQuery.apply(this, args)
      return wrapQueryIterator(iterator, readContainerName(this), 'query')
    }
  }

  const originalReadAll = itemsPrototype.readAll
  if (typeof originalReadAll === 'function') {
    itemsPrototype.readAll = function patchedReadAll(
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      const iterator = originalReadAll.apply(this, args)
      return wrapQueryIterator(iterator, readContainerName(this), 'query')
    }
  }
}
