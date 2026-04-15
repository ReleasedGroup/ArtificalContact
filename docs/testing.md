# Testing Guide

## Automated checks

Run the full repository validation from the root:

```bash
npm install
npm run build
npm run lint
npm run test
```

## Workspace coverage

### `web`

- Vitest + Testing Library validate that the sign-in screen renders both Static Web Apps auth provider links, clears the TanStack Query cache on sign-out, and displays a successful `/api/health` response
- Vitest + Testing Library validate that the authenticated `/` home route renders the personalised feed, loads additional pages through infinite scroll, and supports touch pull-to-refresh
- Vitest + Testing Library validate that `/u/{handle}` renders the public profile shell, surfaces the API-backed not-found state, and returns to loading immediately when the handle changes
- Vitest + Testing Library validate that `/p/{id}` loads the standalone post detail view, fetches thread context, and handles missing-post states safely
- Vitest + Testing Library validate that `/p/{id}` renders mixed-media posts with inline image, GIF, video, and audio attachments
- Vitest + Testing Library validate that authenticated `/p/{id}` viewers can search Tenor-backed GIFs and publish GIF-only replies into the thread
- Vitest + Testing Library validate the authenticated `/me` profile editor flow, including initial profile loading, error rendering, and `PUT /api/me` saves
- Vitest + Testing Library validate the authenticated `/me` thread workspace publish flow, plus authenticated reply and delete actions on `/p/{id}`
- Playwright covers the Sprint 1 golden path: GitHub sign-in handoff to `/me`, initial handle claim, and navigation to the resulting public profile at `/u/{handle}`
- Playwright covers the mixed-media `/p/{id}` route on desktop and mobile viewports, including image, GIF, video, and audio attachments
- Playwright covers the Sprint 2 thread path: user A publishes a root post, user B replies on the standalone thread page, both users see the shared thread, and a soft-deleted reply disappears from view while the backing document remains in the mocked store
- ESLint enforces the TypeScript/React code style
- Vite production build verifies the SPA compiles cleanly

### `api`

- Vitest covers the health envelope generation and HTTP handler behavior
- Vitest covers post-content validation utilities, including configurable max-length enforcement plus hashtag and mention parsing
- Vitest covers authenticated profile reads and updates at `GET /api/me` and `PUT /api/me`, including JIT provisioning, validation, and normalization
- Vitest covers authenticated reply creation at `POST /api/posts/{id}/replies`, including parent lookup, nested thread inheritance, validation, and repository failure handling
- Vitest covers authenticated Tenor GIF search at `GET /api/gifs/search`, including auth enforcement, configuration failures, and upstream error handling
- Vitest covers authenticated post creation at `POST /api/posts`, including max-length validation, hashtag and mention parsing, denormalised author fields, and repository failure handling
- Vitest covers the Tenor search client and upstream response mapping used by the GIF reply picker
- Vitest covers authenticated follow creation and removal at `POST/DELETE /api/users/{handle}/follow`, including idempotent writes, self-target rejection, validation, and follow-store failure handling
- Vitest covers authenticated feed reads at `GET /api/feed`, including cursor pagination, normalized denormalised entries, and feed-store failure handling
- Vitest covers the user-profile change-feed worker that refreshes denormalised post author fields after profile updates, including avatar removal and duplicate change-feed image collapse
- Vitest covers the public profile lookup at `GET /api/users/{handle}`, including case-insensitive mirror resolution and safe not-found behavior
- Vitest covers the paginated following lookup at `GET /api/users/{handle}/following`, including invalid limits, continuation tokens, and filtering of missing or non-public followees
- Vitest covers the public followers list at `GET /api/users/{handle}/followers`, including pagination, case-insensitive target resolution, and filtering stale or non-public follower records
- Vitest covers Static Web Apps principal decoding and HTTP auth role attachment for anonymous, user, moderator, admin, and malformed-principal request paths
- Vitest covers `PUT /api/me`, including duplicate-handle rejection via `usersByHandle`
- Vitest covers the `usersByHandle` change-feed mirror logic, including stale-handle cleanup and non-fatal collision handling
- Vitest covers the `followersMirrorFn` change-feed mirror logic, including deterministic ids, soft-delete cleanup, duplicate deliveries, and invalid-document skips
- Vitest covers the follow-counter change-feed logic, including inserts, soft deletes, duplicate deliveries, and missing-user safety
- Vitest covers the `counterFn` reply-counter change-feed logic, including inserts, soft deletes, duplicate deliveries, and missing-parent safety
- Vitest covers the `reactionCounterFn` reaction-counter change-feed logic, including idempotent recomputation, additive emoji totals, duplicate deliveries, and missing-post safety
- Vitest covers the `feedFanOutFn` worker, including duplicate deliveries, follower cap enforcement, and safe skips for replies, GitHub posts, and deleted posts
- Vitest covers the Sprint 4 synthetic 10k-follower load scenario, including the capped fan-out RU budget model and the pull-on-read fallback for overflow followers
- Vitest covers the media post-processing logic, default visual generation, and function dependency wiring, including deterministic `media` upserts, content-safety flagging, derived-blob recursion guards, public media URL rewriting, and image thumbnail variant generation
- TypeScript compilation validates the Azure Functions source and module graph
- ESLint checks the Node/TypeScript implementation

## Infrastructure validation

Compile the Bicep entrypoint locally to catch template issues:

```bash
az bicep build --only-show-errors --file infra/main.bicep --outfile infra/main.json
```

Delete `infra/main.json` after validation or leave it ignored via `.gitignore`.
