import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startTransition, useDeferredValue, useState } from 'react'
import { signOut } from '../lib/auth'
import {
  getAdminMetrics,
  type AdminMetricsData,
  type AdminMetricsRange,
} from '../lib/admin-metrics'
import { hasRole, type MeProfile } from '../lib/me'

interface AdminMetricsScreenProps {
  viewer: MeProfile
}

type MetricKey =
  | 'registrations'
  | 'activeUsers'
  | 'posts'
  | 'reports'
  | 'queueDepth'

const rangeOptions: Array<{ label: string; value: AdminMetricsRange }> = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
]

const metricOptions: Array<{ key: MetricKey; label: string; helper: string }> = [
  {
    key: 'registrations',
    label: 'Registrations',
    helper: 'Provisioned user profiles created in the selected range.',
  },
  {
    key: 'activeUsers',
    label: 'Active users',
    helper: 'Distinct users with posting, reaction, follow, or report activity.',
  },
  {
    key: 'posts',
    label: 'Posts',
    helper: 'User-authored posts and replies created in the selected range.',
  },
  {
    key: 'reports',
    label: 'Reports',
    helper: 'Reports submitted into the moderation pipeline.',
  },
  {
    key: 'queueDepth',
    label: 'Queue depth',
    helper: 'Open reports waiting for moderation action.',
  },
]

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatMetricValue(value: number): string {
  return value >= 1000 ? compactNumberFormatter.format(value) : String(value)
}

function formatTimestamp(value: string, bucket: 'hour' | 'day'): string {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(bucket === 'hour' ? { hour: 'numeric' as const } : {}),
  }).format(parsed)
}

