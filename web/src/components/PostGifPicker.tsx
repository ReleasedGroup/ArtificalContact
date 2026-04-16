import { useEffect, useState, type FormEvent } from 'react'
import { searchGifs, type GifSearchResult } from '../lib/gif-search'
import { AppImage } from './AppImage'

function getBrowserLocale(): string | undefined {
  if (typeof navigator !== 'undefined' && navigator.language.trim()) {
    return navigator.language
  }

  return undefined
}

export function PostGifPicker({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean
  onSelect: (gif: GifSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<GifSearchResult[]>([])
  const [mode, setMode] = useState<'featured' | 'search'>('featured')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void searchGifs(activeQuery, {
      limit: 12,
      locale: getBrowserLocale(),
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) {
          return
        }

        setResults(response.results)
        setMode(response.mode)
        setStatus('ready')
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return
        }

        setStatus('error')
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load GIF results right now.',
        )
      })

    return () => {
      controller.abort()
    }
  }, [activeQuery])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('loading')
    setErrorMessage(null)
    setActiveQuery(query.trim())
  }

  const heading =
    mode === 'search' && activeQuery.length > 0
      ? `Results for "${activeQuery}"`
      : 'Featured GIFs'

  return (
    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-100/80">
            GIF posts
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
            Search GIPHY and attach a GIF to your next post. You can publish it
            on its own or combine it with text and image uploads.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-300">
          Powered by GIPHY
        </span>
      </div>

      <form className="mt-4 flex flex-wrap gap-3" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="post-gif-search">
          Search GIPHY for a post GIF
        </label>
        <input
          id="post-gif-search"
          type="search"
          className="min-w-[16rem] flex-1 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIPHY"
          value={query}
        />
        <button
          type="submit"
          className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
          disabled={disabled}
        >
          Find GIFs
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-white">{heading}</p>
        {status === 'loading' && (
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Loading
          </span>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {errorMessage}
        </div>
      )}

      {status !== 'error' && results.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
          {status === 'loading'
            ? 'Loading GIF results…'
            : 'No GIF results matched that search.'}
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((gif) => (
            <li key={gif.id}>
              <button
                type="button"
                aria-label={`Attach GIF: ${gif.title ?? gif.id}`}
                className="group flex h-full w-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-900/80 text-left shadow-lg shadow-slate-950/25 transition hover:border-cyan-300/35 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => onSelect(gif)}
              >
                <AppImage
                  alt={gif.title ?? 'GIF result'}
                  className="h-40 w-full object-cover"
                  src={gif.previewUrl}
                />
                <div className="flex flex-1 items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {gif.title ?? 'Untitled GIF'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {gif.width && gif.height
                        ? `${gif.width} × ${gif.height}`
                        : 'Tap to attach'}
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-100 transition group-hover:border-cyan-300/35 group-hover:bg-cyan-300/15">
                    Attach
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
