# Technical Specification
## AI Practitioner Social Network

## 1. Document Control
**Document Type:** Technical Specification
**Companion Document:** [requirements.md](requirements.md)
**Status:** Draft 1
**Target Architecture:** Azure-native, serverless

---

## 2. Purpose and Scope
This document translates the functional requirements in `requirements.md` into a concrete technical design for the AI Practitioner Social Network. It covers the runtime architecture, data model, API contract, security model, and operational practices for the first release.

It does **not** specify UI visual design or detailed copy — those live in `design-guidance.md` and the design assets folder.

---

## 3. Architecture Overview

### 3.1 Components
| Layer | Service | Purpose |
|---|---|---|
| Frontend | Azure Static Web Apps (Standard tier) | Global CDN delivery of the SPA, integrated auth, reverse proxy to API |
| API | Azure Functions (Flex Consumption, Node 20 / .NET 8) | HTTP REST endpoints and event-driven workers |
| Structured data | Azure Cosmos DB for NoSQL (Autoscale RU/s) | Users, posts, threads, reactions, follows, feeds, notifications, reports |
| Binary data | Azure Blob Storage (General-purpose v2, Hot tier) | Images, video, audio, GIFs |
| Media delivery | Azure Front Door (or Azure CDN) | Caching and HTTPS edge for blobs |
| Search | Azure AI Search (Basic tier initially, Standard at scale) | Full-text and faceted search over posts, users, hashtags |
| Identity | Microsoft Entra ID + GitHub via SWA built-in auth | Sign-in, role assignment |
| Email | Azure Communication Services Email | Verification, password reset, notification email |
| GitHub sync | GitHub REST API (shared App / PAT) | Polled by a timer-triggered Function to publish issue/PR/release activity for admin-curated repos (see §16) |
| Secrets/config | Azure Key Vault + App Configuration | Connection strings, signing keys, feature flags |
| Observability | Application Insights + Log Analytics | Logs, metrics, traces, alerts |
| IaC | Bicep (with `azd` for environment lifecycle) | Repeatable deployments |

### 3.2 Logical Diagram
```
┌────────────────┐       ┌────────────────────────────┐
│  Browser SPA   │──────▶│ Azure Static Web Apps      │
│ (React + Vite) │       │  - global CDN              │
└────────────────┘       │  - /api reverse proxy ──┐  │
                         └─────────────────────────┼──┘
                                                   ▼
                         ┌────────────────────────────┐
                         │ Azure Functions (Flex)     │
                         │  - HTTP API                │
                         │  - Cosmos change feed wkrs │
                         │  - Blob trigger workers    │
                         └─┬──────────┬───────────┬───┘
                           │          │           │
              ┌────────────▼──┐  ┌────▼─────┐  ┌──▼────────────┐
              │ Cosmos DB     │  │ Blob     │  │ Azure AI      │
              │ for NoSQL     │  │ Storage  │  │ Search        │
              │ (autoscale)   │  │  + CDN   │  │ (indexes)     │
              └────┬──────────┘  └──────────┘  └───────────────┘
                   │ change feed                       ▲
                   └───────────────────────────────────┘
                          (Functions push updates)
```

### 3.3 Request Flow (read post feed)
1. Browser issues `GET /api/feed?cursor=...` to the SWA edge.
2. SWA reverse-proxies to the linked Functions app, attaching the SWA auth principal header.
3. The HTTP function authenticates the principal, point-reads up to N entries from the `feeds` container partitioned on `feedOwnerId = userId`, and returns the page.
4. Each feed entry is denormalised: it already contains author handle, avatar URL, post excerpt, media thumbnails, and counts. No second-hop lookup is required for the common case.

### 3.4 Request Flow (publish post)
1. Browser issues `POST /api/posts` with text content and media references.
2. HTTP function validates the principal, validates content, and writes a `post` document to `posts` (pk `/threadId`).
3. The Cosmos change feed (latest version mode) fires `feedFanOutFn`, which:
   - reads the author's followers (paginated from the `follows` mirror container, pk `/followedId`)
   - upserts a denormalised feed entry into each follower's `feeds` partition, capped at `MAX_FANOUT_FOLLOWERS` (e.g. 5,000)
