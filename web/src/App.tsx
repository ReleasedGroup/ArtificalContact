import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  startTransition,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { ComposerPreviewPanel } from './components/ComposerPreviewPanel'
import { DirectBlobUploadCard } from './components/DirectBlobUploadCard'
import { HomeFeedScreen } from './components/HomeFeedScreen'
import { ModerationQueueScreen } from './components/ModerationQueueScreen'
import { NotificationsScreen } from './components/NotificationsScreen'
import { PostDetailScreen } from './components/PostDetailScreen'
import { SearchResultsScreen } from './components/SearchResultsScreen'
import { ThreadWorkspacePanel } from './components/ThreadWorkspacePanel'
import { WEB_BUILD_SHA } from './build-meta.generated'
import { signOut } from './lib/auth'
import { getHealth, type HealthPayload } from './lib/health'
import {
  getMe,
  getOptionalMe,
  updateMe,
  type MeProfile,
  type ResolvedMeProfile,
  type UpdateMeInput,
} from './lib/me'
import {
  getPublicUserProfile,
  PublicProfileNotFoundError,
  type PublicUserProfile,
} from './lib/public-profile'
import type { SearchType } from './lib/search'
import type { UploadedBlobResult } from './lib/media-upload'
import { initializeTelemetry } from './lib/telemetry'

type AppRoute =
  | { kind: 'home' }
  | { kind: 'me' }
  | { kind: 'moderation' }
  | { kind: 'notifications' }
  | { kind: 'post'; postId: string }
  | { kind: 'profile'; handle: string }
  | { kind: 'search'; query: string; type: SearchType }

type PublicProfileState =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicUserProfile }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }

type PublicProfileStatusState = Exclude<
  PublicProfileState,
  { status: 'ready'; data: PublicUserProfile }
>

type EditorProfileState =
  | { status: 'loading' }
  | { status: 'ready'; data: ResolvedMeProfile }
  | { status: 'error'; message: string }

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string }

interface ProfileDraft {
  handle: string
  displayName: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  expertise: string[]
}

type ProfileMediaField = 'avatarUrl' | 'bannerUrl'

const postLoginRedirectUri = encodeURIComponent('/')
const maxExpertiseTags = 12
const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

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
    helperText: 'Returns to the home feed after Microsoft authentication.',
  },
  {
    label: 'Continue with GitHub',
    href: getAuthLoginHref('github'),
    description:
      'Use GitHub sign-in for the practitioner identity and repository-connected workflows.',
    gradientClass: 'from-amber-300/30 via-orange-300/15 to-transparent',
    badge: 'GH',
    helperText: 'Returns to the home feed after GitHub authentication.',
  },
]

const profileMilestones = [
  'Land in the authenticated home feed after the Static Web Apps handshake.',
  'Open /me to claim a unique public handle and complete your profile.',
  'Follow people so their next posts materialise in your personalised feed.',
]

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function getCurrentRoute(
  pathname = window.location.pathname,
  search = window.location.search,
): AppRoute {
  if (/^\/search\/?$/.test(pathname)) {
    const searchParams = new URLSearchParams(search)
    const rawType = searchParams.get('type')
    const type: SearchType =
      rawType === 'users' || rawType === 'hashtags' ? rawType : 'posts'

    return {
      kind: 'search',
      query: searchParams.get('q') ?? '',
      type,
    }
  }

  if (/^\/me\/?$/.test(pathname)) {
    return { kind: 'me' }
  }

  if (/^\/notifications\/?$/.test(pathname)) {
    return { kind: 'notifications' }
  }

  if (/^\/moderation\/?$/.test(pathname)) {
    return { kind: 'moderation' }
  }

  const postDetailMatch = /^\/p\/([^/]+)\/?$/.exec(pathname)
  if (postDetailMatch) {
    return {
      kind: 'post',
      postId: decodePathSegment(postDetailMatch[1]),
    }
  }

  const publicProfileMatch = /^\/u\/([^/]+)\/?$/.exec(pathname)
  if (publicProfileMatch) {
    return {
      kind: 'profile',
      handle: decodePathSegment(publicProfileMatch[1]),
    }
  }

  return { kind: 'home' }
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

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function createDraft(user: MeProfile): ProfileDraft {
  return {
    handle: user.handle ?? '',
    displayName: user.displayName,
    bio: user.bio ?? '',
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    expertise: [...user.expertise],
  }
}

function buildMediaUpdateInput(
  field: ProfileMediaField,
  value: string | null,
): UpdateMeInput {
  return field === 'avatarUrl' ? { avatarUrl: value } : { bannerUrl: value }
}

function updateDraftMediaField(
  draft: ProfileDraft,
  field: ProfileMediaField,
  value: string | null,
): ProfileDraft {
  return field === 'avatarUrl'
    ? {
        ...draft,
        avatarUrl: value,
      }
    : {
        ...draft,
        bannerUrl: value,
      }
}

function normalizeHandleInput(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
    normalizeHandleInput(draft.handle) === user.handle &&
    draft.displayName.trim() === user.displayName &&
    normalizeOptionalText(draft.bio) === user.bio &&
    draft.avatarUrl === user.avatarUrl &&
    draft.bannerUrl === user.bannerUrl &&
    draft.expertise.length === user.expertise.length &&
    draft.expertise.every((tag, index) => tag === user.expertise[index])
  )
}

