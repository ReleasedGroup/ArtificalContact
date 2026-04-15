export type ComposerSegmentKind = 'text' | 'hashtag' | 'mention'

export interface ComposerSegment {
  kind: ComposerSegmentKind
  text: string
}

const composerTokenPattern =
  /(?<![A-Za-z0-9_])(?:#([A-Za-z0-9_]+)|@([A-Za-z0-9._/-]+))/g

export function getComposerSegments(text: string): ComposerSegment[] {
  if (text.length === 0) {
    return []
  }

  const segments: ComposerSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(composerTokenPattern)) {
    const [token] = match
    const index = match.index ?? 0

    if (index > lastIndex) {
      segments.push({
        kind: 'text',
        text: text.slice(lastIndex, index),
      })
    }

    segments.push({
      kind: match[1] ? 'hashtag' : 'mention',
      text: token,
    })

    lastIndex = index + token.length
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      text: text.slice(lastIndex),
    })
  }

  return segments
}

export function isComposerTextEmpty(text: string): boolean {
  return text.trim().length === 0
}
