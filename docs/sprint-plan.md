# Sprint Plan
## AI Practitioner Social Network

**Companion documents:** [requirements.md](requirements.md), [technical.md](technical.md)
**Cadence:** 2-week sprints
**Team assumption:** 1 tech lead, 2 full-stack engineers, 1 designer (part-time), 1 PM (part-time)
**Goal:** Public beta at the end of Sprint 8

> Each sprint lists a goal, scope, and a definition of done. Exit criteria are concrete and demoable. Story points are not allocated — work is sized to fit the sprint by the team during planning.

---

## Sprint 0 — Foundations *(1 week)*
**Goal:** Project, environments, and CI/CD scaffolding ready so feature work in Sprint 1 hits the ground running.

**Scope**
- Repo layout: `/web` (Vite + React + TS), `/api` (Functions, TS, Node 20), `/infra` (Bicep + `azd`)
- Bicep modules: resource group, Static Web Apps (Standard), Functions (Flex Consumption), Cosmos DB account + `acn` database, Storage account, AI Search (Basic), Key Vault, App Insights, Front Door
- `azd up` works end-to-end against a `dev` environment
- GitHub Actions workflows: build, lint, test, deploy SWA, deploy Functions, deploy Bicep on `main`
- Branch protection on `main`, PR template, CODEOWNERS
- Application Insights wired into Functions and SWA

**Definition of done**
- A blank "Hello world" SPA is reachable at the SWA URL
- A blank `/api/health` Function returns 200 and shows up in App Insights
- `azd down` cleanly tears down the env

---

## Sprint 1 — Identity and User Profiles
**Goal:** Users can sign in, see themselves, and edit their profile.

**Scope**
- SWA built-in auth: Microsoft Entra ID + GitHub providers configured via `staticwebapp.config.json`
- `users` Cosmos container (autoscale 1k–4k RU/s) provisioned via Bicep
- `usersByHandle` mirror container + change-feed populator
- API: `GET /api/me` (JIT-provisioning), `PUT /api/me`, `GET /api/users/{handle}`
- Auth middleware (decodes `x-ms-client-principal`, attaches role context)
- SPA: sign-in page, /me profile screen, public profile screen, sign-out
- Handle uniqueness enforced via `usersByHandle` lookup before write
- App Insights custom event for sign-in

**Definition of done**
- A new user can sign in with Microsoft or GitHub, pick a handle, set a display name, bio, and avatar (placeholder upload — real upload arrives in Sprint 3)
- Their public profile is reachable at `/u/{handle}`

---

## Sprint 2 — Posts, Threads, Replies
**Goal:** Authenticated users can compose, view, reply to, and delete posts.

**Scope**
- `posts` container (pk `/threadId`, autoscale 1k–10k RU/s)
- API: `POST /api/posts`, `GET /api/posts/{id}`, `GET /api/threads/{threadId}`, `POST /api/posts/{id}/replies`, `DELETE /api/posts/{id}` (soft delete)
- Validation: max length, hashtag/mention parsing
- SPA: composer, post detail page, thread view (root + nested replies, flattened beyond depth 3)
- Author handle/avatar denormalised onto each post document
- `counterFn` change-feed worker maintains `replies` count on parent posts

**Definition of done**
- Two users can sign in, post, reply to each other, and view the resulting thread
- Deleting a post removes it from views but preserves the document for moderation

---

## Sprint 3 — Media Upload and Delivery
**Goal:** Users can attach images, GIFs, audio, and video to posts.

**Scope**
- Blob containers: `images`, `video`, `audio`, `gif`, `avatars`
- Front Door + custom CDN domain
- `POST /api/media/upload-url` issuing user-delegation SAS (managed identity signed)
- Direct-to-blob upload from SPA with progress UI
- `mediaPostProcessFn` Blob trigger: thumbnail generation (images, video first frame), Azure AI Content Safety scan, writes `media` doc
- Per-kind size and duration limits enforced at API
- Composer UI: drag/drop, preview, remove, multi-attachment for images
- Avatar/banner upload using the same pipeline

**Definition of done**
- A post with an image, a GIF, a 1-min video, and a 30-second audio clip renders correctly on desktop and mobile
- Disallowed content type returns 415 from the upload-url endpoint
- A blob flagged by content safety is hidden from the post

---

## Sprint 4 — Social Graph and Personalised Feed
**Goal:** Users can follow each other and see a feed of who they follow.

