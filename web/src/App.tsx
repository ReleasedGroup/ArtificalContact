import { startTransition, useEffect, useState } from 'react'
import { WEB_BUILD_SHA } from './build-meta.generated'
import { getHealth, type HealthPayload } from './lib/health'
import {
  getPublicUserProfile,
  PublicProfileNotFoundError,
  type PublicUserProfile,
} from './lib/public-profile'
import { initializeTelemetry } from './lib/telemetry'

type AppRoute = { kind: 'signin' } | { kind: 'profile'; handle: string }

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthPayload }
  | { status: 'error'; message: string }

type PublicProfileState =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicUserProfile }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }

type PublicProfileStatusState = Exclude<
  PublicProfileState,
  { status: 'ready'; data: PublicUserProfile }
>

const postLoginRedirectUri = encodeURIComponent('/')

function getAuthLoginHref(provider: 'aad' | 'github') {
  return `/.auth/login/${provider}?post_login_redirect_uri=${postLoginRedirectUri}`
}

const authProviders = [
  {
    label: 'Continue with Microsoft',
    href: getAuthLoginHref('aad'),
    description:
      'Use Microsoft Entra ID through Static Web Apps built-in authentication.',
    gradientClass: 'from-cyan-300/30 via-sky-300/15 to-transparent',
    badge: 'MS',
    helperText: 'Returns to the root route after Microsoft authentication.',
  },
  {
    label: 'Continue with GitHub',
    href: getAuthLoginHref('github'),
    description:
      'Use GitHub sign-in for the practitioner identity and repository-connected workflows.',
    gradientClass: 'from-amber-300/30 via-orange-300/15 to-transparent',
    badge: 'GH',
    helperText: 'Returns to the root route after GitHub authentication.',
  },
]

const profileMilestones = [
  'Claim a unique handle for your public profile.',
  'Set a display name, bio, and avatar once profile editing is live.',
  'Return to the app shell after provider authentication completes.',
]

const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function getCurrentRoute(pathname = window.location.pathname): AppRoute {
  const publicProfileMatch = /^\/u\/([^/]+)\/?$/.exec(pathname)
  if (publicProfileMatch) {
    return {
      kind: 'profile',
      handle: decodePathSegment(publicProfileMatch[1]),
    }
  }

  return { kind: 'signin' }
}

function formatProfileCount(value: number): string {
  return value >= 1000 ? compactCountFormatter.format(value) : String(value)
}