4. The same change feed fires `searchSyncFn`, which pushes/upserts the post into the `posts` index in Azure AI Search.
5. The same change feed fires `counterFn`, which updates the author's profile post count.
6. Followers exceeding the fan-out cap are served via a `pull-on-read` path that queries posts authored by their followees directly (a small fraction of users).

### 3.5 Media Upload Flow
1. Browser requests `POST /api/media/upload-url` with `{ contentType, sizeBytes, kind }`.
2. Function validates content type and size, picks the target container (`images`, `video`, `audio`, `gif`), generates a deterministic blob name (`{userId}/{yyyy}/{mm}/{ulid}.{ext}`), and returns a short-lived **user delegation SAS** (≤ 15 min, write-only) plus the eventual public URL.
3. Browser uploads the file directly to Blob Storage.
4. A Blob-trigger function (`mediaPostProcessFn`) fires on creation, optionally generating thumbnails (images/video first frame), running content moderation (Azure AI Content Safety), and writing a `media` document into Cosmos DB.
5. The user references the returned media id when publishing the post.

---

## 4. Frontend (Azure Static Web Apps)

> **Visual reference:** A static HTML/JS mockup of the proposed UI lives at [`mockup/index.html`](mockup/index.html). It is framework-free (Tailwind CDN, no build) and demonstrates the home feed, explore, thread, profile, notifications, moderation, and compose flows. The production React build mirrors its layout and visual language. See [`mockup/README.md`](mockup/README.md) for the spec→mockup mapping.

### 4.1 Stack
- **Framework:** React 18 + TypeScript + Vite
- **State/data:** TanStack Query for server state, Zustand for local UI state
- **Styling:** Tailwind CSS, design tokens from `design-elements/`
- **Routing:** React Router v6
- **Build target:** Static assets deployed via SWA GitHub Action

### 4.2 Authentication
- Use SWA built-in auth providers: **Microsoft Entra ID** and **GitHub**, configured in `staticwebapp.config.json`.
- The SWA platform injects `x-ms-client-principal` into requests forwarded to the linked API; the Functions app reads this header to identify the caller. No tokens are handled in browser code.
- Anonymous routes: `/`, `/explore`, `/p/:postId`, `/u/:handle`, `/search`. All other routes require an authenticated principal.

### 4.3 SWA Configuration Highlights
- `staticwebapp.config.json` defines:
  - route-level auth requirements
  - fallback to `/index.html` for SPA routing
  - response headers (CSP, HSTS, X-Frame-Options)
  - linked API region (Australia East primary)
- SWA Standard tier is required for: bring-your-own Functions linkage (if needed beyond the managed quota), private endpoints, and increased size limits.

### 4.4 API Contract
The SPA calls relative `/api/*` URLs. The reverse proxy eliminates CORS. All API responses are JSON with consistent envelope:
```json
{ "data": <payload>, "cursor": "<opaque>", "errors": [] }
```

---

## 5. API (Azure Functions)

### 5.1 Hosting
- **Plan:** Flex Consumption (recommended for new workloads per Microsoft)
- **Runtime:** Node.js 20 (TypeScript) — single language reduces team friction with frontend
- **Region:** Australia East primary, with paired region Australia Southeast for DR
- **Identity:** System-assigned managed identity used to authenticate to Cosmos DB (RBAC), Blob Storage, AI Search, Key Vault

### 5.2 Function Inventory

