import { describe, expect, it } from 'vitest'
import {
  buildCreateReplyRequestSchema,
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

  it('rejects values above Number.MAX_SAFE_INTEGER', () => {
    expect(() =>
      resolvePostMaxLength({
        POST_MAX_LENGTH: String(Number.MAX_SAFE_INTEGER + 1),
      }),
    ).toThrowError('POST_MAX_LENGTH must be a positive integer.')
  })
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

  it('supports route-safe handles that include dots and slashes', () => {
    expect(
      extractMentions(
        'Thanks @ada.lovelace and @github/openai-cookbook for the examples.',
      ),
    ).toEqual(['ada.lovelace', 'github/openai-cookbook'])
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

describe('buildCreateReplyRequestSchema', () => {
  it('accepts a GIF-only reply and normalizes the stored media payload', () => {
    const result = buildCreateReplyRequestSchema(280).parse({
      media: [
        {
          id: 'tenor-123',
          kind: 'gif',
          url: 'https://media.tenor.com/full.gif',
          thumbUrl: 'https://media.tenor.com/tiny.gif',
          width: 320,
          height: 240,
        },
      ],
    })

    expect(result).toEqual({
      text: '',
      hashtags: [],
      mentions: [],
      media: [
        {
          id: 'tenor-123',
          kind: 'gif',
          url: 'https://media.tenor.com/full.gif',
          thumbUrl: 'https://media.tenor.com/tiny.gif',
          width: 320,
          height: 240,
        },
      ],
    })
  })

  it.each([
    ['url', 'http://media.tenor.com/full.gif'],
    ['url', 'https://example.com/full.gif'],
    ['thumbUrl', 'http://media.tenor.com/tiny.gif'],
    ['thumbUrl', 'https://example.com/tiny.gif'],
  ])(
    'rejects reply GIF %s values outside HTTPS Tenor hosts',
    (field, invalidUrl) => {
      const result = buildCreateReplyRequestSchema(280).safeParse({
        media: [
          {
            id: 'tenor-123',
            kind: 'gif',
            url: 'https://media.tenor.com/full.gif',
            thumbUrl: 'https://media.tenor.com/tiny.gif',
            [field]: invalidUrl,
          },
        ],
      })

      expect(result.success).toBe(false)
      if (result.success) {
        throw new Error('Expected validation failure for an invalid GIF URL.')
      }

      expect(result.error.issues[0]?.path).toEqual(['media', 0, field])
      expect(result.error.issues[0]?.message).toContain(
        'must use an https://*.tenor.com URL.',
      )
    },
  )

  it('rejects replies that omit both text and a GIF', () => {
    const result = buildCreateReplyRequestSchema(280).safeParse({
      text: '   ',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected validation failure for an empty reply.')
    }

    expect(result.error.issues[0]?.message).toBe(
      'A reply must include text or a GIF.',
    )
    expect(result.error.issues[0]?.path).toEqual(['text'])
  })
})