function formatJoinedDate(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function buildProfileMonogram(profile: PublicUserProfile): string {
  const source = profile.displayName?.trim() || profile.handle.trim()
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getCurrentRoute())

  useEffect(() => {
    initializeTelemetry()

    const handlePopState = () => {
      startTransition(() => {
        setRoute(getCurrentRoute())
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  if (route.kind === 'profile') {
    return <PublicProfileScreen handle={route.handle} />
  }

  return <SignInScreen />
}

function SignInScreen() {
  const [healthState, setHealthState] = useState<HealthState>({
    status: 'loading',
  })

  useEffect(() => {
    const controller = new AbortController()

    const loadHealth = async () => {
      try {
        const data = await getHealth(controller.signal)
        startTransition(() => {
          setHealthState({ status: 'ready', data })
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Unable to reach /api/health.'

        startTransition(() => {
          setHealthState({ status: 'error', message })
        })
      }
    }

    void loadHealth()

    return () => {
      controller.abort()
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-8 sm:px-8 lg:px-12">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/85 shadow-2xl shadow-cyan-950/30 backdrop-blur">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),transparent_32%),radial-gradient(circle_at_center_right,_rgba(251,191,36,0.18),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.86))]" />
        <div className="absolute inset-y-0 right-0 hidden w-[38%] border-l border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0))] lg:block" />

        <div className="relative grid gap-8 p-8 sm:p-12 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-8">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 font-medium text-cyan-100">
                Sprint 1 identity
              </span>
              <span className="rounded-full border border-white/10 px-4 py-2">
                Web build {WEB_BUILD_SHA}
              </span>
            </div>

            <div className="max-w-3xl space-y-4">
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Sign in to ArtificialContact.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-300">
                Choose the provider you already trust. Azure Static Web Apps
                handles the authentication handshake, the app receives the
                signed principal through the linked API, and your credentials
                never touch browser code.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {authProviders.map((provider) => (
                <a
                  key={provider.label}
                  href={provider.href}
                  aria-label={provider.label}
                  className="group relative overflow-hidden rounded-[1.75rem] border border-white/12 bg-white/5 p-6 text-left shadow-lg shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${provider.gradientClass}`}
                  />
                  <div className="relative space-y-4">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-slate-950/60 text-sm font-semibold tracking-[0.24em] text-white">
                      {provider.badge}
                    </span>
                    <div>
                      <p className="text-xl font-semibold text-white">
                        {provider.label}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-slate-200">
                        {provider.description}
                      </p>
                    </div>
                    <p
                      aria-hidden="true"
                      className="text-xs uppercase tracking-[0.22em] text-slate-300/80"
                    >
                      {provider.helperText}
                    </p>
                  </div>
                </a>
              ))}
            </div>

            <section className="rounded-[1.75rem] border border-white/10 bg-black/20 p-6">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                After sign-in
              </p>
              <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-300 sm:grid-cols-3">
                {profileMilestones.map((milestone) => (
                  <li
                    key={milestone}
                    className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
                  >
                    {milestone}
                  </li>
                ))}
              </ul>
            </section>
          </section>

          <section className="flex flex-col gap-4">
            <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 text-left">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-100/80">
                Identity notes
              </p>
              <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                <p>
                  Anonymous routes stay public, but authenticated features move
                  behind the Static Web Apps auth gate once the profile and feed
                  screens land.
                </p>
                <p>
                  Both providers return to the root route after successful
                  authentication so the sign-in handoff is predictable in every
                  preview environment.
                </p>
              </div>
            </article>

            <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/80 p-6 text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                    API health
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    /api/health
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                  {healthState.status === 'loading' && 'Checking'}
                  {healthState.status === 'ready' && 'Healthy'}
                  {healthState.status === 'error' && 'Needs attention'}
                </span>
              </div>

              <div className="mt-6 space-y-3 text-sm leading-7 text-slate-300">
                {healthState.status === 'loading' && (
                  <p>Requesting the linked Functions health check.</p>
                )}

                {healthState.status === 'error' && <p>{healthState.message}</p>}

                {healthState.status === 'ready' && (
                  <>
                    <p>
                      Build{' '}
                      <span className="font-medium text-white">
                        {healthState.data.buildSha}
                      </span>{' '}
                      in{' '}
                      <span className="font-medium text-white">
                        {healthState.data.region}
                      </span>
                    </p>
                    <p>
                      Cosmos ping:{' '}
                      <span className="font-medium text-white">
                        {healthState.data.cosmos.status}
                      </span>
                      {healthState.data.cosmos.databaseName
                        ? ` (${healthState.data.cosmos.databaseName})`
                        : ''}
                    </p>
                    {healthState.data.cosmos.details && (
                      <p className="text-slate-400">
                        {healthState.data.cosmos.details}
                      </p>
                    )}
                    <p className="text-slate-400">
                      Timestamp{' '}
                      {new Date(healthState.data.timestamp).toLocaleString()}
                    </p>
                  </>
                )}
              </div>
            </article>
          </section>
        </div>
      </section>
    </main>
  )
}

function PublicProfileScreen({ handle }: { handle: string }) {
  const [profileState, setProfileState] = useState<PublicProfileState>({
    status: 'loading',
  })

  useEffect(() => {
    const controller = new AbortController()

    const loadProfile = async () => {
      try {
        const data = await getPublicUserProfile(handle, controller.signal)
        startTransition(() => {
          setProfileState({ status: 'ready', data })
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        startTransition(() => {
          if (error instanceof PublicProfileNotFoundError) {
            setProfileState({
              status: 'not-found',
              message: error.message,
            })
            return
          }

          setProfileState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load the public profile.',
          })
        })
      }
    }

    void loadProfile()

    return () => {
      controller.abort()
    }
  }, [handle])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/90 shadow-2xl shadow-slate-950/35 backdrop-blur">
        <div className="relative h-48 overflow-hidden sm:h-56">
          {profileState.status === 'ready' && profileState.data.bannerUrl ? (
            <img
              src={profileState.data.bannerUrl}
              alt={`Banner for @${profileState.data.handle}`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.30),transparent_34%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.22),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.88))]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.15),rgba(2,6,23,0.68))]" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-200">
              <a
                href="/"
                className="rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 font-medium hover:bg-slate-900/75"
              >
                ArtificialContact
              </a>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 font-medium text-emerald-100">
                Public profile
              </span>
            </div>
            <span className="rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-200">
              {profileState.status === 'loading' && 'Loading'}
              {profileState.status === 'ready' && 'Live'}
              {profileState.status === 'not-found' && 'Missing'}
              {profileState.status === 'error' && 'Retry needed'}
            </span>
          </div>
        </div>

        <div className="relative px-5 pb-6 sm:px-6 sm:pb-8 lg:px-10">
          {profileState.status === 'ready' ? (
            <ReadyPublicProfile profile={profileState.data} />
          ) : (
            <PublicProfileStatusCard handle={handle} state={profileState} />
          )}
        </div>
      </section>
    </main>
  )
}