#### HTTP-triggered (REST API)
| Function | Method + Route | Notes |
|---|---|---|
| `authMe` | GET `/api/me` | Returns the resolved profile for the authenticated principal; lazily provisions a user document on first call |
| `updateProfile` | PUT `/api/me` | Updates display name, bio, avatar, banner, expertise tags |
| `getUser` | GET `/api/users/{handle}` | Public profile lookup |
| `followUser` | POST `/api/users/{handle}/follow` | Creates follow + mirror |
| `unfollowUser` | DELETE `/api/users/{handle}/follow` | |
| `listFollowers` | GET `/api/users/{handle}/followers` | Paginated |
| `listFollowing` | GET `/api/users/{handle}/following` | Paginated |
| `createPost` | POST `/api/posts` | Validates, writes to `posts` |
| `getPost` | GET `/api/posts/{id}` | |
| `getThread` | GET `/api/threads/{threadId}` | Cross-partition-free; `threadId` is the partition key |
| `replyToPost` | POST `/api/posts/{id}/replies` | |
| `deletePost` | DELETE `/api/posts/{id}` | Soft delete (sets `deletedAt`) |
| `react` | POST `/api/posts/{id}/reactions` | `{ type: "like" \| "dislike" \| "emoji" \| "gif", value? }` |
| `unreact` | DELETE `/api/posts/{id}/reactions` | |
| `getFeed` | GET `/api/feed` | Personal feed (pull from `feeds` container) |
| `getPublicFeed` | GET `/api/explore` | Latest public posts (AI Search query, recency-sorted) |
| `search` | GET `/api/search` | `?q=&type=posts\|users\|hashtags&filter=` — proxies to AI Search |
| `mediaUploadUrl` | POST `/api/media/upload-url` | Issues user-delegation SAS |
| `getMedia` | GET `/api/media/{id}` | Returns metadata and CDN URL |
| `notifications` | GET `/api/notifications` | Personal notification feed |
| `markNotificationsRead` | POST `/api/notifications/read` | |
| `notificationPrefs` | GET/PUT `/api/me/notifications` | |
| `report` | POST `/api/reports` | User-submitted reports |
| `modQueue` | GET `/api/mod/queue` | Moderator role only |
| `modAction` | POST `/api/mod/actions` | Moderator role only |
| `adminMetrics` | GET `/api/admin/metrics` | Administrator role only |
| `listSyncedRepos` | GET `/api/admin/github/repos` | Administrator only — lists curated GitHub repositories with sync health |
| `addSyncedRepo` | POST `/api/admin/github/repos` | Administrator only — `{ owner, name, eventTypes[] }` |
| `updateSyncedRepo` | PATCH `/api/admin/github/repos/{id}` | Administrator only — pause/resume, change event types |
| `removeSyncedRepo` | DELETE `/api/admin/github/repos/{id}` | Administrator only — stops polling; existing posts retained unless explicitly purged |
| `getSyncedRepoProfile` | GET `/api/users/github/{owner}/{name}` | Public — returns the synthetic repo profile and its synced posts |

#### Cosmos DB change-feed-triggered
| Function | Source container | Purpose |
|---|---|---|
| `feedFanOutFn` | `posts` | Materialise feed entries into followers' `feeds` partitions |
| `searchSyncFn` | `posts`, `users` | Upsert/delete documents in AI Search indexes |
| `counterFn` | `posts`, `reactions`, `follows` | Update aggregate counters on parent documents |
| `notificationFn` | `posts`, `reactions`, `follows` | Create `notification` documents and dispatch external channels |

#### Blob-triggered
| Function | Source container | Purpose |
|---|---|---|
| `mediaPostProcessFn` | `images`, `video`, `audio`, `gif` | Generate thumbnails, run content safety, write `media` document |

#### Timer-triggered
| Function | Schedule | Purpose |
|---|---|---|
| `pollGitHubRepoFn` | every 5 min (per active repo, fanned out via durable orchestration or queue) | Polls the GitHub REST API for new/changed issues, pull requests, and releases; writes new or updated `github` posts; updates the per-repo high-water-mark cursor (see §16) |

### 5.3 Cross-cutting Concerns
- **Validation:** Zod schemas at the function boundary, shared with the SPA where possible.
- **Authorisation:** A small middleware reads `x-ms-client-principal`, resolves the user document, attaches roles, and short-circuits with 401/403 as needed.
- **Idempotency:** All change feed handlers compute deterministic target ids (e.g. feed entry id = `${ownerId}:${postId}`) so retries upsert without duplication.
- **Rate limiting:** Per-user token bucket persisted as a small Cosmos document with TTL, enforced at the API boundary on write endpoints.
- **Error envelope:** Errors are returned as `{ data: null, errors: [{ code, message, field? }] }` with appropriate HTTP status.

---

## 6. Cosmos DB for NoSQL Data Model

### 6.1 Account and Database
- **Account:** single account, single write region initially (Australia East). Multi-region writes considered post-launch.
- **Consistency:** Session (default) for reads; Strong only for security-critical single-document reads (e.g. account lookup during sign-in).
- **Database:** `acn` (single database, multiple containers; per-container throughput).

### 6.2 Containers

