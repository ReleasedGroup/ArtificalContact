import { describe, expect, it } from 'vitest'
import { getComposerSegments, isComposerTextEmpty } from './composer'

describe('composer helpers', () => {
  it('highlights hashtags and mentions while preserving surrounding text', () => {
    expect(
      getComposerSegments('Shipping #PromptOps notes to @ada before stand-up.'),
    ).toEqual([
      { kind: 'text', text: 'Shipping ' },
      { kind: 'hashtag', text: '#PromptOps' },
      { kind: 'text', text: ' notes to ' },
      { kind: 'mention', text: '@ada' },
      { kind: 'text', text: ' before stand-up.' },
    ])
  })

  it('ignores inline tokens and email addresses', () => {
    expect(
      getComposerSegments(
        'ops#broken hi@example.com and path/to@token stay plain',
      ),
    ).toEqual([
      {
        kind: 'text',
        text: 'ops#broken hi@example.com and path/to@token stay plain',
      },
    ])
  })

  it('treats whitespace-only input as empty', () => {
    expect(isComposerTextEmpty('   \n  ')).toBe(true)
    expect(isComposerTextEmpty('  #launch  ')).toBe(false)
  })
})
