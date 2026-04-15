import { readOptionalValue } from './strings.js'

export type ReactionType = 'like' | 'dislike' | 'emoji' | 'gif'
export type ReactionSentiment = 'like' | 'dislike'

export type CreateReactionRequest =
  | { type: 'like' }
  | { type: 'dislike' }
  | { type: 'emoji'; value: string }
  | { type: 'gif'; value: string }

export interface RemoveReactionRequest {
  type: ReactionType
  value?: string | null
}

export interface ReactionState {
  sentiment: ReactionSentiment | null
  emojiValues: string[]
  gifValue: string | null
}

export interface ReactionSelection {
  type: ReactionType
  value?: string
}

export interface ReactionPolicyConfig {
  allowEmojiWithSentiment?: boolean
  allowGifWithSentiment?: boolean
  allowGifWithEmoji?: boolean
  allowMultipleEmojiValues?: boolean
}

export interface ReactionPolicy {
  allowEmojiWithSentiment: boolean
  allowGifWithSentiment: boolean
  allowGifWithEmoji: boolean
  allowMultipleEmojiValues: boolean
}

export interface ReactionStateDiff {
  added: ReactionSelection[]
  removed: ReactionSelection[]
}

export interface ApplyReactionPlan extends ReactionStateDiff {
  changed: boolean
  currentState: ReactionState
  nextState: ReactionState
}

export interface RemoveReactionPlan extends ReactionStateDiff {
  changed: boolean
  currentState: ReactionState
  nextState: ReactionState
}

export class ReactionPolicyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReactionPolicyConflictError'
  }
}

function createReactionSelection(
  type: ReactionType,
  value?: string,
): ReactionSelection {
  return value === undefined ? { type } : { type, value }
}

function buildSelectionKey(selection: ReactionSelection): string {
  return selection.type === 'emoji' || selection.type === 'gif'
    ? `${selection.type}:${selection.value ?? ''}`
    : selection.type
}

function normalizeReactionValue(value?: string | null): string | null {
  return typeof value === 'string' ? (readOptionalValue(value) ?? null) : null
}

function normalizeEmojiValues(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const normalizedValues: string[] = []
  const seenValues = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalizedValue = normalizeReactionValue(value)
    if (!normalizedValue || seenValues.has(normalizedValue)) {
      continue
    }

    seenValues.add(normalizedValue)
    normalizedValues.push(normalizedValue)
  }

  return normalizedValues
}

function cloneReactionState(state: ReactionState): ReactionState {
  return {
    sentiment: state.sentiment,
    emojiValues: [...state.emojiValues],
    gifValue: state.gifValue,
  }
}

function toSelections(state: ReactionState): ReactionSelection[] {
  const selections: ReactionSelection[] = []

  if (state.sentiment !== null) {
    selections.push(createReactionSelection(state.sentiment))
  }

  for (const emojiValue of state.emojiValues) {
    selections.push(createReactionSelection('emoji', emojiValue))
  }

  if (state.gifValue !== null) {
    selections.push(createReactionSelection('gif', state.gifValue))
  }

  return selections
}

function buildStateDiff(
  currentState: ReactionState,
  nextState: ReactionState,
): ReactionStateDiff {
  const currentSelections = toSelections(currentState)
  const nextSelections = toSelections(nextState)
  const currentKeys = new Set(currentSelections.map(buildSelectionKey))
  const nextKeys = new Set(nextSelections.map(buildSelectionKey))

  return {
    added: nextSelections.filter((selection) => {
      return !currentKeys.has(buildSelectionKey(selection))
    }),
    removed: currentSelections.filter((selection) => {
      return !nextKeys.has(buildSelectionKey(selection))
    }),
  }
}

function ensureSentimentAllowed(
  state: ReactionState,
  policy: ReactionPolicy,
): void {
  if (state.emojiValues.length > 0 && !policy.allowEmojiWithSentiment) {
    throw new ReactionPolicyConflictError(
      'Like and dislike cannot be combined with emoji reactions.',
    )
  }

  if (state.gifValue !== null && !policy.allowGifWithSentiment) {
    throw new ReactionPolicyConflictError(
      'Like and dislike cannot be combined with GIF reactions.',
    )
  }
}

function ensureEmojiAllowed(
  state: ReactionState,
  policy: ReactionPolicy,
): void {
  if (state.sentiment !== null && !policy.allowEmojiWithSentiment) {
    throw new ReactionPolicyConflictError(
      'Emoji reactions cannot be combined with like or dislike.',
    )
  }

  if (state.gifValue !== null && !policy.allowGifWithEmoji) {
    throw new ReactionPolicyConflictError(
      'Emoji reactions cannot be combined with GIF reactions.',
    )
  }
}

