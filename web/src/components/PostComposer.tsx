import { useId, useRef, type FormEvent, type UIEvent } from 'react'
import {
  getComposerSegments,
  isComposerTextEmpty,
  type ComposerSegment,
} from '../lib/composer'

type ComposerVariant = 'post' | 'reply'

interface PostComposerProps {
  authorBadge: string
  authorHandle?: string | null
  authorName: string
  disabled?: boolean
  label: string
  maxLength?: number
  onChange: (nextValue: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  submitLabel: string
  submitting?: boolean
  value: string
  variant?: ComposerVariant
}

const tokenClassNames: Record<
  Exclude<ComposerSegment['kind'], 'text'>,
  string
> = {
  hashtag:
    'rounded bg-sky-300/12 px-1 text-sky-100 ring-1 ring-inset ring-sky-300/25',
  mention:
    'rounded bg-fuchsia-300/12 px-1 text-fuchsia-100 ring-1 ring-inset ring-fuchsia-300/25',
}

function formatCounter(value: number, maxLength: number): string {
  return `${value} / ${maxLength}`
}

export function PostComposer({
  authorBadge,
  authorHandle = null,
  authorName,
  disabled = false,
  label,
  maxLength = 280,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  submitting = false,
  value,
  variant = 'post',
}: PostComposerProps) {
  const textAreaId = useId()
  const counterId = useId()
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const characterCount = value.length
  const segments = getComposerSegments(value)
  const remainingCharacters = maxLength - characterCount
  const canSubmit =
    !disabled &&
    !submitting &&
    remainingCharacters >= 0 &&
    !isComposerTextEmpty(value)

  const isReplyComposer = variant === 'reply'

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    onSubmit(value)
  }

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (mirrorRef.current === null) {
      return
    }

    mirrorRef.current.scrollTop = event.currentTarget.scrollTop
    mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft
  }

  return (
    <form className="flex gap-3" onSubmit={handleSubmit}>
      <div
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-fuchsia-500 to-sky-500 font-semibold tracking-[0.08em] text-white shadow-lg shadow-sky-950/25 ${
          isReplyComposer ? 'h-10 w-10 text-xs' : 'h-12 w-12 text-sm'
        }`}
      >
        {authorBadge}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">{authorName}</p>
            <p className="text-xs text-slate-500">
              {authorHandle ? `@${authorHandle}` : 'Handle pending'}
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
            {isReplyComposer ? 'Reply box' : 'Post composer'}
          </span>
        </div>

        <label className="sr-only" htmlFor={textAreaId}>
          {label}
        </label>
        <div className="relative mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/85 shadow-inner shadow-slate-950/40">
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 text-[15px] whitespace-pre-wrap break-words text-slate-100 ${
              isReplyComposer ? 'leading-6' : 'leading-7'
            }`}
          >
            {value.length > 0 ? (
              <>
                {segments.map((segment, index) =>
                  segment.kind === 'text' ? (
                    <span key={`${segment.kind}-${index}-${segment.text}`}>
                      {segment.text}
                    </span>
                  ) : (
                    <mark
                      key={`${segment.kind}-${index}-${segment.text}`}
                      data-composer-token={segment.kind}
                      className={tokenClassNames[segment.kind]}
                    >
                      {segment.text}
                    </mark>
                  ),
                )}
                <span className="select-none"> </span>
              </>
            ) : (
              <span className="text-slate-500">{placeholder}</span>
            )}
          </div>

          <textarea
            id={textAreaId}
            aria-describedby={counterId}
            className={`relative z-10 block w-full resize-none bg-transparent px-4 py-3 text-[15px] text-transparent caret-white outline-none placeholder:text-transparent focus:outline-none ${
              isReplyComposer ? 'min-h-24 leading-6' : 'min-h-36 leading-7'
            }`}
            disabled={disabled}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onScroll={handleScroll}
            placeholder={placeholder}
            rows={isReplyComposer ? 3 : 5}
            style={{ WebkitTextFillColor: 'transparent' }}
            value={value}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Highlighting mirrors backend hashtag and mention parsing.
          </p>
          <div className="flex items-center gap-3">
            <span
              id={counterId}
              className={`text-xs font-medium ${
                remainingCharacters <= 40 ? 'text-amber-200' : 'text-slate-400'
              }`}
            >
              {formatCounter(characterCount, maxLength)}
            </span>
            <button
              className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
              disabled={!canSubmit}
              type="submit"
            >
              {submitting ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