function getEditorInitials(displayName: string): string {
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

function buildProfileMonogram(profile: PublicUserProfile): string {
  const source = profile.displayName?.trim() || profile.handle.trim()
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function getPublicProfileHref(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`
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

  if (route.kind === 'search') {
    return (
      <SearchResultsScreen
        key={`${route.type}:${route.query}`}
        initialQuery={route.query}
        initialType={route.type}
      />
    )
  }

  if (route.kind === 'post') {
    return <PostDetailScreen postId={route.postId} />
  }

  if (route.kind === 'me') {
    return <ProfileEditorScreen />
  }

  if (route.kind === 'notifications') {
    return <NotificationsRouteScreen />
  }

  if (route.kind === 'moderation') {
    return <ModerationRouteScreen />
  }

  return <HomeRouteScreen />
}

interface OptionalMeGateProps {
  loadingLabel: string
  loadingTitle: string
  loadingBody: string
  errorLabel: string
  errorTitle: string
  render: (viewer: MeProfile) => ReactElement
}

function OptionalMeGate({
  loadingLabel,
  loadingTitle,
  loadingBody,
  errorLabel,
  errorTitle,
  render,
}: OptionalMeGateProps) {
  const viewerQuery = useQuery<ResolvedMeProfile | null>({
    queryKey: ['optional-me'],
    queryFn: ({ signal }) => getOptionalMe(signal),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  if (viewerQuery.isPending) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-8 sm:px-8 lg:px-12">
        <section className="w-full rounded-[2rem] border border-white/10 bg-slate-950/85 px-8 py-16 text-center shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            {loadingLabel}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {loadingTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            {loadingBody}
          </p>
        </section>
      </main>
    )
  }

  if (viewerQuery.isError) {
    const errorMessage =
      viewerQuery.error instanceof Error
        ? viewerQuery.error.message
        : 'Unable to verify the authenticated profile session.'

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-8 sm:px-8 lg:px-12">
        <section className="w-full rounded-[2rem] border border-rose-400/20 bg-slate-950/85 px-8 py-16 text-center shadow-2xl shadow-rose-950/20 backdrop-blur">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-rose-100/80">
            {errorLabel}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {errorTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-8 rounded-full border border-white/12 px-5 py-3 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/6 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
          >
            Retry session check
          </button>
        </section>
      </main>
    )
  }

  if (viewerQuery.data === null) {
    return <SignInScreen />
  }

  return render(viewerQuery.data.user)
}

function NotificationsRouteScreen() {
  return (
    <OptionalMeGate
      loadingLabel="Notifications"
      loadingTitle="Loading your notification feed"
      loadingBody="Checking the current Static Web Apps session before loading the authenticated in-app notification view."
      errorLabel="Notification feed unavailable"
      errorTitle="The session check failed"
      render={(viewer) => <NotificationsScreen viewer={viewer} />}
    />
  )
}

function ModerationRouteScreen() {
  return (
    <OptionalMeGate
      loadingLabel="Moderation"
      loadingTitle="Loading the moderator queue"
      loadingBody="Checking the current Static Web Apps session before loading the moderator queue preview."
      errorLabel="Moderator queue unavailable"
      errorTitle="The session check failed"
      render={(viewer) => <ModerationQueueScreen viewer={viewer} />}
    />
  )
}

function HomeRouteScreen() {
  return (
    <OptionalMeGate
      loadingLabel="Home feed"
      loadingTitle="Loading your home feed"
      loadingBody="Checking the current Static Web Apps session before deciding whether to show the authenticated feed or the public sign-in shell."
      errorLabel="Home feed unavailable"
      errorTitle="The session check failed"
      render={(viewer) => <HomeFeedScreen viewer={viewer} />}
    />
  )
}

function SignInScreen() {
  const queryClient = useQueryClient()
  const healthQuery = useQuery<HealthPayload>({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

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
                  Anonymous routes stay public, while the personalised home feed
                  and profile editor stay behind the Static Web Apps auth gate.
                </p>
                <p>
                  Both providers return to the authenticated home route after
                  successful authentication so the sign-in handoff is
                  predictable in every preview environment.
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

                {healthQuery.isSuccess && (
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

function ProfileEditorScreen() {
  const queryClient = useQueryClient()
  const [profileState, setProfileState] = useState<EditorProfileState>({
    status: 'loading',
  })
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [expertiseInput, setExpertiseInput] = useState('')
  const [tagMessage, setTagMessage] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'idle',
  })

  useEffect(() => {
    const controller = new AbortController()

    const loadProfile = async () => {
      try {
        const data = await getMe(controller.signal)
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

        startTransition(() => {
          setProfileState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Unable to reach /api/me.',
          })
        })
      }
    }

    void loadProfile()

    return () => {
      controller.abort()
    }
  }, [])

  function handleSignOut() {
    signOut({ queryClient })
  }

  const currentUser =
    profileState.status === 'ready' ? profileState.data.user : null
  const normalizedDraftHandle = draft
    ? normalizeHandleInput(draft.handle)
    : null
  const previewHandle = normalizedDraftHandle ?? currentUser?.handle ?? null
  const publicProfileHref = currentUser?.handle
    ? getPublicProfileHref(currentUser.handle)
    : null

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

  const handleProfileMediaUploaded =
    (field: ProfileMediaField) => async (upload: UploadedBlobResult) => {
      const previousMediaValue = currentUser?.[field] ?? null

      setDraft((currentDraft) => {
        if (currentDraft === null) {
          return currentDraft
        }

        return updateDraftMediaField(currentDraft, field, upload.blobUrl)
      })
      setSaveState({ status: 'idle' })

      try {
        const data = await updateMe(buildMediaUpdateInput(field, upload.blobUrl))

        startTransition(() => {
          setProfileState((currentState) => {
            if (currentState.status !== 'ready') {
              return currentState
            }

            return {
              status: 'ready',
              data: {
                user: data.user,
                isNewUser: currentState.data.isNewUser,
              },
            }
          })
          setDraft((currentDraft) => {
            if (currentDraft === null) {
              return createDraft(data.user)
            }

            return {
              ...currentDraft,
              avatarUrl: data.user.avatarUrl,
              bannerUrl: data.user.bannerUrl,
            }
          })
        })
      } catch (error) {
        setDraft((currentDraft) => {
          if (currentDraft === null) {
            return currentDraft
          }

          return updateDraftMediaField(currentDraft, field, previousMediaValue)
        })

        throw error instanceof Error
          ? error
          : new Error('Unable to update the profile media right now.')
      }
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (draft === null || profileState.status !== 'ready') {
      return
    }

    const normalizedHandle = normalizeHandleInput(draft.handle)
    if (normalizedHandle === null) {
      setSaveState({
        status: 'error',
        message: 'Choose a public handle before saving your profile.',
      })
      return
    }

    const wasNewUser = profileState.data.isNewUser
    const payload: UpdateMeInput = {
      handle: normalizedHandle,
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
        setProfileState({
          status: 'ready',
          data: {
            user: data.user,
            isNewUser: false,
          },
        })
        setDraft(createDraft(data.user))
        setSaveState({
          status: 'saved',
          message: wasNewUser
            ? 'Profile created. Your public profile is live.'
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
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full border border-white/10 px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (
    profileState.status === 'loading' ||
    draft === null ||
    currentUser === null
  ) {
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

  const canSave =
    saveState.status !== 'saving' &&
    normalizedDraftHandle !== null &&
    !draftsMatchProfile(draft, currentUser)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/85 shadow-2xl shadow-sky-950/20 backdrop-blur">
        <div className="relative h-52 overflow-hidden bg-gradient-to-br from-indigo-600 via-sky-500 to-fuchsia-600">
          {draft.bannerUrl ? (
            <img
              alt="Profile banner"
              className="h-full w-full object-cover"
              src={draft.bannerUrl}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.14),transparent_55%)]" />
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/20 bg-slate-950/25 px-4 py-3 text-sm text-slate-100 backdrop-blur">
                Upload a banner from the profile media panel to replace this
                gradient preview.
              </div>
            </>
          )}
        </div>

        <div className="px-4 pb-8 sm:px-6 lg:px-8">
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/20 bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-2xl font-semibold text-white shadow-xl shadow-fuchsia-950/30 ring-4 ring-slate-950 sm:h-28 sm:w-28 sm:text-3xl">
                {draft.avatarUrl ? (
                  <img
                    alt="Profile avatar"
                    className="h-full w-full object-cover"
                    src={draft.avatarUrl}
                  />
                ) : (
                  getEditorInitials(draft.displayName)
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
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-white/10 px-4 py-2 font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/5"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
            <span>
              {currentUser.handle ? `@${currentUser.handle}` : 'Handle pending'}
            </span>
            <span className="text-slate-600">.</span>
            <span>Status {currentUser.status}</span>
            <span className="text-slate-600">.</span>
            <span>
              Joined {formatJoinedDate(currentUser.createdAt) ?? 'Unknown'}
            </span>
            <span className="text-slate-600">.</span>
            <span>
              Updated {formatTimestamp(currentUser.updatedAt) ?? 'Unknown'}
            </span>
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

          {(currentUser.status === 'pending' ||
            profileState.data.isNewUser) && (
            <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Choose a public handle and finish the rest of the public-facing
              profile fields here. Avatar and banner uploads save immediately
              once each file finishes uploading.
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
                    Claim the handle visitors will use at{' '}
                    <code>/u/{'{handle}'}</code>, then update your display name,
                    public bio, and expertise tags. The save action writes to{' '}
                    <code>/api/me</code>.
                  </p>
                </div>
                <button
                  className="rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={!canSave}
                  type="submit"
                >
                  {saveState.status === 'saving' ? 'Saving...' : 'Save profile'}
                </button>
              </div>

              <div className="mt-8 grid gap-5">
                <label className="grid gap-2" htmlFor="handle">
                  <span className="text-sm font-medium text-slate-200">
                    Public handle
                  </span>
                  <input
                    aria-label="Public handle"
                    className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-base text-white outline-none transition focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/30"
                    id="handle"
                    maxLength={80}
                    name="handle"
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        handle: event.target.value,
                      })
                      setSaveState({ status: 'idle' })
                    }}
                    placeholder="ada"
                    value={draft.handle}
                  />
                  <span className="text-sm leading-7 text-slate-400">
                    Choose the handle people will use to open your public
                    profile. Saving a handle promotes pending profiles to
                    active.
                  </span>
                </label>

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
                      : 'Choose a handle and complete the form to save your profile.'}
                  </span>
                )}
                {publicProfileHref && (
                  <a
                    href={publicProfileHref}
                    className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
                  >
                    View public profile
                  </a>
                )}
              </div>
            </form>

            <aside className="grid gap-6">
              <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-fuchsia-200/75">
                  Profile media
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Avatar and banner uploads reuse the shared signed SAS pipeline
                  from the composer preview, then persist the resulting Blob URL
                  into <code>/api/me</code> as soon as the upload completes.
                </p>
                <div className="mt-5 grid gap-4">
                  <DirectBlobUploadCard
                    accept="image/avif,image/jpeg,image/png,image/webp"
                    description="Uploads a still image through the shared direct-to-blob flow, then saves it as your profile avatar."
                    helperText="AVIF, JPEG, PNG, or WebP up to 8 MB. Upload completion saves immediately."
                    kind="image"
                    onUploaded={handleProfileMediaUploaded('avatarUrl')}
                    title="Avatar upload"
                  />
                  <DirectBlobUploadCard
                    accept="image/avif,image/jpeg,image/png,image/webp"
                    description="Streams a wide image through the same upload pipeline and saves it as your public profile banner."
                    helperText="AVIF, JPEG, PNG, or WebP up to 8 MB. Upload completion saves immediately."
                    kind="image"
                    onUploaded={handleProfileMediaUploaded('bannerUrl')}
                    title="Banner upload"
                  />
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-200/75">
                  Public preview
                </p>
                <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-lg font-semibold text-white">
                      {draft.avatarUrl ? (
                        <img
                          alt="Draft avatar preview"
                          className="h-full w-full object-cover"
                          src={draft.avatarUrl}
                        />
                      ) : (
                        getEditorInitials(draft.displayName)
                      )}
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-white">
                        {draft.displayName.trim() || 'Display name'}
                      </p>
                      <p className="text-sm text-slate-400">
                        {previewHandle ? `@${previewHandle}` : 'Handle pending'}
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

          <ComposerPreviewPanel
            authorBadge={getEditorInitials(draft.displayName)}
            authorHandle={previewHandle}
            authorName={draft.displayName.trim() || 'Display name'}
          />
          <ThreadWorkspacePanel
            authorBadge={getEditorInitials(draft.displayName)}
            authorHandle={previewHandle}
            authorName={draft.displayName.trim() || 'Display name'}
            user={currentUser}
          />
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
    startTransition(() => {
      setProfileState({ status: 'loading' })
    })

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
                and renders the profile shell. Profile posts and richer social
                graph views arrive in later slices once those read models are in
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