**Scope**
- `follows` and `followers` containers; mirror maintained by change feed
- API: `POST/DELETE /api/users/{handle}/follow`, `GET /api/users/{handle}/followers`, `GET /api/users/{handle}/following`
- `feeds` container (pk `/feedOwnerId`, TTL 30 days)
- `feedFanOutFn` change-feed worker: writes denormalised feed entries to followers' partitions, capped at `MAX_FANOUT_FOLLOWERS = 5000`
- Pull-on-read fallback for users above the cap
- API: `GET /api/feed?cursor=...`
- SPA: home feed screen with infinite scroll
- Counter updates on follow/unfollow

**Definition of done**
- Following a user causes their next post to appear in the follower's home feed within 5 seconds
- Unfollowing removes future posts from the feed
- A synthetic user with 10k followers fan-outs without exceeding RU budget; pull-on-read kicks in beyond the cap

---

## Sprint 5 — Reactions and Engagement
**Goal:** Users can like, dislike, emoji-react, and GIF-respond.

**Scope**
- `reactions` container (pk `/postId`, doc id `${postId}:${userId}`)
- API: `POST /api/posts/{id}/reactions`, `DELETE /api/posts/{id}/reactions`
- Business rules: like/dislike mutually exclusive; multiple emoji types allowed; GIF response is implemented as a reply with a single GIF media item
- `counterFn` updates aggregate `likes`, `dislikes`, `emoji` counts on the parent post (idempotent upserts)
- SPA: reaction bar, reaction summary popover, GIF picker (Tenor — see open question)

**Definition of done**
- All four reaction styles work and counters are eventually consistent within 2 seconds under load
- Reacting twice with the same type is a no-op

---

## Sprint 6 — Search (Azure AI Search)
**Goal:** First-class search across users, posts, and hashtags.

**Scope**
- AI Search service (Basic tier) provisioned via Bicep with managed identity RBAC
- Indexes: `posts-v1`, `users-v1`, `hashtags-v1` defined in code
- Built-in Cosmos DB indexer (pull, every 5 min) as the safety net
- `searchSyncFn` change-feed worker pushes near-real-time upserts/deletes
- API: `GET /api/search?q=&type=&filter=`
- Scoring profile `recencyAndEngagement` on `posts-v1`
- SPA: search box (header), search results page with type tabs (posts/users/hashtags), facets for hashtags and media kind
- `GET /api/explore` powered by the AI Search recency-sorted public query

**Definition of done**
- A new post is searchable within 5 seconds of being published
- Hidden/removed posts disappear from search results within 5 seconds
- User handle prefix search returns matches as you type

---

## Sprint 7 — Notifications
**Goal:** Users see and (optionally) receive notifications for relevant events.

**Scope**
- `notifications` container (pk `/targetUserId`, TTL 90 days)
- `notificationPrefs` container
- `notificationFn` change-feed worker: emits notifications for new follower, reply, reaction, and (opt-in) new post by followee
- API: `GET /api/notifications`, `POST /api/notifications/read`, `GET/PUT /api/me/notifications`
- In-app notification bell, unread badge, notification list
- Email channel via Azure Communication Services Email (verification, password reset already handled by IdP)
- Web Push channel for browsers that support it (best-effort)
- Per-event throttling (e.g. coalesce > N reactions per hour into a single notification)

**Definition of done**
- Reacting to or replying to a post produces an in-app notification within 5 seconds
- A user can opt out of any individual notification type and it is suppressed end-to-end
- Email opt-in produces a delivered email observable in ACS metrics

---

## Sprint 8 — Moderation, Admin, Hardening, Public Beta
**Goal:** The product is safe to put in front of real users.

**Scope**
- Reporting: `POST /api/reports`, in-product report flow on posts, replies, media, profiles
- `reports` and `modActions` containers
- Moderator queue UI + actions: hide post, remove post, suspend user, dismiss report
- Admin metrics screen (registrations, DAU, posts, reports, queue depth)
- Rate limiting middleware in front of all write endpoints (token bucket in `rateLimits` container with TTL)
- Accessibility pass: keyboard nav, alt text prompts, contrast audit, screen-reader smoke test
- Performance pass: bundle size budget, image lazy loading, Cosmos RU audit, AI Search latency audit
- Security pass: CSP review, Key Vault references audit, no shared keys in app settings, dependency scan
- Synthetic load test: 500 concurrent virtual users, 30 min, success criteria from §11 of `technical.md`
- Application Insights alerts wired to PagerDuty (or equivalent)
- Public beta launch checklist signed off