| Container | Partition Key | Throughput | Notes |
|---|---|---|---|
| `users` | `/id` | Autoscale 400–4k RU/s | One document per user (account + profile combined) |
| `usersByHandle` | `/handle` | Autoscale 400–1k RU/s | Lookup mirror; populated by change feed on `users` |
| `posts` | `/threadId` | Autoscale 1k–10k RU/s | Root posts have `threadId == id`; replies share the root id |
| `follows` | `/followerId` | Autoscale 400–4k RU/s | Following list per user |
| `followers` | `/followedId` | Autoscale 400–4k RU/s | Mirror populated from `follows` change feed |
| `reactions` | `/postId` | Autoscale 400–4k RU/s | Document id = `${postId}:${userId}` |
| `feeds` | `/feedOwnerId` | Autoscale 1k–10k RU/s | Denormalised feed entries; TTL ~30 days |
| `notifications` | `/targetUserId` | Autoscale 400–4k RU/s | TTL ~90 days |
| `notificationPrefs` | `/userId` | 400 RU/s shared | Small document per user |
| `media` | `/ownerId` | 400 RU/s shared | Blob references and metadata |
| `reports` | `/status` | 400 RU/s shared | Status values: `open`, `triaged`, `resolved` |
| `modActions` | `/targetType` | 400 RU/s shared | Audit trail |
| `rateLimits` | `/userId` | 400 RU/s shared | TTL-driven token buckets |
| `githubRepos` | `/id` | 400 RU/s shared | One document per curated repo: owner, name, event-type flags, status, cursors, last-poll timestamps, recent error log |

### 6.3 Document Shapes (illustrative)

#### users
```jsonc
{
  "id": "u_01HXYZ...",            // ULID
  "type": "user",
  "handle": "ada",
  "handleLower": "ada",            // for case-insensitive uniqueness
  "email": "ada@example.com",
  "emailLower": "ada@example.com",
  "displayName": "Ada Lovelace",
  "bio": "Symbolic AI nerd.",
  "avatarUrl": "https://cdn.example.com/...",
  "bannerUrl": "https://cdn.example.com/...",
  "expertise": ["llm", "rag", "evals"],
  "links": { "website": "https://ada.dev" },
  "status": "active",              // active | pending | suspended | deactivated | deleted
  "roles": ["user"],                // + "moderator", "admin"
  "counters": { "posts": 0, "followers": 0, "following": 0 },
  "createdAt": "2026-04-15T09:00:00Z",
  "updatedAt": "2026-04-15T09:00:00Z",
  "_etag": "..."
}
```

#### posts
```jsonc
{
  "id": "p_01HXYZ...",
  "type": "post",                   // post | reply
  "kind": "user",                   // user | github
  "threadId": "p_01HXYZ...",        // == id for root, else root post id
  "parentId": null,                  // reply target
  "authorId": "u_01HXYZ...",
  "authorHandle": "ada",             // denormalised
  "authorDisplayName": "Ada Lovelace",
  "authorAvatarUrl": "https://cdn...",
  "text": "Trying out a new eval harness...",
  "hashtags": ["evals", "llm"],
  "mentions": ["u_..."],
  "media": [
    { "id": "m_...", "kind": "image", "url": "https://cdn.../...", "thumbUrl": "...", "width": 1280, "height": 720 }
  ],
  "counters": { "likes": 0, "dislikes": 0, "emoji": 0, "replies": 0 },
  "visibility": "public",
  "moderationState": "ok",          // ok | flagged | hidden | removed
  "createdAt": "...",
  "updatedAt": "...",
  "deletedAt": null
}
```

A GitHub-sourced post uses the same container but sets `kind: "github"` and adds a `github` subdocument. Its `id` is deterministic so re-polling is idempotent:

