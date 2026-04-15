import { describe, expect, it } from 'vitest'
import {
  applyReactionDeletion,
  applyReactionMutation,
  buildCreateReactionRequestSchema,
  type ReactionDocument,
} from '../src/lib/reactions.js'

function createStoredReaction(
  overrides: Partial<ReactionDocument> = {},
): ReactionDocument {
  return {
    id: 'post-1:user-1',
    type: 'reaction',
    postId: 'post-1',
    userId: 'user-1',
    sentiment: null,
    emojiValues: [],
    gifValue: null,
    createdAt: '2026-04-15T04:00:00.000Z',
    updatedAt: '2026-04-15T04:00:00.000Z',
    ...overrides,
  }
}

describe('buildCreateReactionRequestSchema', () => {
  it('accepts emoji and gif reactions with trimmed values', () => {
    const schema = buildCreateReactionRequestSchema()

    expect(
      schema.parse({
        type: 'emoji',
        value: '  🎉  ',
      }),
    ).toEqual({
      type: 'emoji',
      value: '🎉',
    })

    expect(
      schema.parse({
        type: 'gif',
        value: '  https://cdn.example.com/reaction.gif  ',
      }),
    ).toEqual({
      type: 'gif',
      value: 'https://cdn.example.com/reaction.gif',
    })
  })

  it('rejects missing emoji values and extra like/dislike values', () => {
    const schema = buildCreateReactionRequestSchema()

    const missingEmojiValue = schema.safeParse({
      type: 'emoji',
    })
    expect(missingEmojiValue.success).toBe(false)
    expect(missingEmojiValue.error?.issues[0]?.message).toBe(
      'Emoji reactions require a value.',
    )

    const likeWithValue = schema.safeParse({
      type: 'like',
      value: 'unexpected',
    })
    expect(likeWithValue.success).toBe(false)
    expect(likeWithValue.error?.issues[0]?.message).toBe(
      'Like and dislike reactions do not accept a value.',
    )
  })

  it('does not silently drop non-string values during preprocessing', () => {
    const schema = buildCreateReactionRequestSchema()

    const result = schema.safeParse({
      type: 'like',
      value: 0,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Invalid input: expected string, received number',
    )
  })
})

describe('applyReactionMutation', () => {
  it('creates a new sentiment reaction document for first-time likes', () => {
    const result = applyReactionMutation(
      null,
      { type: 'like' },
      {
        postId: 'post-1',
        userId: 'user-1',
        now: new Date('2026-04-15T04:00:00.000Z'),
      },
    )

    expect(result).toEqual({
      created: true,
      changed: true,
      reaction: createStoredReaction({
        sentiment: 'like',
      }),
    })
  })

  it('switches sentiment while preserving additive emoji and gif values', () => {
    const result = applyReactionMutation(
      createStoredReaction({
        sentiment: 'dislike',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
      }),
      { type: 'like' },
      {
        postId: 'post-1',
        userId: 'user-1',
        now: new Date('2026-04-15T05:00:00.000Z'),
      },
    )

    expect(result).toEqual({
      created: false,
      changed: true,
      reaction: createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🎉'],
        gifValue: 'gif://party',
        updatedAt: '2026-04-15T05:00:00.000Z',
      }),
    })
  })

  it('adds unique emoji values idempotently', () => {
    const existingReaction = createStoredReaction({
      emojiValues: ['🎉'],
      updatedAt: '2026-04-15T04:30:00.000Z',
    })

    const duplicateResult = applyReactionMutation(
      existingReaction,
      { type: 'emoji', value: '🎉' },
      {
        postId: 'post-1',
        userId: 'user-1',
        now: new Date('2026-04-15T05:00:00.000Z'),
      },
    )
    expect(duplicateResult).toEqual({
      created: false,
      changed: false,
      reaction: existingReaction,
    })

    const additiveResult = applyReactionMutation(
      existingReaction,
      { type: 'emoji', value: '🔥' },
      {
        postId: 'post-1',
        userId: 'user-1',
        now: new Date('2026-04-15T05:30:00.000Z'),
      },
    )
    expect(additiveResult).toEqual({
      created: false,
      changed: true,
      reaction: createStoredReaction({
        emojiValues: ['🎉', '🔥'],
        updatedAt: '2026-04-15T05:30:00.000Z',
      }),
    })
  })

  it('replaces the stored gif value when a new gif reaction is posted', () => {
    const result = applyReactionMutation(
      createStoredReaction({
        gifValue: 'gif://old',
      }),
      { type: 'gif', value: 'gif://new' },
      {
        postId: 'post-1',
        userId: 'user-1',
        now: new Date('2026-04-15T06:00:00.000Z'),
      },
    )

    expect(result).toEqual({
      created: false,
      changed: true,
      reaction: createStoredReaction({
        gifValue: 'gif://new',
        updatedAt: '2026-04-15T06:00:00.000Z',
      }),
    })
  })
})

describe('applyReactionDeletion', () => {
  it('deletes the whole reaction document when no emoji selector is provided', () => {
    const result = applyReactionDeletion(createStoredReaction(), {
      now: new Date('2026-04-15T07:00:00.000Z'),
    })

    expect(result).toEqual({
      changed: true,
      deleted: true,
      reaction: null,
      emojiValueRemoved: false,
    })
  })

  it('removes a selected emoji while preserving other reaction state', () => {
    const result = applyReactionDeletion(
      createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🎉', '🔥'],
        gifValue: 'gif://party',
      }),
      {
        now: new Date('2026-04-15T07:05:00.000Z'),
        emojiValue: '🎉',
      },
    )

    expect(result).toEqual({
      changed: true,
      deleted: false,
      reaction: createStoredReaction({
        sentiment: 'like',
        emojiValues: ['🔥'],
        gifValue: 'gif://party',
        updatedAt: '2026-04-15T07:05:00.000Z',
      }),
      emojiValueRemoved: true,
    })
  })

  it('deletes the reaction document when the last emoji is removed', () => {
    const result = applyReactionDeletion(
      createStoredReaction({
        emojiValues: ['🎉'],
      }),
      {
        now: new Date('2026-04-15T07:10:00.000Z'),
        emojiValue: '🎉',
      },
    )

    expect(result).toEqual({
      changed: true,
      deleted: true,
      reaction: null,
      emojiValueRemoved: true,
    })
  })

  it('treats missing reactions or missing emoji values as no-ops', () => {
    expect(
      applyReactionDeletion(null, {
        now: new Date('2026-04-15T07:15:00.000Z'),
      }),
    ).toEqual({
      changed: false,
      deleted: false,
      reaction: null,
      emojiValueRemoved: false,
    })

    const existingReaction = createStoredReaction({
      emojiValues: ['🎉'],
    })

    expect(
      applyReactionDeletion(existingReaction, {
        now: new Date('2026-04-15T07:20:00.000Z'),
        emojiValue: '🔥',
      }),
    ).toEqual({
      changed: false,
      deleted: false,
      reaction: existingReaction,
      emojiValueRemoved: false,
    })
  })
})
