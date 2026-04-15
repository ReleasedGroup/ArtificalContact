import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../lib/notification-preferences'
import {
  getBrowserPushSupport,
  subscribeToBrowserPush,
  unsubscribeFromBrowserPush,
} from '../lib/web-push'

const notificationPreferencesQueryKey = ['notification-preferences']

function getStatusLabel(
  status: 'enabled' | 'disabled' | 'unsupported' | 'unconfigured',
) {
  switch (status) {
    case 'enabled':
      return 'Enabled'
    case 'unsupported':
      return 'Unsupported browser'
    case 'unconfigured':
      return 'Env not configured'
    default:
      return 'Disabled'
  }
}

function getStatusTone(
  status: 'enabled' | 'disabled' | 'unsupported' | 'unconfigured',
) {
  switch (status) {
    case 'enabled':
      return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
    case 'unsupported':
      return 'border-amber-300/20 bg-amber-300/10 text-amber-100'
    case 'unconfigured':
      return 'border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100'
    default:
      return 'border-white/10 bg-white/5 text-slate-200'
  }
}

export function BrowserPushCard() {
  const queryClient = useQueryClient()
  const [submitState, setSubmitState] = useState<
    | { status: 'idle' }
    | { status: 'saving' }
    | { status: 'success'; message: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  const preferencesQuery = useQuery({
    queryKey: notificationPreferencesQueryKey,
    queryFn: ({ signal }) => getNotificationPreferences(signal),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const browserPushSupport = getBrowserPushSupport(
    import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY,
  )
  const isEnabled =
    browserPushSupport.available &&
    preferencesQuery.data?.webPush.subscription !== null &&
    preferencesQuery.data?.webPush.subscription !== undefined

  const status = isEnabled
    ? 'enabled'
    : browserPushSupport.reason === 'unsupported_browser'
      ? 'unsupported'
      : browserPushSupport.reason === 'missing_vapid_public_key'
        ? 'unconfigured'
        : 'disabled'

  const description =
    status === 'enabled'
      ? 'This browser has an active VAPID subscription stored in your notification preferences document.'
      : status === 'unsupported'
        ? 'Browser push stays suppressed when Notifications, Service Workers, or PushManager are unavailable.'
        : status === 'unconfigured'
          ? 'Set VITE_WEB_PUSH_PUBLIC_KEY to expose the public VAPID key before attempting browser subscriptions in this environment.'
          : browserPushSupport.permission === 'denied'
            ? 'This browser supports push, but notifications are currently blocked for the site. Update the site permission in the browser, then try again.'
            : 'Enable browser push to register a service worker, create a VAPID subscription, and persist it via /api/me/notifications.'

  async function handleEnable() {
    const vapidPublicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim()

    if (!vapidPublicKey) {
      setSubmitState({
        status: 'error',
        message:
          'Browser push is not configured for this environment because the public VAPID key is missing.',
      })
      return
    }

    setSubmitState({ status: 'saving' })

    try {
      const subscription = await subscribeToBrowserPush(vapidPublicKey)
      const preferences = await updateNotificationPreferences({
        webPush: {
          supported: true,
          subscription,
        },
      })

      queryClient.setQueryData(notificationPreferencesQueryKey, preferences)
      setSubmitState({
        status: 'success',
        message: 'Browser push is enabled for this account.',
      })
    } catch (error) {
      setSubmitState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to enable browser push.',
      })
    }
  }

  async function handleDisable() {
    setSubmitState({ status: 'saving' })

    try {
      await unsubscribeFromBrowserPush()
      const preferences = await updateNotificationPreferences({
        webPush: {
          supported: false,
        },
      })

      queryClient.setQueryData(notificationPreferencesQueryKey, preferences)
      setSubmitState({
        status: 'success',
        message: 'Browser push is disabled for this account.',
      })
    } catch (error) {
      setSubmitState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to disable browser push.',
      })
    }
  }

  return (
    <article className="mt-5 rounded-[1.75rem] border border-white/10 bg-slate-900/65 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.24em]">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
              Browser delivery
            </span>
            <span
              className={`rounded-full border px-3 py-1.5 ${getStatusTone(status)}`}
            >
              {getStatusLabel(status)}
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white">
              Web Push (best-effort)
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              Permission:{' '}
              {browserPushSupport.permission === 'unsupported'
                ? 'unsupported'
                : browserPushSupport.permission}
            </span>
            {preferencesQuery.data?.webPush.subscription?.endpoint && (
              <span className="rounded-full border border-white/10 px-3 py-1.5">
                Subscription stored
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {status !== 'unsupported' &&
            status !== 'unconfigured' &&
            !isEnabled && (
              <button
                type="button"
                onClick={() => {
                  void handleEnable()
                }}
                disabled={
                  preferencesQuery.isPending || submitState.status === 'saving'
                }
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
              >
                Enable browser push
              </button>
            )}

          {isEnabled && (
            <button
              type="button"
              onClick={() => {
                void handleDisable()
              }}
              disabled={submitState.status === 'saving'}
              className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/6 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-400"
            >
              Disable browser push
            </button>
          )}
        </div>
      </div>

      {preferencesQuery.isPending && (
        <p className="mt-4 text-sm leading-7 text-slate-400">
          Loading the stored notification preference document…
        </p>
      )}

      {preferencesQuery.isError && (
        <p className="mt-4 text-sm leading-7 text-rose-200">
          {preferencesQuery.error instanceof Error
            ? preferencesQuery.error.message
            : 'Unable to load the current notification preferences.'}
        </p>
      )}

      {submitState.status === 'success' && (
        <p className="mt-4 text-sm leading-7 text-emerald-200">
          {submitState.message}
        </p>
      )}

      {submitState.status === 'error' && (
        <p className="mt-4 text-sm leading-7 text-rose-200">
          {submitState.message}
        </p>
      )}
    </article>
  )
}
