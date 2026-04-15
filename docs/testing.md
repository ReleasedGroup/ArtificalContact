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
- ESLint enforces the TypeScript/React code style
- Vite production build verifies the SPA compiles cleanly

### `api`

- Vitest covers the health envelope generation and HTTP handler behavior
- Vitest covers authenticated profile reads and updates at `GET /api/me` and `PUT /api/me`, including JIT provisioning, validation, and normalization
- Vitest covers the public profile lookup at `GET /api/users/{handle}`, including case-insensitive mirror resolution and safe not-found behavior
- Vitest covers Static Web Apps principal decoding and HTTP auth role attachment for anonymous, user, moderator, admin, and malformed-principal request paths
- Vitest covers `PUT /api/me`, including duplicate-handle rejection via `usersByHandle`
- Vitest covers the `usersByHandle` change-feed mirror logic, including stale-handle cleanup and non-fatal collision handling
- TypeScript compilation validates the Azure Functions source and module graph
- ESLint checks the Node/TypeScript implementation

## Infrastructure validation

Compile the Bicep entrypoint locally to catch template issues:

```bash
az bicep build --only-show-errors --file infra/main.bicep --outfile infra/main.json
```

Delete `infra/main.json` after validation or leave it ignored via `.gitignore`.