function ensureGifAllowed(state: ReactionState, policy: ReactionPolicy): void {
  if (state.sentiment !== null && !policy.allowGifWithSentiment) {
    throw new ReactionPolicyConflictError(
      'GIF reactions cannot be combined with like or dislike.',
    )
  }

  if (state.emojiValues.length > 0 && !policy.allowGifWithEmoji) {
    throw new ReactionPolicyConflictError(
      'GIF reactions cannot be combined with emoji reactions.',
    )
  }
}

export function createReactionPolicy(
  config: ReactionPolicyConfig = {},
): ReactionPolicy {
  return Object.freeze({
    allowEmojiWithSentiment: config.allowEmojiWithSentiment ?? true,
    allowGifWithSentiment: config.allowGifWithSentiment ?? true,
    allowGifWithEmoji: config.allowGifWithEmoji ?? true,
    allowMultipleEmojiValues: config.allowMultipleEmojiValues ?? true,
  })
}

export const DEFAULT_REACTION_POLICY = createReactionPolicy()

export function normalizeReactionState(
  state?: Partial<ReactionState> | null,
): ReactionState {
  return {
    sentiment:
      state?.sentiment === 'like' || state?.sentiment === 'dislike'
        ? state.sentiment
        : null,
    emojiValues: normalizeEmojiValues(state?.emojiValues),
    gifValue: normalizeReactionValue(state?.gifValue),
  }
}

export function isReactionStateEmpty(state?: Partial<ReactionState> | null) {
  const normalizedState = normalizeReactionState(state)
  return (
    normalizedState.sentiment === null &&
    normalizedState.emojiValues.length === 0 &&
    normalizedState.gifValue === null
  )
}

export function applyReactionRequestToState(
  currentStateInput: Partial<ReactionState> | null | undefined,
  request: CreateReactionRequest,
  policy: ReactionPolicy = DEFAULT_REACTION_POLICY,
): ApplyReactionPlan {
  const currentState = normalizeReactionState(currentStateInput)
  const nextState = cloneReactionState(currentState)

  switch (request.type) {
    case 'like':
    case 'dislike': {
      ensureSentimentAllowed(currentState, policy)
      nextState.sentiment = request.type
      break
    }
    case 'emoji': {
      const emojiValue = normalizeReactionValue(request.value)
      if (!emojiValue) {
        throw new Error('Emoji reactions require a value.')
      }

      ensureEmojiAllowed(currentState, policy)

      nextState.emojiValues = policy.allowMultipleEmojiValues
        ? normalizeEmojiValues([...nextState.emojiValues, emojiValue])
        : [emojiValue]
      break
    }
    case 'gif': {
      const gifValue = normalizeReactionValue(request.value)
      if (!gifValue) {
        throw new Error('GIF reactions require a value.')
      }

      ensureGifAllowed(currentState, policy)
      nextState.gifValue = gifValue
      break
    }
  }

  const diff = buildStateDiff(currentState, nextState)
  return {
    changed: diff.added.length > 0 || diff.removed.length > 0,
    currentState,
    nextState,
    added: diff.added,
    removed: diff.removed,
  }
}

export function removeReactionFromState(
  currentStateInput: Partial<ReactionState> | null | undefined,
  request: RemoveReactionRequest,
): RemoveReactionPlan {
  const currentState = normalizeReactionState(currentStateInput)
  const nextState = cloneReactionState(currentState)

  switch (request.type) {
    case 'like':
    case 'dislike': {
      if (nextState.sentiment === request.type) {
        nextState.sentiment = null
      }
      break
    }
    case 'emoji': {
      const emojiValue = normalizeReactionValue(request.value)
      nextState.emojiValues = emojiValue
        ? nextState.emojiValues.filter(
            (existingEmoji) => existingEmoji !== emojiValue,
          )
        : []
      break
    }
    case 'gif': {
      const gifValue = normalizeReactionValue(request.value)

      if (gifValue === null || nextState.gifValue === gifValue) {
        nextState.gifValue = null
      }
      break
    }
  }

  const diff = buildStateDiff(currentState, nextState)
  return {
    changed: diff.added.length > 0 || diff.removed.length > 0,
    currentState,
    nextState,
    added: diff.added,
    removed: diff.removed,
  }
}
