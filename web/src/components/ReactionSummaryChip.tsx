import { startTransition, useEffect, useId, useRef, useState } from 'react'
import {
  getPostReactions,
  type PublicReactionSummaryEntry,
  type PublicReactionSummaryType,
} from '../lib/post-reactions'

type SupportedReactionSummaryType = Exclude<
  PublicReactionSummaryType,
  'all' | 'gif'
>

type LoadState =
  | {
      status: 'idle' | 'loading'
      reactions: PublicReactionSummaryEntry[]
      continuationToken: string | null
      errorMessage: null
    }
  | {
      status: 'ready' | 'loading-more'
      reactions: PublicReactionSummaryEntry[]
      continuationToken: string | null
      errorMessage: null
    }
  | {
      status: 'error'
      reactions: PublicReactionSummaryEntry[]
      continuationToken: string | null
      errorMessage: string
    }

type Tone = 'like' | 'dislike' | 'emoji'

const reactionSummaryPageSize = 8

const reactionTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const toneClassNames: Record<
  Tone,
  {
    chip: string
    panelBorder: string
    panelTitle: string
    loadMore: string
  }
> = {
  like: {
    chip: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:border-emerald-300/35 hover:bg-emerald-300/15 focus-visible:ring-emerald-200/80',
    panelBorder: 'border-emerald-300/15',
    panelTitle: 'text-emerald-100',
    loadMore:
      'border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:border-emerald-300/35 hover:bg-emerald-300/15',
  },
  dislike: {
    chip: 'border-rose-300/20 bg-rose-300/10 text-rose-100 hover:border-rose-300/35 hover:bg-rose-300/15 focus-visible:ring-rose-200/80',
    panelBorder: 'border-rose-300/15',
    panelTitle: 'text-rose-100',
    loadMore:
      'border-rose-300/20 bg-rose-300/10 text-rose-100 hover:border-rose-300/35 hover:bg-rose-300/15',
  },
  emoji: {
    chip: 'border-amber-300/20 bg-amber-300/10 text-amber-100 hover:border-amber-300/35 hover:bg-amber-300/15 focus-visible:ring-amber-200/80',
    panelBorder: 'border-amber-300/15',
    panelTitle: 'text-amber-100',
    loadMore:
      'border-amber-300/20 bg-amber-300/10 text-amber-100 hover:border-amber-300/35 hover:bg-amber-300/15',
  },
}

function formatReactionTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return reactionTimestampFormatter.format(parsed)
}

