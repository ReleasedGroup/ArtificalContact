import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { WEB_BUILD_SHA } from './build-meta.generated'
import { signOut } from './lib/auth'
import { getHealth, type HealthPayload } from './lib/health'
import { initializeTelemetry } from './lib/telemetry'

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

function App() {
  const queryClient = useQueryClient()
  const healthQuery = useQuery<HealthPayload>({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
  })

  useEffect(() => {
    initializeTelemetry()
  }, [])

  const healthErrorMessage =
    healthQuery.error instanceof Error
      ? healthQuery.error.message
      : 'Unable to reach /api/health.'

  function handleSignOut() {
    signOut({ queryClient })
  }

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
              <button
                type="button"
                onClick={handleSignOut}
                className="ml-auto rounded-full border border-white/12 px-4 py-2 font-medium text-slate-100 transition hover:border-white/25 hover:bg-white/6 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
              >
                Sign out
              </button>
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
                  {healthQuery.isPending && 'Checking'}
                  {healthQuery.isSuccess && 'Healthy'}
                  {healthQuery.isError && 'Needs attention'}
                </span>
              </div>

              <div className="mt-6 space-y-3 text-sm leading-7 text-slate-300">
                {healthQuery.isPending && (
                  <p>Requesting the linked Functions health check.</p>
                )}

                {healthQuery.isError && <p>{healthErrorMessage}</p>}

                {healthQuery.data && (
                  <>
                    <p>
                      Build{' '}
                      <span className="font-medium text-white">
                        {healthQuery.data.buildSha}
                      </span>{' '}
                      in{' '}
                      <span className="font-medium text-white">
                        {healthQuery.data.region}
                      </span>
                    </p>
                    <p>
                      Cosmos ping:{' '}
                      <span className="font-medium text-white">
                        {healthQuery.data.cosmos.status}
                      </span>
                      {healthQuery.data.cosmos.databaseName
                        ? ` (${healthQuery.data.cosmos.databaseName})`
                        : ''}
                    </p>
                    {healthQuery.data.cosmos.details && (
                      <p className="text-slate-400">
                        {healthQuery.data.cosmos.details}
                      </p>
                    )}
                    <p className="text-slate-400">
                      Timestamp{' '}
                      {new Date(healthQuery.data.timestamp).toLocaleString()}
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

export default App
