import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react'
import {
  createReaction,
  deleteReaction,
  type ReactionType,
} from '../lib/reactions'

interface ReactionBarProps {
  canReact: boolean
  dislikesCount: number
  emojiCount: number
  likeCount: number
  onCommitted?: () => void
  postId: string
}

const EMOJI_PICKER_ITEMS = ['😍', '🚀', '👏', '🔥', '🎉', '🤖'] as const

function clampCount(value: number): number {
  return Math.max(0, Math.floor(value))
}

function formatCountValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return String(clampCount(safeValue))
}

function getErrorMessage(error: unknown, action: string): string {
  if (error instanceof Error) {
    return error.message
  }

  return `Unable to ${action} this post.`
}

export function ReactionBar({
  canReact,
  dislikesCount,
  emojiCount,
  likeCount,
  onCommitted,
  postId,
}: ReactionBarProps) {
  const [likes, setLikes] = useState(likeCount)
  const [dislikes, setDislikes] = useState(dislikesCount)
  const [emojis, setEmojis] = useState(emojiCount)
  const [userLiked, setUserLiked] = useState(false)
  const [userDisliked, setUserDisliked] = useState(false)
  const [userEmojis, setUserEmojis] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLikes(likeCount)
    setDislikes(dislikesCount)
    setEmojis(emojiCount)
  }, [dislikesCount, emojiCount, likeCount])

  useEffect(() => {
    setUserLiked(false)
    setUserDisliked(false)
    setUserEmojis(new Set())
    setError(null)
    setIsPickerOpen(false)
  }, [postId])

  const reactionSummary = useMemo(
    () => ({
      dislikes,
      emojis,
      likes,
    }),
    [dislikes, emojis, likes],
  )

  const canInteract = canReact && !pending
  const hasActiveReaction = userLiked || userDisliked || userEmojis.size > 0

  const rollbackState = useCallback(
    () => ({
      dislikes,
      emojis,
      likes,
      userDisliked,
      userEmojis: new Set(userEmojis),
      userLiked,
    }),
    [dislikes, emojis, likes, userDisliked, userEmojis, userLiked],
  )

  const commitError = useCallback(
    (message: string) => {
      setPending(false)
      setError(message)
    },
    [],
  )

  const applySentiment = useCallback(
    async (type: Extract<ReactionType, 'like' | 'dislike'>) => {
      if (!canInteract) {
        return
      }

      const snapshot = rollbackState()
      setError(null)
      setPending(true)
      setIsPickerOpen(false)

      if (type === 'like') {
        const hasLike = userLiked
        const nextLikes = clampCount(hasLike ? likes - 1 : likes + 1)
        const nextDislikes = clampCount(
          !hasLike && userDisliked ? dislikes - 1 : dislikes,
        )

        setLikes(nextLikes)
        setDislikes(nextDislikes)
        setUserLiked(!hasLike)
        setUserDisliked(false)

        try {
          if (hasLike) {
            await deleteReaction(postId)
          } else {
            await createReaction(postId, { type })
          }

          onCommitted?.()
          setPending(false)
          return
        } catch (error) {
          setLikes(snapshot.likes)
          setDislikes(snapshot.dislikes)
          setUserLiked(snapshot.userLiked)
          setUserDisliked(snapshot.userDisliked)
          setUserEmojis(snapshot.userEmojis)
          commitError(getErrorMessage(error, 'like'))
          return
        }
      }

      const hasDislike = userDisliked
      const nextLikes = clampCount(!hasDislike && userLiked ? likes - 1 : likes)
      const nextDislikes = clampCount(hasDislike ? dislikes - 1 : dislikes + 1)

      setLikes(nextLikes)
      setDislikes(nextDislikes)
      setUserDisliked(!hasDislike)
      setUserLiked(false)

      try {
        if (hasDislike) {
          await deleteReaction(postId)
        } else {
          await createReaction(postId, { type })
        }

        onCommitted?.()
      } catch (error) {
        setLikes(snapshot.likes)
        setDislikes(snapshot.dislikes)
        setUserLiked(snapshot.userLiked)
        setUserDisliked(snapshot.userDisliked)
        setUserEmojis(snapshot.userEmojis)
        commitError(getErrorMessage(error, 'dislike'))
      } finally {
        setPending(false)
      }
    },
    [
      canInteract,
      commitError,
      dislikes,
      likes,
      onCommitted,
      postId,
      rollbackState,
      userDisliked,
      userLiked,
    ],
  )

  const applyEmoji = useCallback(
    async (emoji: string) => {
      if (!canInteract) {
        return
      }

      const snapshot = rollbackState()
      const shouldDelete = userEmojis.has(emoji)
      const nextEmojis = new Set(userEmojis)
      let nextCount = emojis

      if (shouldDelete) {
        nextEmojis.delete(emoji)
        nextCount -= 1
      } else {
        nextEmojis.add(emoji)
        nextCount += 1
      }

      setError(null)
      setPending(true)
      setIsPickerOpen(false)
      setEmojis(clampCount(nextCount))
      setUserEmojis(nextEmojis)

      try {
        if (shouldDelete) {
          await deleteReaction(postId, emoji)
        } else {
          await createReaction(postId, { type: 'emoji', value: emoji })
        }

        onCommitted?.()
      } catch (error) {
        setLikes(snapshot.likes)
        setDislikes(snapshot.dislikes)
        setEmojis(snapshot.emojis)
        setUserLiked(snapshot.userLiked)
        setUserDisliked(snapshot.userDisliked)
        setUserEmojis(snapshot.userEmojis)
        commitError(getErrorMessage(error, 'update emoji'))
      } finally {
        setPending(false)
      }
    },
    [
      canInteract,
      commitError,
      emojis,
      onCommitted,
      postId,
      rollbackState,
      userEmojis,
    ],
  )

  const handlePickerToggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      if (!canInteract) {
        return
      }
      setError(null)
      setIsPickerOpen((current) => !current)
    },
    [canInteract],
  )

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-label="Like reaction"
          disabled={!canInteract}
          className={`rounded-full border border-emerald-300/20 px-4 py-2 text-sm transition ${
            userLiked
              ? 'bg-emerald-300/15 text-emerald-100'
              : 'bg-white/5 text-slate-200 hover:bg-white/10'
          }`}
          type="button"
          onClick={() => {
            void applySentiment('like')
          }}
        >
          👍 {formatCountValue(reactionSummary.likes)}
        </button>

        <button
          aria-label="Dislike reaction"
          disabled={!canInteract}
          className={`rounded-full border border-rose-300/20 px-4 py-2 text-sm transition ${
            userDisliked
              ? 'bg-rose-300/15 text-rose-100'
              : 'bg-white/5 text-slate-200 hover:bg-white/10'
          }`}
          type="button"
          onClick={() => {
            void applySentiment('dislike')
          }}
        >
          👎 {formatCountValue(reactionSummary.dislikes)}
        </button>

        <div className="relative">
          <button
            aria-label="Emoji reaction picker"
            disabled={!canInteract}
            className={`rounded-full border border-fuchsia-300/20 px-4 py-2 text-sm transition ${
              userEmojis.size > 0
                ? 'bg-fuchsia-300/15 text-fuchsia-100'
                : 'bg-white/5 text-slate-200 hover:bg-white/10'
            }`}
            type="button"
            onClick={handlePickerToggle}
          >
            😊 {formatCountValue(reactionSummary.emojis)}
          </button>

          {isPickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-2 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/95 p-3">
              {EMOJI_PICKER_ITEMS.map((emoji) => (
                <button
                  key={emoji}
                  aria-label={`Emoji ${emoji}`}
                  disabled={pending}
                  className={`rounded-xl border border-white/12 px-3 py-2 text-lg leading-none ${
                    userEmojis.has(emoji)
                      ? 'bg-fuchsia-300/15 text-fuchsia-100'
                      : 'bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                  type="button"
                  onClick={() => {
                    void applyEmoji(emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p role="status" className="text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      {canReact === false ? (
        <p className="text-xs text-slate-400">
          Sign in and activate a public handle to react.
        </p>
      ) : null}
      {hasActiveReaction ? (
        <p className="sr-only">Your reaction selection is active.</p>
      ) : null}
    </section>
  )
}
