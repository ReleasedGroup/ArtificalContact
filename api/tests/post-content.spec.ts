import { describe, expect, it } from 'vitest'
import {
  buildPostContentSchema,
  DEFAULT_POST_MAX_LENGTH,
  extractHashtags,
  extractMentions,
  resolvePostMaxLength,
} from '../src/lib/posts.js'

describe('resolvePostMaxLength', () => {
  it('uses the default when the environment variable is unset', () => {
    expect(resolvePostMaxLength({})).toBe(DEFAULT_POST_MAX_LENGTH)
  })

  it('accepts a configured positive integer', () => {
    expect(resolvePostMaxLength({ POST_MAX_LENGTH: '500' })).toBe(500)
  })

  it.each(['0', '-1', '280abc', '280.5'])(
    'rejects an invalid configured value of %s',
    (configuredValue) => {
      expect(() =>
        resolvePostMaxLength({ POST_MAX_LENGTH: configuredValue }),
      ).toThrowError('POST_MAX_LENGTH must be a positive integer.')
    },
  )
})

describe('extractHashtags', () => {
  it('returns unique lowercase hashtags in first-seen order', () => {
    expect(
      extractHashtags(
        'Shipping #Azure today with #AI, #azure, C# and foo#bar.',
      ),
    ).toEqual(['azure', 'ai'])
  })
})

describe('extractMentions', () => {
  it('returns unique lowercase mentions while ignoring emails and inline tokens', () => {
    expect(
      extractMentions(
        'Ping @Ada and @grace, then email ada@example.com or foo@bar.',
      ),
    ).toEqual(['ada', 'grace'])
  })
})

describe('buildPostContentSchema', () => {
  it('trims text and parses hashtags and mentions into the stored document shape', () => {
    const result = buildPostContentSchema().parse({
      text: '  Shipping #Azure with @Ada today. Contact ada@example.com and revisit #azure.  ',
    })

    expect(result).toEqual({
      text: 'Shipping #Azure with @Ada today. Contact ada@example.com and revisit #azure.',
      hashtags: ['azure'],
      mentions: ['ada'],
    })
  })

  it('rejects text longer than the configured maximum', () => {
    const result = buildPostContentSchema(5).safeParse({
      text: '  abcdef  ',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected validation failure for oversized post text.')
    }

    expect(result.error.issues).toHaveLength(1)
    expect(result.error.issues[0]?.path).toEqual(['text'])
  })
})