function ReadyPublicProfile({ profile }: { profile: PublicUserProfile }) {
  const joinedDate = formatJoinedDate(profile.createdAt)

  return (
    <>
      <div className="-mt-14 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={`${profile.displayName ?? profile.handle} avatar`}
              className="h-24 w-24 rounded-[1.75rem] border border-white/10 bg-slate-900 object-cover shadow-lg shadow-slate-950/35 ring-4 ring-slate-950 sm:h-28 sm:w-28"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-[1.75rem] border border-white/10 bg-[linear-gradient(135deg,rgba(45,212,191,0.35),rgba(59,130,246,0.28),rgba(249,115,22,0.32))] text-3xl font-semibold tracking-[0.08em] text-white shadow-lg shadow-slate-950/35 ring-4 ring-slate-950 sm:h-28 sm:w-28">
              {buildProfileMonogram(profile)}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                @{profile.handle}
              </span>
              {joinedDate && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Joined {joinedDate}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {profile.displayName ?? `@${profile.handle}`}
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                {profile.bio ??
                  'This practitioner has not added a bio yet, but their public handle is now reachable from the SPA.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
          >
            Back to sign-in
          </a>
          <span className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-100">
            Routed from {'/u/{handle}'}
          </span>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-6">
          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/65 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
              Profile snapshot
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Posts
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {formatProfileCount(profile.counters.posts)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Followers
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {formatProfileCount(profile.counters.followers)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Following
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {formatProfileCount(profile.counters.following)}
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/65 p-6">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/8 pb-4 text-sm">
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/12 px-3 py-1 font-medium text-cyan-100">
                Posts
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-slate-400">
                Replies
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-slate-400">
                Media
              </span>
            </div>
            <div className="mt-5 rounded-[1.5rem] border border-dashed border-white/12 bg-slate-950/35 p-5">
              <h2 className="text-xl font-semibold text-white">
                Public identity is live.
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                This route now resolves <code>GET /api/users/{'{handle}'}</code>{' '}
                and
                renders the profile shell. Profile posts and richer social graph
                views arrive in later slices once those read models are in
                place.
              </p>
            </div>
          </article>
        </section>

        <aside className="space-y-6">
          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-100/80">
              Expertise
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {profile.expertise.length > 0 ? (
                profile.expertise.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200"
                  >
                    {topic}
                  </span>
                ))
              ) : (
                <p className="text-sm leading-7 text-slate-400">
                  No expertise tags published yet.
                </p>
              )}
            </div>
          </article>

          <article className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-emerald-100/80">
              Routing notes
            </p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
              <p>Anonymous visitors can open this route without signing in.</p>
              <p>
                The SPA uses the canonical handle returned by the API for the
                profile display and count summary.
              </p>
              {profile.updatedAt && (
                <p className="text-slate-400">
                  Last updated{' '}
                  {new Date(profile.updatedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}
            </div>
          </article>
        </aside>
      </div>
    </>
  )
}

function PublicProfileStatusCard({
  handle,
  state,
}: {
  handle: string
  state: PublicProfileStatusState
}) {
  return (
    <div className="py-8 sm:py-10">
      <article className="mx-auto max-w-3xl rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-6 shadow-lg shadow-slate-950/30 sm:p-8">
        <div className="space-y-4">
          <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200">
            @{handle}
          </span>

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {state.status === 'loading' && 'Loading public profile'}
              {state.status === 'not-found' && 'Profile not found'}
              {state.status === 'error' && 'Unable to load profile'}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300">
              {state.status === 'loading' &&
                'Fetching the public profile envelope from the linked Functions API.'}
              {state.status === 'not-found' && state.message}
              {state.status === 'error' && state.message}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="/"
              className="rounded-2xl bg-cyan-300/12 px-4 py-2.5 text-sm font-medium text-cyan-100 ring-1 ring-cyan-300/25 hover:bg-cyan-300/18"
            >
              Back to sign-in
            </a>
            {state.status !== 'loading' && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}

export default App