```jsonc
{
  "id": "gh_${repoId}_issue_${issueId}",   // or _pr_ / _release_
  "type": "post",
  "kind": "github",
  "threadId": "gh_${repoId}_issue_${issueId}",
  "parentId": null,
  "authorId": "sys_github_${repoId}",       // synthetic user
  "authorHandle": "github/openai-cookbook", // reserved namespace
  "authorDisplayName": "openai/openai-cookbook",
  "authorAvatarUrl": "https://avatars.githubusercontent.com/u/14957082?v=4",
  "text": "Add streaming example for tool use",
  "github": {
    "repoId": "r_01HXYZ...",
    "owner": "openai",
    "name": "openai-cookbook",
    "eventType": "issue",                   // issue | pull_request | release
    "eventId": "2293847562",                // GitHub's numeric id
    "number": 1284,                          // for issues/PRs
    "tag": null,                             // for releases (e.g. "v1.4.0")
    "state": "open",                         // open | closed | merged | published | pre-release
    "actorLogin": "ada-lovelace",            // GitHub user who triggered the event
    "actorAvatarUrl": "https://avatars.githubusercontent.com/...",
    "url": "https://github.com/openai/openai-cookbook/issues/1284",
    "bodyExcerpt": "When passing a tool definition that requires...",
    "labels": ["enhancement", "good first issue"],
    "githubCreatedAt": "2026-04-15T08:42:00Z",
    "githubUpdatedAt": "2026-04-15T09:01:00Z"
  },
  "counters": { "likes": 0, "dislikes": 0, "emoji": 0, "replies": 0 },
  "visibility": "public",
  "moderationState": "ok",
  "createdAt": "2026-04-15T09:02:14Z",
  "updatedAt": "2026-04-15T09:02:14Z"
}
```

#### feeds
```jsonc
{
  "id": "f_${feedOwnerId}_${postId}",
  "feedOwnerId": "u_...",
  "postId": "p_...",
  "authorId": "u_...",
  "authorHandle": "ada",
  "authorAvatarUrl": "...",
  "excerpt": "Trying out a new eval harness...",
  "media": [ { "kind": "image", "thumbUrl": "..." } ],
  "counters": { "likes": 0, "replies": 0 },
  "createdAt": "...",
  "ttl": 2592000   // 30 days
}
```

### 6.4 RU Sizing — First Estimates
Assumes 5,000 MAU, 50k posts/month, 500k reactions/month, average follower count 80, p95 follower count 1,500.

| Operation | Avg RU | Peak QPS | Notes |
|---|---|---|---|
| `getFeed` page (20 items) | ~6 RU | 50 | point reads on `feeds` |
| `createPost` write | ~12 RU | 5 | + change feed cost |
| Fan-out write per follower | ~7 RU | 400 | change feed cost dominates |
| `getPost` | ~3 RU | 100 | |
| `react` | ~8 RU | 30 | |
| `getThread` (50 items) | ~15 RU | 20 | |

Initial autoscale ceilings sized at ~2x measured peak. Re-evaluated weekly during the first month.

---

## 7. Azure Blob Storage

### 7.1 Account
- **Type:** General-purpose v2, Standard performance, LRS for first release (GZRS evaluated for production)
- **Access tier:** Hot
- **Public access:** Disabled at the account level; reads brokered by Front Door / CDN with origin authentication

### 7.2 Containers
| Container | Purpose | Lifecycle |
|---|---|---|
| `images` | User post images (and processed thumbnails as `thumbs/...`) | Hot indefinitely |
| `video` | User-uploaded video | Hot 90 days → Cool |
| `audio` | User-uploaded audio | Hot 90 days → Cool |
| `gif` | User-supplied GIFs and provider responses | Hot indefinitely |
| `avatars` | Profile avatars and banners | Hot indefinitely |

### 7.3 Upload Pattern
- Direct-to-blob upload from the browser using **user delegation SAS** issued by the Functions API and signed using the storage account's managed identity (no shared keys distributed).
- SAS scope: single blob, write-only (`c` permission), expiry ≤ 15 minutes, content-type pinned, max size enforced by `x-ms-blob-content-length` validation in the post-process function.

### 7.4 Delivery
- Azure Front Door (Standard) sits in front of the storage account. Cache rules: 7 days for immutable blobs (named with ULIDs), 5 minutes for mutable assets (avatars/banners). HTTPS only. Custom domain `cdn.<app>.com`.

### 7.5 Limits Enforced at API
| Kind | Max size | Max duration |
|---|---|---|
| Image | 8 MB | n/a |
| GIF | 8 MB | n/a |
| Audio | 25 MB | 5 min |
| Video | 100 MB | 2 min |

---

## 8. Azure AI Search

### 8.1 Service
- **Tier:** Basic at launch (1 replica, 1 partition). Scale to Standard S1 when index size or query volume requires.
- **Region:** Australia East (paired with the Cosmos DB account region to minimise latency and egress).
- **Authentication:** Managed identity from Functions; RBAC role `Search Index Data Contributor` for write paths and `Search Index Data Reader` for read paths.

