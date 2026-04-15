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
npm run test:e2e --workspace @artificialcontact/web
```

## Current Preview Surfaces

- The authenticated `/me` route includes the Sprint 2 composer preview panel for the reusable post and reply composer variants.
- The anonymous `/p/{id}` route resolves a standalone post detail page by combining `GET /api/posts/{id}` with `GET /api/threads/{threadId}` for thread context.
- Hashtag and mention highlighting for the composer lives in `src/lib/composer.ts` so the feed, post detail, and thread pages can reuse the same parsing rules.