**Definition of done**
- All §19 acceptance criteria in `requirements.md` are met
- All alerts in §11 of `technical.md` are configured and tested with a synthetic trip
- A real user can complete the golden path (sign up → set profile → post with media → follow someone → react → reply → search → receive notification) without intervention
- The product is opened to invited beta users

---

## Cross-cutting Workstreams (run every sprint)

- **Design:** Designer feeds into the next sprint's UI work one sprint ahead. Tokens and components live in `design-elements/`.
- **DevEx:** Each sprint adds at least one piece of automation (preview env, test data seeder, RU usage report, etc.).
- **Docs:** API docs regenerated from Zod schemas every sprint. ADRs written for any non-obvious decision.
- **Cost watch:** Weekly cost report from Sprint 2 onwards; tighten autoscale ceilings as actual usage data arrives.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fan-out RU spikes for high-follower users | Med | High | Hard cap + pull-on-read fallback (Sprint 4) |
| AI Search lag during change feed backlog | Med | Med | Indexer pull as a 5-minute safety net (Sprint 6) |
| Content safety false positives blocking posts | Med | Med | Soft-flag flow + appeal queue (Sprint 8) |
| Cost overrun on Cosmos autoscale | Low | Med | Weekly cost reviews from Sprint 2; alerts on RU/s ceiling hits |
| Media abuse (storage egress) | Low | High | Front Door rate limiting; per-user upload quotas (Sprint 8) |
| GDPR/account-deletion gaps | Low | High | Legal sign-off before public beta (open question Q5) |
| GitHub API rate limits during sync (Sprint 9) | Med | Med | Per-repo backoff + circuit breaker; alarm at < 500 remaining; budget capped at ~60 active repos |
| Moderation surface for content authored on GitHub | Med | Med | Content safety on body excerpts at write; admin pause/remove per repo and per post |

---

---

## Sprint 9 — GitHub Repository Sync *(post-beta)*
**Goal:** Surface activity from an admin-curated set of GitHub repositories as first-class GitHub posts in the public timeline.

> Implements `requirements.md` §9.12 and `technical.md` §14. Scheduled post-beta so the launch date is unaffected; can be promoted ahead of Sprint 8 if stakeholders prefer it at GA.

**Scope**
- `githubRepos` Cosmos container with admin CRUD endpoints (`/api/admin/github/repos`)
- `posts` document shape extended with `kind: "github"` and a `github` subdocument (deterministic id `gh_${repoId}_${eventType}_${eventId}`)
- Synthetic per-repo users (`sys_github_${repoId}`) with reserved `@github/owner-name` handles, enforced uniqueness in `usersByHandle`
- `pollGitHubRepoFn` — timer-triggered Function fanning out one execution per active repo, polling issues, pull requests, and releases via the GitHub REST API (`since` cursor + pagination), with content safety on body excerpts
- Backoff and circuit breaker on 403/429; jittered schedule to avoid alignment with rate-limit reset
- AI Search `posts-v1` schema additions: `kind`, `githubEventType`, `githubRepo` filterable fields; reindex via the existing pull indexer + change-feed push
- SPA: first-class GitHub post card (event-type badge, state badge, repo, number/tag, title, excerpt, link out)
- Public per-repo profile page at `/u/github/{owner}/{name}`
- Admin screen: list repos, add by `owner/name`, choose event types, pause/resume, view sync health (last poll, lag, recent errors)
- Operational metrics + alerts: `github.poll.duration_ms`, `github.poll.events_processed`, `github.poll.rate_remaining`, no-successful-poll-in-30-min alert

**Definition of done**
- An admin can connect a public repo and within one polling interval the next opened issue, opened/merged PR, and published release appear in `/explore` and search results
- A state change on a tracked issue (open → closed) updates the existing post in place rather than creating a duplicate
- Removing a repo stops new posts within one polling interval; existing posts remain unless explicitly purged
- Synthetic `@github/*` handles cannot be claimed by real users
- Rate-limit budget supports ≥ 50 active repos with the configured 5-minute polling interval, verified via a synthetic load test
- Users can react and reply to GitHub posts the same as user posts

---

## Post-Beta (not in this plan)
Documented in `requirements.md` §20. Sprint 9 above is already committed; the following remain candidates for the cycle after that:
1. Hybrid/vector search via `posts-v2` index with Azure OpenAI embeddings
2. Multi-region Cosmos DB writes
3. Verified practitioner badges
4. Bookmarks and reposts
5. Topic communities/spaces
6. Per-user GitHub OAuth so users can sync their own repos (extends Sprint 9)