### 8.2 Indexes

#### `posts-v1`
Fields:
- `id` (key, string, retrievable)
- `authorId` (filterable)
- `authorHandle` (filterable, searchable, `keyword` analyzer)
- `text` (searchable, English analyzer)
- `hashtags` (searchable, filterable, facetable)
- `mediaKinds` (filterable, facetable, e.g. `["image", "video"]`)
- `createdAt` (filterable, sortable)
- `visibility` (filterable)
- `moderationState` (filterable)
- `likeCount`, `replyCount` (filterable, sortable)
- `kind` (filterable, facetable — `user` | `github`)
- `githubEventType` (filterable, facetable — `issue` | `pull_request` | `release`, only set when `kind = github`)
- `githubRepo` (filterable, searchable — `owner/name`, only set when `kind = github`)

Scoring profile: `recencyAndEngagement` boosting recent `createdAt` and engagement counters.

Optional vector field `textVector` (1536 dims) added in a future `posts-v2` index for hybrid search; populated via a skillset that calls Azure OpenAI text embeddings.

#### `users-v1`
Fields:
- `id` (key)
- `handle`, `handleLower` (searchable, filterable)
- `displayName` (searchable)
- `bio` (searchable)
- `expertise` (searchable, filterable, facetable)
- `followerCount` (sortable)
- `status` (filterable)

#### `hashtags-v1`
Fields:
- `id` (= hashtag, key)
- `count` (sortable, filterable)
- `lastUsedAt` (sortable, filterable)

### 8.3 Indexing Strategy
- **Initial bulk ingest:** Azure AI Search built-in **Cosmos DB indexer** (pull) with a high-water-mark on `_ts`, scheduled every 5 minutes. Used to seed indexes and as a safety net.
- **Near real time:** `searchSyncFn` (Cosmos change feed) pushes upserts/deletes within seconds for posts and user updates.
- **Soft deletes:** Documents with `deletedAt != null` or `moderationState in ("hidden","removed")` are removed from the index by the change feed processor.
- **Reindex strategy:** Schema changes deploy a new indexed version (e.g. `posts-v2`); the Functions write to both during cutover, queries are flipped via App Configuration feature flag, then the old index is deleted.

### 8.4 Query Patterns
- **Free-text search:** `search?api-version=2024-07-01&search=<q>&queryType=simple&filter=visibility eq 'public' and moderationState eq 'ok'&orderby=...`
- **Hashtag browse:** filter on `hashtags/any(h: h eq 'evals')` with facet on `hashtags`
- **User search:** prefix on `handle` and `displayName` with `searchMode=any`
- **Public explore feed:** `posts-v1` ordered by `createdAt desc` with the recency scoring profile

---

## 9. Identity, Authentication, Authorisation

- **Sign-in:** SWA built-in auth providers (Microsoft Entra ID, GitHub). Email/password is **not** implemented in the first release — handled by the IdP. The product surfaces "Sign in with Microsoft" and "Sign in with GitHub".
- **Principal flow:** SWA injects `x-ms-client-principal` (base64 JSON) into the linked API request. The API decodes it, looks up the corresponding `users` document by `idp:userId`, and creates one on first sight (just-in-time provisioning).
- **Roles:** Stored on the `users` document as `roles: ["user", "moderator", "admin"]`. The middleware enforces required roles per endpoint.
- **Service-to-service:** All Functions → Cosmos DB / Blob / AI Search calls use **managed identity** with RBAC. No connection strings or keys in app settings.

---

## 10. Security

| Concern | Control |
|---|---|
| Transport | HTTPS only, HSTS, TLS 1.2+ enforced at SWA and Front Door |
| Secrets | Key Vault references in Functions app settings; rotation via Bicep |
| Cosmos DB | Disable key-based auth where possible; prefer Entra ID RBAC |
| Blob | No public containers; SAS only via managed-identity-signed user delegation keys |
| AI Search | RBAC only; no admin keys distributed |
| Input validation | Zod schemas at boundary; max body size 1 MB for non-upload endpoints |
| AuthZ | Middleware enforces role per route; ownership checks on edit/delete |
| Rate limiting | Token bucket per user per endpoint class; 429 with `Retry-After` |
| Content moderation | Azure AI Content Safety on text and images at write time |
| CSP | Strict CSP set in `staticwebapp.config.json` |
| Audit | All moderation actions logged to `modActions` and Application Insights |
| Backups | Cosmos DB continuous backup (7-day PITR); Blob soft delete 30 days |