function buildActorMonogram(entry: PublicReactionSummaryEntry): string {
  const source =
    entry.actor.displayName?.trim() || entry.actor.handle.trim() || 'AC'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

export function ReactionSummaryChip({
  postId,
  count,
  buttonLabel,
  emptyMessage,
  loadMoreLabel,
  popoverTitle,
  reactionType,
  tone,
}: {
  postId: string
  count: number
  buttonLabel: string
  emptyMessage: string
  loadMoreLabel: string
  popoverTitle: string
  reactionType: SupportedReactionSummaryType
  tone: Tone
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>({
    status: 'idle',
    reactions: [],
    continuationToken: null,
    errorMessage: null,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const dialogId = useId()

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isOpen || loadState.status !== 'idle') {
      return
    }

    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller

    startTransition(() => {
      setLoadState({
        status: 'loading',
        reactions: [],
        continuationToken: null,
        errorMessage: null,
      })
    })

    void getPostReactions(postId, {
      type: reactionType,
      limit: reactionSummaryPageSize,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) {
          return
        }

        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }

        startTransition(() => {
          setLoadState({
            status: 'ready',
            reactions: page.reactions,
            continuationToken: page.continuationToken,
            errorMessage: null,
          })
        })
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return
        }

        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }

        startTransition(() => {
          setLoadState({
            status: 'error',
            reactions: [],
            continuationToken: null,
            errorMessage:
              error instanceof Error
                ? error.message
                : 'Unable to load the reaction summary.',
          })
        })
      })
  }, [isOpen, loadState.status, postId, reactionType])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }

      setIsPinned(false)
      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setIsPinned(false)
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleLoadMore = async () => {
    if (loadState.status !== 'ready' || loadState.continuationToken === null) {
      return
    }

    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller

    startTransition(() => {
      setLoadState((current) => ({
        status: 'loading-more',
        reactions: current.reactions,
        continuationToken: current.continuationToken,
        errorMessage: null,
      }))
    })

    try {
      const page = await getPostReactions(postId, {
        type: reactionType,
        limit: reactionSummaryPageSize,
        continuationToken: loadState.continuationToken,
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        return
      }

      startTransition(() => {
        setLoadState((current) => ({
          status: 'ready',
          reactions: [...current.reactions, ...page.reactions],
          continuationToken: page.continuationToken,
          errorMessage: null,
        }))
      })
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return
      }

      startTransition(() => {
        setLoadState((current) => ({
          status: 'error',
          reactions: current.reactions,
          continuationToken: current.continuationToken,
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Unable to load the reaction summary.',
        }))
      })
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  if (count < 1) {
    return (
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
        {buttonLabel}
      </span>
    )
  }

  const toneClasses = toneClassNames[tone]

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => {
        setIsOpen(true)
      }}
      onMouseLeave={() => {
        if (!isPinned) {
          setIsOpen(false)
        }
      }}
      onFocusCapture={() => {
        setIsOpen(true)
      }}
      onBlurCapture={(event) => {
        const relatedTarget = event.relatedTarget
        if (
          isPinned ||
          (relatedTarget instanceof Node &&
            containerRef.current?.contains(relatedTarget))
        ) {
          return
        }

        setIsOpen(false)
      }}
    >
      <button
        type="button"
        aria-controls={dialogId}
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen && isPinned) {
            setIsPinned(false)
            setIsOpen(false)
            return
          }

          setIsPinned(true)
          setIsOpen(true)
        }}
        className={`rounded-full border px-3 py-1 transition focus:outline-none focus-visible:ring-2 ${toneClasses.chip}`}
      >
        {buttonLabel}
      </button>

      {isOpen && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={popoverTitle}
          className={`absolute left-0 top-full z-20 mt-3 w-[min(22rem,calc(100vw-3rem))] rounded-[1.35rem] border bg-slate-950/96 p-4 shadow-2xl shadow-slate-950/45 backdrop-blur ${toneClasses.panelBorder}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${toneClasses.panelTitle}`}>
                {popoverTitle}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Hover or tap to see the public profiles behind this counter.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
              {buttonLabel}
            </span>
          </div>

          {loadState.status === 'loading' && (
            <p className="mt-4 text-sm text-slate-300">
              Loading reaction summary…
            </p>
          )}

          {loadState.status === 'error' && (
            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
              {loadState.errorMessage}
            </div>
          )}

          {loadState.status !== 'loading' &&
            loadState.status !== 'error' &&
            loadState.reactions.length === 0 && (
              <p className="mt-4 text-sm text-slate-300">{emptyMessage}</p>
            )}

          {loadState.reactions.length > 0 && (
            <ul className="mt-4 space-y-3">
              {loadState.reactions.map((entry) => {
                const actorName =
                  entry.actor.displayName?.trim() || `@${entry.actor.handle}`
                const reactionTimestamp = formatReactionTimestamp(
                  entry.reactedAt,
                )

                return (
                  <li
                    key={`${entry.actor.id}:${entry.reactedAt ?? entry.actor.handle}`}
                    className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3"
                  >
                    {entry.actor.avatarUrl ? (
                      <img
                        src={entry.actor.avatarUrl}
                        alt={`${actorName} avatar`}
                        className="h-10 w-10 rounded-2xl border border-white/10 bg-slate-900 object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(45,212,191,0.34),rgba(59,130,246,0.28),rgba(249,115,22,0.3))] text-xs font-semibold tracking-[0.12em] text-white">
                        {buildActorMonogram(entry)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <a
                        href={`/u/${encodeURIComponent(entry.actor.handle)}`}
                        className="text-sm font-medium text-white transition hover:text-cyan-100"
                      >
                        {actorName}
                      </a>
                      <p className="mt-1 text-xs text-slate-400">
                        @{entry.actor.handle}
                      </p>

                      {reactionType === 'emoji' &&
                        entry.emojiValues.length > 0 && (
                          <p className="mt-2 text-lg leading-none tracking-[0.08em] text-amber-100">
                            {entry.emojiValues.join(' ')}
                          </p>
                        )}

                      {reactionTimestamp && (
                        <p className="mt-2 text-xs text-slate-500">
                          Updated {reactionTimestamp}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {loadState.continuationToken !== null && (
            <button
              type="button"
              onClick={() => {
                void handleLoadMore()
              }}
              disabled={loadState.status === 'loading-more'}
              className={`mt-4 rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400 ${toneClasses.loadMore}`}
            >
              {loadState.status === 'loading-more'
                ? 'Loading more…'
                : loadMoreLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
