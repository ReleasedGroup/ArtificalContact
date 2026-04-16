export interface KeysetCursorState {
  createdAt: string
  id: string
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function compareByCreatedAtDescThenIdDesc(
  left: KeysetCursorState,
  right: KeysetCursorState,
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt)
  }

  return right.id.localeCompare(left.id)
}

export function parseKeysetCursor(
  cursor: string | undefined,
  prefix: string,
): KeysetCursorState | undefined {
  const normalizedCursor = toNullableString(cursor)
  if (normalizedCursor === null || !normalizedCursor.startsWith(prefix)) {
    return undefined
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        normalizedCursor.slice(prefix.length),
        'base64url',
      ).toString('utf8'),
    ) as {
      createdAt?: unknown
      id?: unknown
    }

    const createdAt = toNullableString(payload.createdAt)
    const id = toNullableString(payload.id)

    if (createdAt === null || id === null) {
      return undefined
    }

    return {
      createdAt,
      id,
    }
  } catch {
    return undefined
  }
}

export function buildKeysetCursor(
  value: KeysetCursorState,
  prefix: string,
): string {
  return (
    prefix +
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  )
}

function isStrictlyAfterCursor(
  value: KeysetCursorState,
  cursor: KeysetCursorState,
): boolean {
  return (
    value.createdAt < cursor.createdAt ||
    (value.createdAt === cursor.createdAt && value.id < cursor.id)
  )
}

export function applyKeysetPagination<T>(
  items: readonly T[],
  options: {
    cursor?: string
    limit: number
    prefix: string
    resolveCursorState: (item: T) => KeysetCursorState | null
  },
): {
  items: T[]
  cursor?: string
} {
  const cursorState = parseKeysetCursor(options.cursor, options.prefix)
  const sortedItems = [...items].sort((left, right) => {
    const leftState = options.resolveCursorState(left)
    const rightState = options.resolveCursorState(right)

    if (leftState === null && rightState === null) {
      return 0
    }

    if (leftState === null) {
      return 1
    }

    if (rightState === null) {
      return -1
    }

    return compareByCreatedAtDescThenIdDesc(leftState, rightState)
  })

  const filteredItems =
    cursorState === undefined
      ? sortedItems
      : sortedItems.filter((item) => {
          const state = options.resolveCursorState(item)
          return state !== null && isStrictlyAfterCursor(state, cursorState)
        })

  const pageItems = filteredItems.slice(0, options.limit)
  const lastItem = pageItems.at(-1)
  const lastItemState =
    lastItem === undefined ? null : options.resolveCursorState(lastItem)

  return {
    items: pageItems,
    ...(filteredItems.length > options.limit &&
    lastItemState !== null
      ? { cursor: buildKeysetCursor(lastItemState, options.prefix) }
      : {}),
  }
}
