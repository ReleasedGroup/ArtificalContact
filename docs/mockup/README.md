# UI Mockup
## ArtificialContact — AI Practitioner Social Network

A static, no-build HTML/JS mockup of the product UI. It illustrates the visual language, layout, and key screens described in [`requirements.md`](../requirements.md) and [`technical.md`](../technical.md).

## How to view
Open [`index.html`](index.html) directly in a browser — there is no build step, no package install, and no backend. Tailwind CSS is loaded via CDN and the Inter font from `rsms.me`.

## What's in it
A single SPA-style mockup with client-side view switching, demonstrating:

| Screen | Purpose |
|---|---|
| **Home feed** | Composer, "For you / Following / Latest / Media" tabs, denormalised feed cards (matches the `feeds` Cosmos container shape in `technical.md` §6.3) |
| **Explore** | Search box wired to the AI Search–backed `/api/search` endpoint (mockup-only), people row, hashtag grid with facet counts, top posts |
| **Thread** | Single thread view with root post, media grid, reactions row, reply composer, and nested replies |
| **Notifications** | Reply / like / follow / mention notifications with unread state (matches the change-feed-driven `notificationFn` in `technical.md` §5.2) |
| **Profile** | Banner, avatar, bio, expertise pills, follower counts, content tabs |
| **Moderation** | Stats cards + report queue table (matches the moderator role surface in `technical.md` §5.2) |

Plus a **Compose modal**, **right rail** with "Who to follow" and a System Status panel (Functions, Cosmos DB, AI Search, Blob/CDN, change feed lag), and a sticky search top bar.

## Design language
- **Dark, high-contrast** UI on `bg-gray-950`, optimised for long reading sessions
- **Inter Variable** typography with cv02/cv11 features
- **Brand:** indigo-blue (`brand.500 = #3a63ff`) with fuchsia accents
- **Tailwind v3 via CDN** — the production app will move to Tailwind CSS v4.1 with the Inter setup described in `design-guidance.md`
- Subtle gradient borders, soft inner ring shadows, and mesh-style backdrops for hero areas
- All icons are inline SVG (no icon font dependency)

## Sample data
All data is generated client-side in the `<script>` block at the bottom of `index.html`. It is illustrative only — there is no backend, no fetch calls, and no persistence.

## Mapping to the specifications
Each visible component corresponds to an element in the technical spec:

| Mockup element | Spec reference |
|---|---|
| Composer + post card | `requirements.md` §9.4, `technical.md` §5.2 (`createPost`) |
| Feed list | `requirements.md` §9.7.1, `technical.md` §3.4 + §6.3 (`feeds` container) |
| Reactions row | `requirements.md` §9.8, `technical.md` §5.2 (`react`) |
| Thread view | `requirements.md` §9.6, `technical.md` §5.2 (`getThread`) |
| Search box / Explore | `requirements.md` §9.7.3, `technical.md` §8 (Azure AI Search) |
| Notifications | `requirements.md` §9.9, `technical.md` §5.2 (`notificationFn`) |
| Moderation queue | `requirements.md` §9.10, `technical.md` §5.2 (`modQueue`, `modAction`) |
| System status panel | `technical.md` §11 (Observability) |

## Limitations
- This is a **visual mockup**, not a functional prototype. No state is persisted, no API is called, and accessibility has not been audited.
- The production SPA will be built with **React + Vite + TypeScript** (see `technical.md` §4.1). HTML/CSS/markup here is intentionally framework-free so it can be lifted into either React components or a static design review.
- The production build will use **Tailwind CSS v4.1** with the `@theme` block from `design-guidance.md`, not the v3 CDN used here for portability.
