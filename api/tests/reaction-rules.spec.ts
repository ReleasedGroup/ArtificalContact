import { describe, expect, it } from 'vitest'
import {
  applyReactionRequestToState,
  createReactionPolicy,
  isReactionStateEmpty,
  normalizeReactionState,
  ReactionPolicyConflictError,
  removeReactionFromState,
} from '../src/lib/reaction-rules.js'

describe('normalizeReactionState', () => {
  it('normalizes empty or malformed state shapes', () => {
    expect(
      normalizeReactionState({
        sentiment: 'other' as 'like',
        emojiValues: ['🎉', '', '  ', '🔥', '🎉', 42] as unknown as string[],
        gifValue: '  gif://party  ',
      }),
    ).toEqual({
      sentiment: null,
      emojiValues: ['🎉', '🔥'],
      gifValue: 'gif://party',
    })
  })

  it('identifies when a normalized reaction state is empty', () => {
    expect(isReactionStateEmpty(undefined)).toBe(true)
    expect(
      isReactionStateEmpty({
        sentiment: 'like',
        emojiValues: [],
        gifValue: null,
      }),
    ).toBe(false)
  })
})

describe('applyReactionRequestToState', () => {
  it('switches sentiment while preserving allowed emoji and gif values', () => {
    const plan = applyReactionRequestToState(
      {
        sentiment: 'dislike',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
      },
      { type: 'like' },
    )

    expect(plan).toMatchObject({
      changed: true,
      nextState: {
        sentiment: 'like',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
      },
      added: [{ type: 'like' }],
      removed: [{ type: 'dislike' }],
    })
  })

  it('rejects emoji requests when sentiment coexistence is disabled', () => {
    const policy = createReactionPolicy({
      allowEmojiWithSentiment: false,
    })
    const attempt = () =>
      applyReactionRequestToState(
        {
          sentiment: 'like',
          emojiValues: [],
          gifValue: null,
        },
        { type: 'emoji', value: '🔥' },
        policy,
      )

    expect(attempt).toThrowError(ReactionPolicyConflictError)
    expect(attempt).toThrowError(
      'Emoji reactions cannot be combined with like or dislike.',
    )
  })

  it('rejects sentiment requests when emoji coexistence is disabled', () => {
    const policy = createReactionPolicy({
      allowEmojiWithSentiment: false,
    })
    const attempt = () =>
      applyReactionRequestToState(
        {
          sentiment: null,
          emojiValues: ['🎉'],
          gifValue: null,
        },
        { type: 'like' },
        policy,
      )

    expect(attempt).toThrowError(ReactionPolicyConflictError)
    expect(attempt).toThrowError(
      'Like and dislike cannot be combined with emoji reactions.',
    )
  })

  it('rejects emoji requests when gif coexistence is disabled', () => {
    const policy = createReactionPolicy({
      allowGifWithEmoji: false,
    })
    const attempt = () =>
      applyReactionRequestToState(
        {
          sentiment: null,
          emojiValues: [],
          gifValue: 'gif://party',
        },
        { type: 'emoji', value: '🎉' },
        policy,
      )

    expect(attempt).toThrowError(ReactionPolicyConflictError)
    expect(attempt).toThrowError(
      'Emoji reactions cannot be combined with GIF reactions.',
    )
  })

  it('can replace existing emoji values when multiple emoji values are disabled', () => {
    const policy = createReactionPolicy({
      allowMultipleEmojiValues: false,
    })
    const plan = applyReactionRequestToState(
      {
        sentiment: null,
        emojiValues: ['🎉', '🔥'],
        gifValue: null,
      },
      { type: 'emoji', value: '👏' },
      policy,
    )

    expect(plan).toMatchObject({
      changed: true,
      nextState: {
        sentiment: null,
        emojiValues: ['👏'],
        gifValue: null,
      },
      added: [{ type: 'emoji', value: '👏' }],
      removed: [
        { type: 'emoji', value: '🎉' },
        { type: 'emoji', value: '🔥' },
      ],
    })
  })
})

describe('removeReactionFromState', () => {
  it('removes a specific emoji value without disturbing the rest of the state', () => {
    const plan = removeReactionFromState(
      {
        sentiment: 'like',
        emojiValues: ['🎉', '🔥'],
        gifValue: 'gif://party',
      },
      {
        type: 'emoji',
        value: '🔥',
      },
    )

    expect(plan).toMatchObject({
      changed: true,
      nextState: {
        sentiment: 'like',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
      },
      removed: [{ type: 'emoji', value: '🔥' }],
    })
  })

  it('clears the stored gif reaction', () => {
    const plan = removeReactionFromState(
      {
        sentiment: null,
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
      },
      {
        type: 'gif',
      },
    )

    expect(plan).toMatchObject({
      changed: true,
      nextState: {
        sentiment: null,
        emojiValues: ['🎉'],
        gifValue: null,
      },
      removed: [{ type: 'gif', value: 'gif://party' }],
    })
  })
})