function formatGeneratedAt(value: string): string {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function formatDelta(changePercent: number | null): string {
  if (changePercent === null) {
    return 'New compared with the previous window'
  }

  if (changePercent === 0) {
    return 'Flat versus the previous window'
  }

  const direction = changePercent > 0 ? 'up' : 'down'
  return `${Math.abs(changePercent).toFixed(1)}% ${direction} versus the previous window`
}

export function AdminMetricsScreen({ viewer }: AdminMetricsScreenProps) {
  const queryClient = useQueryClient()
  const [selectedRange, setSelectedRange] = useState<AdminMetricsRange>('7d')
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('queueDepth')
  const deferredRange = useDeferredValue(selectedRange)
  const viewerIsAdmin = hasRole(viewer.roles, 'admin')

  const metricsQuery = useQuery<AdminMetricsData>({
    queryKey: ['admin-metrics', deferredRange],
    queryFn: ({ signal }) => getAdminMetrics(deferredRange, signal),
    enabled: viewerIsAdmin,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  function handleSignOut() {
    signOut({ queryClient })
  }

  if (!viewerIsAdmin) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="w-full rounded-[2rem] border border-amber-400/20 bg-slate-950/88 px-8 py-12 text-center shadow-2xl shadow-slate-950/30 backdrop-blur">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-100/80">
            Admin access required
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your profile is not authorised for admin metrics.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            The route is reserved for administrator accounts because it exposes
            platform-wide operational activity and moderation backlog metrics.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/"
              className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
            >
              Back to home feed
            </a>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    )
  }

  const selectedMetricOption =
    metricOptions.find((metric) => metric.key === selectedMetric) ?? metricOptions[0]
  const series = metricsQuery.data?.series ?? []
  const selectedMetricValues = series.map((bucket) => bucket[selectedMetric])
  const selectedMetricMax = Math.max(1, ...selectedMetricValues, 0)

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_top_right,_rgba(250,204,21,0.12),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/72 px-6 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
                  Administrator
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  /api/admin/metrics
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Viewer @{viewer.handle ?? viewer.displayName}
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Platform metrics
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Track registrations, activity, authored content, moderation
                  intake, and queue depth from the production read models.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/"
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Home feed
              </a>
              <a
                href="/notifications"
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Notifications
              </a>
              <button
                type="button"
                onClick={() => {
                  void metricsQuery.refetch()
                }}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                disabled={metricsQuery.isPending || metricsQuery.isRefetching}
              >
                Refresh metrics
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 px-4 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              {rangeOptions.map((option) => {
                const selected = option.value === selectedRange

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      startTransition(() => {
                        setSelectedRange(option.value)
                      })
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      selected
                        ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-50'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/8'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            <p className="text-sm text-slate-400">
              {metricsQuery.data
                ? `Generated ${formatGeneratedAt(
                    metricsQuery.data.filters.generatedAt,
                  )}`
                : 'Waiting for metrics payload'}
            </p>
          </div>

          {metricsQuery.isPending && (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={`admin-metrics-skeleton-${index}`}
                  className="animate-pulse rounded-[1.75rem] border border-white/8 bg-slate-900/65 p-5"
                >
                  <div className="h-4 w-24 rounded-full bg-white/8" />
                  <div className="mt-5 h-10 w-28 rounded-full bg-white/8" />
                  <div className="mt-4 h-4 w-full rounded-full bg-white/8" />
                </div>
              ))}
            </div>
          )}

          {metricsQuery.isError && (
            <article className="mt-5 rounded-[1.75rem] border border-rose-400/20 bg-rose-400/10 p-6 text-rose-50">
              <h2 className="text-xl font-semibold">Admin metrics unavailable</h2>
              <p className="mt-3 text-sm leading-7 text-rose-100/90">
                {metricsQuery.error instanceof Error
                  ? metricsQuery.error.message
                  : 'Unable to load the admin metrics dashboard.'}
              </p>
            </article>
          )}

          {metricsQuery.data && !metricsQuery.isError && (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricOptions.map((metric) => {
                  const summaryValue = metricsQuery.data.summary[metric.key]
                  const selected = metric.key === selectedMetric

                  return (
                    <button
                      key={metric.key}
                      type="button"
                      onClick={() => {
                        startTransition(() => {
                          setSelectedMetric(metric.key)
                        })
                      }}
                      className={`rounded-[1.75rem] border p-5 text-left transition ${
                        selected
                          ? 'border-cyan-300/35 bg-cyan-300/10 shadow-lg shadow-cyan-950/15'
                          : 'border-white/10 bg-slate-900/70 hover:border-white/18 hover:bg-slate-900/78'
                      }`}
                    >
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                        {metric.label}
                      </p>
                      <p className="mt-4 text-4xl font-semibold tracking-tight text-white">
                        {formatMetricValue(summaryValue.value)}
                      </p>
                      <p className="mt-4 text-sm leading-6 text-slate-300">
                        {formatDelta(summaryValue.changePercent)}
                      </p>
                    </button>
                  )
                })}
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <section className="rounded-[1.85rem] border border-white/10 bg-slate-900/65 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-4">
                    <div>
                      <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                        {selectedMetricOption?.label ?? 'Metric focus'}
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold text-white">
                        Trend in the selected range
                      </h2>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
                        {selectedMetricOption?.helper}
                      </p>
                    </div>
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Previous value
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {formatMetricValue(
                          metricsQuery.data.summary[selectedMetric].previousValue,
                        )}
                      </p>
                    </div>
                  </div>

                  <ol className="mt-5 space-y-3">
                    {series.map((bucket) => {
                      const metricValue = bucket[selectedMetric]
                      const width = `${Math.max(
                        6,
                        (metricValue / selectedMetricMax) * 100,
                      )}%`

                      return (
                        <li
                          key={bucket.bucketStart}
                          className="rounded-[1.4rem] border border-white/8 bg-slate-950/55 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-white">
                              {formatTimestamp(
                                bucket.bucketStart,
                                metricsQuery.data.filters.bucket,
                              )}
                            </span>
                            <span className="text-slate-300">
                              {formatMetricValue(metricValue)}
                            </span>
                          </div>
                          <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/6">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-amber-300"
                              style={{ width }}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </section>

                <aside className="space-y-6">
                  <section className="rounded-[1.85rem] border border-white/10 bg-slate-900/65 p-6">
                    <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-100/80">
                      Metric filters
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {metricOptions.map((metric) => {
                        const selected = metric.key === selectedMetric

                        return (
                          <button
                            key={metric.key}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              startTransition(() => {
                                setSelectedMetric(metric.key)
                              })
                            }}
                            className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                              selected
                                ? 'border-amber-300/35 bg-amber-300/12 text-amber-50'
                                : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/8'
                            }`}
                          >
                            {metric.label}
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section className="rounded-[1.85rem] border border-white/10 bg-slate-900/65 p-6">
                    <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
                      Current window
                    </p>
                    <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                      <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                        Starts {formatGeneratedAt(metricsQuery.data.filters.startAt)}
                      </li>
                      <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                        Ends {formatGeneratedAt(metricsQuery.data.filters.endAt)}
                      </li>
                      <li className="rounded-[1.3rem] border border-white/8 bg-white/5 px-4 py-3">
                        Bucketed by {metricsQuery.data.filters.bucket}
                      </li>
                    </ul>
                  </section>
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
