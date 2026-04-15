import { startTransition, useEffect, useState } from 'react'
import { WEB_BUILD_SHA } from './build-meta.generated'
import { getHealth, type HealthPayload } from './lib/health'
import { initializeTelemetry } from './lib/telemetry'

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthPayload }
  | { status: 'error'; message: string }

const deliveryTracks = [
  {
    label: 'Web shell',
    description:
      'React, TypeScript, Tailwind CSS v4.1, Vitest, and Application Insights are wired and ready for the real product shell.',
  },
  {
    label: 'API stub',
    description:
      'Azure Functions exposes a typed /api/health endpoint with build metadata and a Cosmos connectivity probe.',
  },
  {
    label: 'Azure foundation',
    description:
      'Bicep and azd compose Static Web Apps, Functions Flex Consumption, Cosmos DB, Storage, AI Search, Key Vault, App Insights, and Front Door.',
  },
]

function App() {
  const [healthState, setHealthState] = useState<HealthState>({
    status: 'loading',
  })

  useEffect(() => {
    initializeTelemetry()

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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-12">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 p-8 shadow-2xl shadow-sky-950/30 backdrop-blur sm:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(217,70,239,0.18),transparent_30%)]" />

        <div className="relative space-y-8">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 font-medium text-sky-200">
              Sprint 0 foundations
            </span>
            <span className="rounded-full border border-white/10 px-4 py-2">
              Web build {WEB_BUILD_SHA}
            </span>
          </div>

          <div className="max-w-3xl space-y-4">
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              ArtificialContact is ready for feature work.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              This Sprint 0 shell proves the repo layout, client telemetry,
              API wiring, and Azure deployment shape before the social product
              experience lands.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="grid gap-4 md:grid-cols-3">
              {deliveryTracks.map((track) => (
                <article
                  key={track.label}
                  className="rounded-3xl border border-white/10 bg-white/5 p-5 text-left shadow-lg shadow-slate-950/20"
                >
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-200/80">
                    {track.label}
                  </p>
                  <p className="mt-4 text-sm leading-7 text-slate-300">
                    {track.description}
                  </p>
                </article>
              ))}
            </div>

            <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-200/80">
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
                  <p>Requesting the Functions health check and telemetry path.</p>
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
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