---

## 11. Observability

- **Application Insights** wired to every Function via the Functions runtime.
- **Custom metrics:**
  - `feed.fanout.followers` (per post)
  - `feed.fanout.duration_ms`
  - `search.sync.lag_seconds`
  - `cosmos.ru.consumed` (per operation class)
  - `media.upload.bytes`
- **Alerts:**
  - 5xx rate > 1% over 5 min
  - Cosmos 429 rate > 0.5% over 5 min
  - Change feed lag > 60 s
  - AI Search query latency p95 > 500 ms
- **Dashboards:** One Azure Workbook per concern (API health, Cosmos health, Search health, Media pipeline).

---

## 12. Environments and Deployment

| Environment | Purpose | Notes |
|---|---|---|
| `dev` | Per-developer ephemeral via `azd up` | Cosmos DB Serverless, Blob LRS, Search Free |
| `test` | Shared CI integration | SWA preview environment per PR |
| `staging` | Pre-prod, prod-shaped | Same SKUs as prod, smaller scale |
| `prod` | Production | Full SKUs, alerts, on-call |

- **IaC:** Bicep modules per service, composed by `main.bicep`; orchestrated by `azd`.
- **CI/CD:** GitHub Actions. SWA deploys via the standard `Azure/static-web-apps-deploy@v1` action; Functions deploy via `azure/functions-action@v1`. Bicep deploys via `azure/arm-deploy@v2`.
- **PR previews:** SWA provisions a preview URL for every PR, linked to a dev Functions slot.

---

## 13. Capacity and Cost (first-release rough order)

| Service | Configuration | Indicative monthly (AUD) |
|---|---|---|
| Static Web Apps | Standard | ~$15 |
| Functions Flex Consumption | ~30M execs/mo | ~$50 |
| Cosmos DB for NoSQL | Autoscale 4k RU/s avg | ~$300 |
| Blob Storage | 500 GB hot + egress | ~$60 |
| Front Door Standard | 1 TB egress | ~$60 |
| AI Search | Basic | ~$110 |
| Application Insights | 5 GB ingest | ~$25 |
| Communication Services Email | 50k emails | ~$10 |
| **Total** | | **~$630** |

These are starting figures; production tuning happens during the first month after launch.

---

## 14. GitHub Repository Sync

Implements the requirement defined in `requirements.md` §9.12.

### 14.1 Goals
- Surface issues, pull requests, and releases from an admin-curated set of public GitHub repositories as **first-class GitHub posts** in the platform feed.
- Be idempotent under retries and overlapping polls.
- Stay well within GitHub's public REST API rate limits.
- Keep the data model uniform — synced posts live in the same `posts` container as user posts and flow through the same change feed pipeline (search sync, counters, fan-out for user replies on them).

### 14.2 Components
| Component | Role |
|---|---|
| `githubRepos` Cosmos container | Source of truth for which repos are synced and their per-event-type cursors |
| `pollGitHubRepoFn` (Functions, timer trigger) | The poller. Runs on a schedule and fans out one execution per active repo |
| `posts` container (`kind: github`) | Where synced posts land. Re-uses the existing change feed (search sync, counters, replies) |
| Synthetic users (`sys_github_${repoId}`) | One per synced repo, in the `users` container with `roles: ["github"]`, displayed as `@github/owner-name`. Cannot sign in |
| Admin endpoints (`/api/admin/github/...`) | CRUD over `githubRepos` |
| Front Door + Functions outbound | Calls `https://api.github.com` with the shared GitHub App / PAT credential from Key Vault |

### 14.3 Polling Algorithm
For each active repo, on each tick (default every 5 minutes, randomised with ±60 s jitter to avoid alignment with the GitHub rate-limit reset):

