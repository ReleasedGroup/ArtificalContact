import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { WEB_BUILD_SHA } from './build-meta.generated'
import { getHealth, type HealthPayload } from './lib/health'
import {
  getMe,
  updateMe,
  type MeProfile,
  type ResolvedMeProfile,
  type UpdateMeInput,
} from './lib/me'
import { initializeTelemetry } from './lib/telemetry'

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthPayload }
  | { status: 'error'; message: string }

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; data: ResolvedMeProfile }
  | { status: 'error'; message: string }

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string }

interface ProfileDraft {
  displayName: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
}

const postLoginRedirectUri = encodeURIComponent('/')
const maxExpertiseTags = 12

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

function createDraft(user: MeProfile): ProfileDraft {
  return {
    displayName: user.displayName,
    bio: user.bio ?? '',
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    expertise: [...user.expertise],
  }
}

function normalizeTag(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function draftsMatchProfile(draft: ProfileDraft, user: MeProfile): boolean {
  return (
    draft.displayName.trim() === user.displayName &&
    normalizeOptionalText(draft.bio) === user.bio &&
    draft.avatarUrl === user.avatarUrl &&
    draft.bannerUrl === user.bannerUrl &&
    draft.expertise.length === user.expertise.length &&
    draft.expertise.every((tag, index) => tag === user.expertise[index])
  )
}

function getInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)

  if (parts.length === 0) {
    return 'ME'
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function formatJoinedDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function SignInRoute() {
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
                  aria-label={provider.label}
                  className="group relative overflow-hidden rounded-[1.75rem] border border-white/12 bg-white/5 p-6 text-left shadow-lg shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
                  href={provider.href}
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

function ProfileEditorRoute() {
  const [profileState, setProfileState] = useState<ProfileState>({
    status: 'loading',
  })
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [expertiseInput, setExpertiseInput] = useState('')
  const [tagMessage, setTagMessage] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'idle',
  })

  const loadProfile = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const data = await getMe(signal)
      startTransition(() => {
        setProfileState({ status: 'ready', data })
        setDraft(createDraft(data.user))
        setTagMessage(null)
        setSaveState({ status: 'idle' })
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unable to reach /api/me.'

      startTransition(() => {
        setProfileState({ status: 'error', message })
      })
    }
  })

  useEffect(() => {
    const controller = new AbortController()
    void loadProfile(controller.signal)

    return () => {
      controller.abort()
    }
  }, [])

  const currentUser = profileState.status === 'ready' ? profileState.data.user : null
  const canSave =
    profileState.status === 'ready' &&
    draft !== null &&
    saveState.status !== 'saving' &&
    !draftsMatchProfile(draft, profileState.data.user)

  const addExpertiseTag = () => {
    if (draft === null) {
      return
    }

    const normalizedTag = normalizeTag(expertiseInput)
    if (normalizedTag === null) {
      setTagMessage('Enter an expertise tag before adding it.')
      return
    }

    if (draft.expertise.includes(normalizedTag)) {
      setTagMessage(`"${normalizedTag}" is already on the profile.`)
      setExpertiseInput('')
      return
    }

    if (draft.expertise.length >= maxExpertiseTags) {
      setTagMessage(`Add at most ${maxExpertiseTags} expertise tags.`)
      return
    }

    setDraft({
      ...draft,
      expertise: [...draft.expertise, normalizedTag],
    })
    setExpertiseInput('')
    setTagMessage(null)
    setSaveState({ status: 'idle' })
  }

  const removeExpertiseTag = (tagToRemove: string) => {
    if (draft === null) {
      return
    }

    setDraft({
      ...draft,
      expertise: draft.expertise.filter((tag) => tag !== tagToRemove),
    })
    setTagMessage(null)
    setSaveState({ status: 'idle' })
  }

  const handleExpertiseKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') {
      return
    }

    event.preventDefault()
    addExpertiseTag()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (draft === null) {
      return
    }

    const payload: UpdateMeInput = {
      displayName: draft.displayName,
      bio: normalizeOptionalText(draft.bio),
      avatarUrl: draft.avatarUrl,
      bannerUrl: draft.bannerUrl,
      expertise: draft.expertise,
    }

    setSaveState({ status: 'saving' })
    setTagMessage(null)

    try {
      const data = await updateMe(payload)
      startTransition(() => {
        setProfileState({ status: 'ready', data })
        setDraft(createDraft(data.user))
        setSaveState({
          status: 'saved',
          message: data.isNewUser
            ? 'Profile created. You can keep refining it here.'
            : 'Profile saved.',
        })
      })
    } catch (error) {
      setSaveState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to save the profile right now.',
      })
    }
  }

  if (profileState.status === 'error') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-12 sm:px-8 lg:px-12">
        <section className="w-full rounded-[2rem] border border-rose-400/20 bg-slate-950/85 p-8 shadow-2xl shadow-rose-950/20 backdrop-blur sm:p-12">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-rose-200/80">
            /me profile
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            The profile editor could not load.
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-300">
            {profileState.message}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              href="/me"
            >
              Retry /me
            </a>
            <a
              className="rounded-full border border-white/10 px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
              href="/logout"
            >
              Sign out
            </a>
          </div>
        </section>
      </main>
    )
  }

  if (profileState.status === 'loading' || draft === null || currentUser === null) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-12 sm:px-8 lg:px-12">
        <section className="w-full rounded-[2rem] border border-white/10 bg-slate-950/80 p-8 shadow-2xl shadow-indigo-950/20 backdrop-blur sm:p-12">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-200/80">
            /me profile
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            Loading your profile editor.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
            Fetching the authenticated profile so the editor can populate your
            display name, bio, and expertise tags.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/85 shadow-2xl shadow-sky-950/20 backdrop-blur">
        <div className="relative h-52 overflow-hidden bg-gradient-to-br from-indigo-600 via-sky-500 to-fuchsia-600">
          {currentUser.bannerUrl ? (
            <img
              alt="Profile banner"
              className="h-full w-full object-cover"
              src={currentUser.bannerUrl}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.14),transparent_55%)]" />
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/20 bg-slate-950/25 px-4 py-3 text-sm text-slate-100 backdrop-blur">
                Banner upload is a placeholder in Sprint 1. Real media upload
                lands in Sprint 3.
              </div>
            </>
          )}
        </div>

        <div className="px-4 pb-8 sm:px-6 lg:px-8">
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/20 bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-2xl font-semibold text-white shadow-xl shadow-fuchsia-950/30 ring-4 ring-slate-950 sm:h-28 sm:w-28 sm:text-3xl">
                {currentUser.avatarUrl ? (
                  <img
                    alt="Profile avatar"
                    className="h-full w-full object-cover"
                    src={currentUser.avatarUrl}
                  />
                ) : (
                  getInitials(draft.displayName)
                )}
              </div>
              <div className="pb-2">
                <p className="text-sm uppercase tracking-[0.24em] text-sky-200/75">
                  /me profile
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Edit your profile
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pb-2 text-sm">
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-200">
                Web build {WEB_BUILD_SHA}
              </span>
              <a
                className="rounded-full border border-white/10 px-4 py-2 font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
                href="/logout"
              >
                Sign out
              </a>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
            <span>
              {currentUser.handle ? `@${currentUser.handle}` : 'Handle pending'}
            </span>
            <span className="text-slate-600">·</span>
            <span>Status {currentUser.status}</span>
            <span className="text-slate-600">·</span>
            <span>Joined {formatJoinedDate(currentUser.createdAt)}</span>
            <span className="text-slate-600">·</span>
            <span>Updated {formatTimestamp(currentUser.updatedAt)}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
            <span>
              <span className="font-semibold text-white">
                {currentUser.counters.following}
              </span>{' '}
              Following
            </span>
            <span>
              <span className="font-semibold text-white">
                {currentUser.counters.followers}
              </span>{' '}
              Followers
            </span>
            <span>
              <span className="font-semibold text-white">
                {currentUser.counters.posts}
              </span>{' '}
              Posts
            </span>
          </div>

          {(currentUser.status === 'pending' || profileState.data.isNewUser) && (
            <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Finish the public-facing parts of your profile here. Avatar and
              banner uploads stay in placeholder mode until Sprint 3.
            </div>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <form
              className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6"
              onSubmit={handleSubmit}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-200/75">
                    Profile fields
                  </p>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                    Update your display name, public bio, and expertise tags.
                    The save action writes to <code>/api/me</code>.
                  </p>
                </div>
                <button
                  className="rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={!canSave}
                  type="submit"
                >
                  {saveState.status === 'saving' ? 'Saving…' : 'Save profile'}
                </button>
              </div>

              <div className="mt-8 grid gap-5">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    Display name
                  </span>
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-base text-white outline-none transition focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/30"
                    maxLength={80}
                    name="displayName"
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        displayName: event.target.value,
                      })
                      setSaveState({ status: 'idle' })
                    }}
                    placeholder="How people should know you"
                    value={draft.displayName}
                  />
                </label>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      className="text-sm font-medium text-slate-200"
                      htmlFor="bio"
                    >
                      Bio
                    </label>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {draft.bio.length}/280
                    </span>
                  </div>
                  <textarea
                    className="min-h-36 rounded-[1.5rem] border border-white/10 bg-slate-950/80 px-4 py-3 text-base leading-7 text-white outline-none transition focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/30"
                    id="bio"
                    maxLength={280}
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        bio: event.target.value,
                      })
                      setSaveState({ status: 'idle' })
                    }}
                    placeholder="Tell the network what you build, study, or ship."
                    value={draft.bio}
                  />
                </div>

                <div className="grid gap-3">
                  <div>
                    <label
                      className="text-sm font-medium text-slate-200"
                      htmlFor="expertise"
                    >
                      Expertise tags
                    </label>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Add up to {maxExpertiseTags} tags to describe the areas
                      you want associated with your public profile.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      className="flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-base text-white outline-none transition focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/30"
                      id="expertise"
                      onChange={(event) => {
                        setExpertiseInput(event.target.value)
                        setTagMessage(null)
                      }}
                      onKeyDown={handleExpertiseKeyDown}
                      placeholder="rag, evals, agents"
                      value={expertiseInput}
                    />
                    <button
                      className="rounded-full border border-white/10 px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
                      type="button"
                      onClick={addExpertiseTag}
                    >
                      Add tag
                    </button>
                  </div>

                  {tagMessage && (
                    <p className="text-sm text-amber-200">{tagMessage}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {draft.expertise.length === 0 && (
                      <span className="rounded-full border border-dashed border-white/10 px-4 py-2 text-sm text-slate-500">
                        No expertise tags yet
                      </span>
                    )}

                    {draft.expertise.map((tag) => (
                      <button
                        key={tag}
                        className="rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-300/15"
                        type="button"
                        onClick={() => removeExpertiseTag(tag)}
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
                {saveState.status === 'saved' && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-emerald-100">
                    {saveState.message}
                  </span>
                )}
                {saveState.status === 'error' && (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-rose-100">
                    {saveState.message}
                  </span>
                )}
                {!canSave && saveState.status === 'idle' && (
                  <span className="text-slate-500">
                    {draftsMatchProfile(draft, currentUser)
                      ? 'No unsaved changes.'
                      : 'Complete the form to save your profile.'}
                  </span>
                )}
              </div>
            </form>

            <aside className="grid gap-6">
              <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-200/75">
                  Media placeholders
                </p>
                <div className="mt-5 grid gap-4">
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-sm font-medium text-white">Avatar</p>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Upload is intentionally disabled in Sprint 1. The current
                      monogram preview keeps the profile layout stable until the
                      blob upload pipeline lands.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-sm font-medium text-white">Banner</p>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      The banner slot is wired as a placeholder panel only.
                      When media upload arrives, this surface can switch to the
                      shared asset flow without a layout rewrite.
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-200/75">
                  Public preview
                </p>
                <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-lg font-semibold text-white">
                      {getInitials(draft.displayName)}
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-white">
                        {draft.displayName.trim() || 'Display name'}
                      </p>
                      <p className="text-sm text-slate-400">
                        {currentUser.handle
                          ? `@${currentUser.handle}`
                          : 'Handle pending'}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-7 text-slate-300">
                    {normalizeOptionalText(draft.bio) ??
                      'Your public bio appears here after you save it.'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.expertise.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200"
                      >
                        {tag}
                      </span>
                    ))}
                    {draft.expertise.length === 0 && (
                      <span className="rounded-full border border-dashed border-white/10 px-3 py-1.5 text-sm text-slate-500">
                        Expertise tags will show here
                      </span>
                    )}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  )
}

function App() {
  useEffect(() => {
    initializeTelemetry()
  }, [])

  if (window.location.pathname === '/me') {
    return <ProfileEditorRoute />
  }

  return <SignInRoute />
}

export default App
