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
- Vitest + Testing Library validate that `/u/{handle}` renders the public profile shell, surfaces the API-backed not-found state, and returns to loading immediately when the handle changes
- Vitest + Testing Library validate that `/p/{id}` loads the standalone post detail view, fetches thread context, and handles missing-post states safely
- Vitest + Testing Library validate the authenticated `/me` profile editor flow, including initial profile loading, error rendering, and `PUT /api/me` saves
- Playwright covers the Sprint 1 golden path: GitHub sign-in handoff to `/me`, initial handle claim, and navigation to the resulting public profile at `/u/{handle}`
- ESLint enforces the TypeScript/React code style
- Vite production build verifies the SPA compiles cleanly

### `api`

- Vitest covers the health envelope generation and HTTP handler behavior
- Vitest covers post-content validation utilities, including configurable max-length enforcement plus hashtag and mention parsing
- Vitest covers authenticated profile reads and updates at `GET /api/me` and `PUT /api/me`, including JIT provisioning, validation, and normalization
- Vitest covers authenticated reply creation at `POST /api/posts/{id}/replies`, including parent lookup, nested thread inheritance, validation, and repository failure handling
- Vitest covers authenticated post creation at `POST /api/posts`, including max-length validation, hashtag and mention parsing, denormalised author fields, and repository failure handling
- Vitest covers the user-profile change-feed worker that refreshes denormalised post author fields after profile updates, including avatar removal and duplicate change-feed image collapse
- Vitest covers the public profile lookup at `GET /api/users/{handle}`, including case-insensitive mirror resolution and safe not-found behavior
- Vitest covers Static Web Apps principal decoding and HTTP auth role attachment for anonymous, user, moderator, admin, and malformed-principal request paths
- Vitest covers `PUT /api/me`, including duplicate-handle rejection via `usersByHandle`
- Vitest covers the `usersByHandle` change-feed mirror logic, including stale-handle cleanup and non-fatal collision handling
- Vitest covers the `counterFn` reply-counter change-feed logic, including inserts, soft deletes, duplicate deliveries, and missing-parent safety
- TypeScript compilation validates the Azure Functions source and module graph
- ESLint checks the Node/TypeScript implementation

## Infrastructure validation

Compile the Bicep entrypoint locally to catch template issues:

```bash
az bicep build --only-show-errors --file infra/main.bicep --outfile infra/main.json
```

Delete `infra/main.json` after validation or leave it ignored via `.gitignore`.