1. Read the `githubRepos` document for the repo.
2. For each enabled event type (`issue`, `pull_request`, `release`):
   - Call the appropriate REST endpoint with `since` set to the cursor's `lastSeenUpdatedAt` and `sort=updated&direction=asc&per_page=100`.
   - Paginate while there are more pages and the rate-limit budget allows.
   - For each event:
     - Compute the deterministic post id `gh_${repoId}_${eventType}_${eventId}`.
     - Compute the new document (full payload mapped from the GitHub response).
     - **Upsert** into `posts` with an `If-Match` based on the prior `_etag` if known, otherwise a plain upsert. Releases are write-once; issues and PRs may update in place when state changes (`open` → `closed`, etc.).
     - On insert, run the body excerpt through Azure AI Content Safety; on rejection set `moderationState: "hidden"`.
3. Update the cursor's `lastSeenUpdatedAt` to the most recent processed `updated_at`.
4. If GitHub returns 403 or 429, record the `Retry-After` and back off; do not advance the cursor.
5. Write a brief health record (last poll timestamp, items processed, errors) onto the `githubRepos` document.

The change feed handles everything else automatically:
- `searchSyncFn` upserts the post into `posts-v1` with `kind=github`, `githubEventType`, and `githubRepo` populated.
- `counterFn` keeps reaction and reply counts in sync as users interact.
- `feedFanOutFn` is **not** invoked for synthetic GitHub users (they have no followers in the real sense). GitHub posts surface via the public explore feed and per-repo profile page rather than through follower fan-out.

### 14.4 Identity Reservation
- Handles starting with `github/` are reserved at the API layer. The `usersByHandle` mirror enforces uniqueness so a real user cannot claim them.
- The synthetic repo profile page is served by `getSyncedRepoProfile` and renders posts filtered by `authorId = sys_github_${repoId}`.

### 14.5 Rate Limit Budget
- Public REST API allowance with a GitHub App: 5,000 requests/hour per installation.
- Worst case at 5-minute polling, three event types per repo, two pages each: ~72 requests/hour/repo. This budgets ~60 active repos comfortably; alarms trigger at 50.
- A circuit breaker pauses polling on the offending repo for one hour after sustained 403/429.

### 14.6 Failure Modes
| Failure | Behaviour |
|---|---|
| GitHub returns 5xx | Retry with exponential backoff; do not advance cursor |
| Rate limited | Honour `Retry-After`; pause this repo only |
| Repo made private/deleted | 404 on next poll; mark repo `status: "unreachable"`; existing posts retained, no new posts |
| Content safety blocks a body | Post is created with `moderationState: "hidden"`; visible only to admins for review |
| Two pollers race the same repo | Deterministic ids + upsert make this safe; the loser's writes are no-ops |
| Cursor lost or corrupted | Backfill from `since = now - 24h` and let the deterministic ids dedupe |

### 14.7 Operational Metrics
- `github.poll.duration_ms` per repo
- `github.poll.events_processed` per repo
- `github.poll.rate_remaining` (gauge, from response headers)
- `github.poll.errors` per repo per error class
- Alert: any repo with no successful poll in > 30 minutes
- Alert: rate remaining < 500 across the installation

---

## 15. Open Technical Questions
1. **Vector search:** when do we add embeddings to `posts-v2`? Probably after launch + 4 weeks of data.
2. **Multi-region writes:** likely deferred until > 50k DAU.
3. **Notification channels:** confirm Web Push vs Notification Hubs by end of Sprint 3.
4. **GIF picker:** Tenor vs Giphy — depends on commercial terms.
5. **Account deletion under GDPR:** confirm tombstone vs full purge with legal.

---

## 16. References (Microsoft Docs)
- [Azure Static Web Apps overview](https://learn.microsoft.com/en-us/azure/static-web-apps/overview)
- [Azure Functions overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview)
- [Flex Consumption plan](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Azure Cosmos DB for NoSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/)
- [Cosmos DB partitioning](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Cosmos DB change feed design patterns](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-design-patterns)
- [Azure Blob Storage introduction](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction)
- [User delegation SAS](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-user-delegation-sas-create-dotnet)
- [Azure AI Search overview](https://learn.microsoft.com/en-us/azure/search/search-what-is-azure-search)
- [Index Cosmos DB data with Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-howto-index-cosmosdb)
- [Azure Functions timer trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bind-timer-trigger)
- [GitHub REST API — issues](https://docs.github.com/en/rest/issues/issues)
- [GitHub REST API — pulls](https://docs.github.com/en/rest/pulls/pulls)
- [GitHub REST API — releases](https://docs.github.com/en/rest/releases/releases)
- [GitHub REST API rate limiting](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)
