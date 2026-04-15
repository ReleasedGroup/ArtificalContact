import type { MeProfile } from '../lib/me'

interface ModerationQueueScreenProps {
  viewer: MeProfile
}

type ReportStatus = 'open' | 'triaged'
type Severity = 'low' | 'medium' | 'high'
type DeltaTone = 'positive' | 'warning' | 'neutral'

interface QueueStat {
  label: string
  value: string
  delta: string
  tone: DeltaTone
  detail?: string
}

interface QueueReport {
  id: string
  item: string
  reporter: string
  reason: string
  status: ReportStatus
  age: string
  severity: Severity
  autoFlagged?: string
  primaryAction: string
}

const queueStats: QueueStat[] = [
  {
    label: 'Queue depth (24h)',
    value: '24',
    delta: 'Down 18% vs prior 24h',
    tone: 'positive',
  },
  {
    label: 'Avg time to action',
    value: '42m',
    delta: 'Up 4m vs prior 24h',
    tone: 'warning',
  },
  {
    label: 'Auto-flagged by Content Safety',
    value: '7',
    delta: 'Images: 4 · Text: 3',
    tone: 'neutral',
  },
]

const queueReports: QueueReport[] = [
  {
    id: 'report-post-spam',
    item: 'Post #p_01HXY',
    reporter: '@diego',
    reason: 'Spam',
    status: 'open',
    age: '7m',
    severity: 'low',
    primaryAction: 'Hide post',
  },
  {
    id: 'report-image-nsfw',
    item: 'Image m_77',
    reporter: '@sora',
    reason: 'NSFW',
    status: 'open',
    age: '14m',
    severity: 'high',
    autoFlagged: 'Content Safety image flag',
    primaryAction: 'Remove media',
  },
  {
    id: 'report-reply-harassment',
    item: 'Reply #p_01HXZ',
    reporter: '@lena',
    reason: 'Harassment',
    status: 'triaged',
    age: '36m',
    severity: 'high',
    autoFlagged: 'Text escalation',
    primaryAction: 'Remove reply',
  },
  {
    id: 'report-post-misinfo',
    item: 'Post #p_01HYA',
    reporter: '@tomas',
    reason: 'Misinformation',
    status: 'open',
    age: '1h',
    severity: 'medium',
    primaryAction: 'Hide post',
  },
  {
    id: 'report-user-impersonation',
    item: 'User @bot7',
    reporter: '@mira',
    reason: 'Impersonation',
    status: 'open',
    age: '2h',
    severity: 'medium',
    primaryAction: 'Suspend user',
  },
]

function getDeltaClassName(tone: DeltaTone): string {
  switch (tone) {
    case 'positive':
      return 'text-emerald-300'
    case 'warning':
      return 'text-amber-300'
    default:
      return 'text-slate-400'
  }
}

function getStatusClassName(status: ReportStatus): string {
  return status === 'open'
    ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
    : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
}

function getSeverityClassName(severity: Severity): string {
  switch (severity) {
    case 'high':
      return 'border-rose-300/20 bg-rose-300/10 text-rose-100'
    case 'medium':
      return 'border-amber-300/20 bg-amber-300/10 text-amber-100'
    default:
      return 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
  }
}

function formatViewerRoles(roles: string[]): string {
  if (roles.length === 0) {
    return 'user'
  }

  return roles.join(' + ')
}

export function ModerationQueueScreen({
  viewer,
}: ModerationQueueScreenProps) {
  const openCount = queueReports.filter((report) => report.status === 'open').length
  const triagedCount = queueReports.filter(
    (report) => report.status === 'triaged',
  ).length

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),transparent_22%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.12),transparent_18%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-slate-950/70 px-6 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-300">
                <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1.5 text-fuchsia-100">
                  Moderator workspace
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Viewer roles: {formatViewerRoles(viewer.roles)}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1.5">
                  Reports container preview
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Moderation queue
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Reports stored in the{' '}
                  <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs text-cyan-100">
                    reports
                  </code>{' '}
                  Cosmos container, ready for the future moderation actions flow.
                  This screen mirrors the canonical mockup while the backing
                  <code className="mx-1 rounded bg-white/8 px-1.5 py-0.5 text-xs text-cyan-100">
                    modQueue
                  </code>
                  and
                  <code className="ml-1 rounded bg-white/8 px-1.5 py-0.5 text-xs text-cyan-100">
                    modAction
                  </code>{' '}
                  APIs land.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-medium text-amber-100">
                {openCount} open
              </span>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-100">
                {triagedCount} triaged
              </span>
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
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          {queueStats.map((stat) => (
            <article
              key={stat.label}
              className="rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur"
            >
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                {stat.label}
              </p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-white">
                {stat.value}
              </p>
              <p className={`mt-2 text-sm ${getDeltaClassName(stat.tone)}`}>
                {stat.delta}
              </p>
              {stat.detail ? (
                <p className="mt-1 text-xs text-slate-500">{stat.detail}</p>
              ) : null}
            </article>
          ))}
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 shadow-2xl shadow-slate-950/30 backdrop-blur">
          <div className="flex flex-col gap-3 border-b border-white/8 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Report queue</h2>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                Prioritise the oldest and most severe reports first, while keeping
                auto-flagged content visible to moderators for review.
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              Static preview data until the moderation API slice lands
            </div>
          </div>

          <div className="overflow-x-auto px-3 pb-4 pt-3 sm:px-4">
            <table className="min-w-full divide-y divide-white/8 text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-3 py-3 font-medium">Reported item</th>
                  <th className="px-3 py-3 font-medium">Reporter</th>
                  <th className="px-3 py-3 font-medium">Reason</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Age</th>
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {queueReports.map((report) => (
                  <tr key={report.id} className="bg-slate-900/35">
                    <td className="px-3 py-4 align-top">
                      <div className="space-y-2">
                        <p className="font-medium text-white">{report.item}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`rounded-full border px-2.5 py-1 font-medium uppercase tracking-[0.16em] ${getSeverityClassName(report.severity)}`}
                          >
                            {report.severity}
                          </span>
                          {report.autoFlagged ? (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                              {report.autoFlagged}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 align-top text-slate-300">
                      {report.reporter}
                    </td>
                    <td className="px-3 py-4 align-top text-slate-300">
                      {report.reason}
                    </td>
                    <td className="px-3 py-4 align-top">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStatusClassName(report.status)}`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td className="px-3 py-4 align-top text-slate-300">
                      {report.age}
                    </td>
                    <td className="px-3 py-4 align-top">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-300/15"
                        >
                          {report.primaryAction}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-white/12 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white transition hover:border-white/20 hover:bg-white/6"
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
