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

## Current Preview Surfaces

- The authenticated home feed header includes a debounced quick-search box backed by `GET /api/search`, surfacing grouped people and post matches without leaving the route.
- The authenticated `/me` route includes the Sprint 3 composer preview panel for reusable post and reply variants, including local image drag/drop, keyboard-accessible browse controls, attachment alt-text prompts, thumbnail previews, and remove actions, plus a thread workspace that publishes real root posts to `POST /api/posts`.
- The anonymous `/p/{id}` route resolves a standalone post detail page by combining `GET /api/posts/{id}` with `GET /api/threads/{threadId}` for a root-plus-replies thread view. Reply indentation caps after depth 3, deeper replies show a `Replying to …` context line instead of nesting further, and mixed-media posts render inline image, GIF, video, and audio attachments.
- When `/p/{id}` resolves for an authenticated active user, the page exposes both a text reply composer backed by `POST /api/posts/{id}/replies` and a Tenor-backed GIF picker that publishes GIF-only replies through the same endpoint, alongside owner-only delete actions backed by `DELETE /api/posts/{id}`.
- Hashtag and mention highlighting for the composer lives in `src/lib/composer.ts` so the feed, post detail, and thread pages can reuse the same parsing rules.
