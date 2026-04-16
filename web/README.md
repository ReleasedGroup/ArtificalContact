# Web

The `web` workspace contains the Static Web Apps frontend for ArtificialContact.

## Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4.1
- Application Insights Web SDK
- Vitest + Testing Library

## Commands

```bash
npm run dev --workspace @artificialcontact/web
npm run build --workspace @artificialcontact/web
npm run lint --workspace @artificialcontact/web
npm run test --workspace @artificialcontact/web
npm run test:a11y --workspace @artificialcontact/web
npm run test:e2e --workspace @artificialcontact/web
```

## Environment

- `VITE_APPINSIGHTS_CONNECTION_STRING`: optional Application Insights connection string for client telemetry
- `VITE_APPINSIGHTS_ROLE_NAME`: optional telemetry role override
- `VITE_WEB_PUSH_PUBLIC_KEY`: public VAPID key used to create browser push subscriptions and store them through `PUT /api/me/notifications`

## Current Preview Surfaces

- The authenticated home feed header includes a debounced quick-search box backed by `GET /api/search`, surfacing grouped people and post matches without leaving the route.
- The authenticated home feed keeps its compact inline composer, but now opens modal flows for direct-to-blob image uploads and GIF attachments before publishing root posts through `POST /api/posts`.
- The authenticated `/me` route keeps profile media uploads behind modal dialogs so avatar and banner updates can still use the direct-to-blob pipeline without overwhelming the editor surface.
- The anonymous `/p/{id}` route resolves a standalone post detail page by combining `GET /api/posts/{id}` with `GET /api/threads/{threadId}` for a root-plus-replies thread view. Reply indentation caps after depth 3, deeper replies show a `Replying to …` context line instead of nesting further, and mixed-media posts render inline image, GIF, video, and audio attachments.
- When `/p/{id}` resolves for an authenticated active user, the page exposes a text reply composer backed by `POST /api/posts/{id}/replies`, a modal-based Tenor GIF picker for GIF-only replies through the same endpoint, and owner-only delete actions backed by `DELETE /api/posts/{id}`.
- Hashtag and mention highlighting for the composer lives in `src/lib/composer.ts` so the feed, post detail, and thread pages can reuse the same parsing rules.
- The reusable composer keeps image attachment management in a modal so drag/drop previews and alt-text editing stay available without permanently expanding the thread UI.
- The authenticated `/notifications` route now includes a best-effort browser push card that suppresses unsupported browsers, registers `public/web-push-sw.js`, and stores the resulting VAPID subscription through `GET/PUT /api/me/notifications`.
