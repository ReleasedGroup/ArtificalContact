# Requirements Specification
## AI Practitioner Social Network

## 1. Document Control
**Document Type:** Product Requirements Specification  
**Product Working Title:** AI Practitioner Social Network  
**Prepared For:** Product and Engineering Stakeholders  
**Platform Constraint:** Azure Static Web Apps, Azure Functions, Azure Cosmos DB for NoSQL, Azure Blob Storage, Azure AI Search  
**Status:** Draft 2

---

## 2. Purpose
This document specifies the functional and non-functional requirements for a new social networking product designed for AI practitioners. The platform is intended to provide a lightweight, Twitter-like social experience tailored to people working with artificial intelligence, including developers, architects, researchers, consultants, founders, analysts, and other practitioners.

The system must allow users to register, maintain accounts, publish short-form posts, attach media, interact with other users and posts, participate in threaded discussions, and optionally receive notifications when new messages appear.

This specification also reflects the technical constraints nominated for the solution:
- **Frontend:** Azure Static Web Apps
- **Backend (API):** Azure Functions (Flex Consumption plan)
- **Primary structured storage:** Azure Cosmos DB for NoSQL — used for users, posts, feeds, reactions, follows, notifications metadata, reports, and moderation entities
- **Binary media storage:** Azure Blob Storage — used for images, video, audio, and GIF assets
- **Search:** Azure AI Search — used for full-text, hashtag, semantic, and user discovery search over content indexed from Cosmos DB

---

## 3. Product Vision
The product will be a fast, simple, social platform for AI practitioners to:
- share insights, experiments, tools, prompts, models, and observations
- follow other practitioners and discover relevant content
- discuss ideas through threads, replies, and answers
- react quickly using likes, dislikes, emoji reactions, and GIF responses
- publish media-rich short posts including images, audio, and video
- optionally receive notifications for new activity

The product should feel familiar to users of mainstream microblogging products, while being focused on the AI community and constrained to a pragmatic Azure-native architecture.

---

## 4. Objectives
The product shall:
- provide a simple and responsive social posting experience
- support user identity and account management
- support a social graph based on following relationships
- provide a personalised feed based on followed users
- support threaded discussion structures
- support rich media posts and responses
- support lightweight engagement patterns such as likes, dislikes, emoji reactions, and GIF replies
- support optional notifications for new content and interactions
- provide responsive, relevance-tuned search across users, posts, hashtags, and threads
- operate within an Azure-native architecture composed of Static Web Apps, Functions, Cosmos DB for NoSQL, Blob Storage, and AI Search

---

## 5. Scope
### 5.1 In Scope
The first release shall include:
- user registration and sign-in
- user profile creation and editing
- public posting of text messages
- media attachment support for image, video, and audio
- threaded replies and answer-style responses
- following and unfollowing users
- personalised feed based on followed accounts
- public browsing and discovery of content
- reactions including like, dislike, emoji, and GIF response
- optional notifications
- basic moderation and reporting capability
- administrative functions required for operational management

### 5.2 Out of Scope
Unless later approved, the following are out of scope for the initial release:
- direct messaging between users
- paid subscriptions
- advertising platform
- live streaming
- advanced recommendation engines based on machine learning
- private groups or communities
- long-form article publishing
- federated or decentralised network protocols
- end-to-end encrypted messaging
- marketplace features

---

## 6. User Types
### 6.1 Visitor
A visitor is an unauthenticated user who can browse public content, view public profiles, and explore discussions, subject to product rules.

### 6.2 Registered User
A registered user can maintain an account, follow other users, post content, react to content, reply in threads, manage notification preferences, and access a personalised feed.

### 6.3 Moderator
A moderator can review reported content, take moderation actions, and manage community safety controls.

### 6.4 Administrator
An administrator can manage platform settings, user status, moderation policies, operational controls, and diagnostic functions.

---

## 7. Assumptions and Constraints
### 7.1 Technical Constraints
The solution must be designed around the following architectural decisions:
- frontend is served as a static web application through Azure Static Web Apps, with integrated routing to a managed Azure Functions API
- backend logic is implemented using Azure Functions on the Flex Consumption plan, exposing HTTP-triggered REST endpoints and event-driven background workers
- structured application data is stored in Azure Cosmos DB for NoSQL, using JSON documents and partitioned containers
- binary media is stored in Azure Blob Storage; only blob references and metadata are stored in Cosmos DB
- search is provided by Azure AI Search, populated from Cosmos DB via the indexer pull model and/or Functions-based push enrichment
- Cosmos DB is a horizontally partitioned NoSQL store; data models must be designed around access patterns, partition key selection, and request unit (RU) consumption rather than relational joins
- cross-partition fan-out and feed materialisation use the Cosmos DB change feed processed by Azure Functions

### 7.2 Delivery Assumptions
- the frontend will be a browser-based web application
- users will access the system from desktop and mobile browsers
- the platform will initially support public posts only
- identity will use Azure Static Web Apps' built-in authentication providers (Microsoft Entra ID and GitHub) and/or a custom OpenID Connect provider where required
- media files will be uploaded directly to Azure Blob Storage using short-lived, server-issued user delegation SAS tokens, with metadata recorded in Cosmos DB

---

## 8. High-Level Architecture
### 8.1 Logical Components
The product shall consist of the following major components:

1. **Static Frontend Application**
   - delivered via Azure Static Web Apps
   - responsible for rendering UI, authentication flows, feed experience, profile pages, posting interfaces, notification settings, search, and moderation/reporting screens
   - calls the backend through the Static Web Apps managed `/api` reverse proxy, eliminating CORS configuration

2. **API Layer**
   - implemented as Azure Functions on the Flex Consumption plan
   - HTTP-triggered functions provide the REST API surface for registration, account management, post creation, feed retrieval, follow relationships, reactions, media upload orchestration, notifications, moderation, search, and administrative operations
   - Cosmos DB-trigger and Blob-trigger functions provide event-driven background processing for fan-out, counter aggregation, search index sync, notification dispatch, and media post-processing

3. **Primary Data Store — Azure Cosmos DB for NoSQL**
   - stores structured application entities as JSON documents
   - hosts containers for users, profiles, posts, threads, follows, reactions, feed entries, notifications, reports, and moderation actions
   - denormalised feed and counter documents support low-latency feed reads
   - the change feed (latest version mode) is consumed by Azure Functions for fan-out, search synchronisation, and notification triggering

4. **Media Storage — Azure Blob Storage**
   - stores uploaded images, video, audio, and GIF assets as block blobs in purpose-named containers (e.g. `images`, `video`, `audio`, `gif`)
   - direct upload from the browser uses short-lived user delegation SAS tokens issued by the Functions API
   - public read access is brokered via Azure CDN / Azure Front Door for cacheable delivery

5. **Search — Azure AI Search**
   - provides full-text, hashtag, faceted, and (optionally) hybrid/semantic search across posts, users, and threads
   - indexes are populated from Cosmos DB containers using the built-in Cosmos DB indexer (pull) for bulk/initial sync and via Functions on the change feed (push) for near real-time updates
   - separate indexes for `posts`, `users`, and `hashtags` to allow independent schema and tuning

6. **Notification Services**
   - in-app notifications stored in Cosmos DB
   - optional email delivery via Azure Communication Services Email
   - optional browser push via the Web Push protocol or Azure Notification Hubs
   - notification state and user preferences persisted in Cosmos DB

### 8.2 Architectural Principles
The design shall:
- minimise server-side rendering dependencies
- favour event-driven and asynchronous processing for costly operations using the Cosmos DB change feed
- denormalise read models where needed for acceptable feed performance
- separate binary storage from structured entity storage
- delegate search to a purpose-built search engine (Azure AI Search) rather than emulating it on Cosmos DB
- support horizontal growth through serverless functions, Cosmos DB partitioning, and AI Search replicas/partitions
- prefer managed identities and Microsoft Entra ID for service-to-service authentication wherever supported

---

## 9. Functional Requirements

## 9.1 Registration and Authentication
### 9.1.1 User Registration
The system shall allow a new user to register an account.

The registration process shall support:
- display name
- username or handle
- email address
- password, where local authentication is used
- acceptance of terms and privacy policy

The system shall validate:
- uniqueness of username
- uniqueness of email address
- format of email address
- password strength according to policy

### 9.1.2 Sign-In
The system shall allow registered users to sign in securely.

The system should support:
- email and password sign-in
- optional social sign-in providers
- session persistence across browser refreshes
- sign-out

### 9.1.3 Password and Account Recovery
The system shall support:
- password reset
- email verification where applicable
- account recovery workflows

### 9.1.4 Account Status
The system shall support account statuses including:
- active
- pending verification
- suspended
- deactivated
- deleted

Suspended or deleted users shall be prevented from normal access according to policy.

---

## 9.2 User Profile Management
### 9.2.1 Profile Data
The system shall allow users to manage profile information including:
- display name
- username
- biography
- profile image
- banner image
- areas of AI interest or expertise
- links to personal website or portfolio
- location or organisation, if chosen by the user

### 9.2.2 Privacy Controls
The system should allow users to control visibility of selected profile attributes.

### 9.2.3 Account Preferences
The system shall allow users to manage:
- notification preferences
- media autoplay preferences
- account visibility settings as supported
- preferred language and timezone if relevant

---

## 9.3 Social Graph and Following
### 9.3.1 Follow User
The system shall allow a registered user to follow another user.

Following a user shall:
- create a follow relationship
- influence the follower’s personalised feed
- optionally influence notifications and content discovery

### 9.3.2 Unfollow User
The system shall allow a registered user to unfollow another user.

### 9.3.3 Followers and Following Lists
The system shall display:
- follower count
- following count
- lists of followers and followed users, subject to privacy rules

---

## 9.4 Posting and Content Creation
### 9.4.1 Create Post
The system shall allow a registered user to publish a message.

A message shall support:
- text content
- optional images
- optional video
- optional audio
- optional hashtags or tags
- optional links

### 9.4.2 Post Length
The system shall define a maximum text length for a post. The exact limit shall be configurable.

### 9.4.3 Edit Post
The system should allow users to edit their own posts within a configurable policy. If edits are allowed, the system should preserve edit metadata.

### 9.4.4 Delete Post
The system shall allow users to delete their own posts.

Deletion shall:
- remove the post from normal public views
- preserve audit or moderation metadata where required by policy

### 9.4.5 Drafts
Draft support is optional and may be deferred from the first release.

---

## 9.5 Media Handling
### 9.5.1 Media Types
The system shall support upload and attachment of:
- image files
- video files
- audio files
- GIF assets or externally sourced GIF references

### 9.5.2 Media Validation
The system shall validate uploaded media for:
- supported file type
- size limit
- duration limit for audio and video where applicable
- malicious content scanning where available

### 9.5.3 Media Storage
The system shall store media binaries outside Azure Table Storage, with only references and metadata stored in table entities.

### 9.5.4 Media Playback and Display
The frontend shall support:
- image display
- inline audio playback
- inline or embedded video playback
- GIF display in responses and reactions where supported

---

## 9.6 Threading, Replies, and Answers
### 9.6.1 Thread Model
The system shall organise discussions into threads.

Each post may be:
- a root post
- a reply to another post
- an answer within a thread

### 9.6.2 Replies
Users shall be able to reply to a post.

Replies shall:
- be linked to a parent post
- appear in thread views
- optionally appear in feed views according to relevance rules

### 9.6.3 Answers
The system should support answer-style responses for discussion threads.

This may include:
- marking a reply as an answer by the original poster
- visually distinguishing answers from general replies

### 9.6.4 Nested Discussion Depth
The system shall support threaded replies to a practical depth. Deep nesting should be flattened or constrained for usability and performance.

---

## 9.7 Feed and Browsing
### 9.7.1 Personalised Feed
The system shall provide a feed for authenticated users.

The feed shall primarily include:
- posts created by users they follow
- replies from followed users, subject to feed rules
- optionally promoted or recommended content in future versions

### 9.7.2 Public Browse Experience
The system shall allow users to browse public content.

Browsing features shall include:
- latest public posts
- trending or popular discussions, if implemented
- profile pages
- thread views
- hashtag or topic browsing, if implemented

### 9.7.3 Search
The system shall provide a first-class search experience powered by Azure AI Search.

The first release shall support:
- user search by handle, display name, and bio (autocomplete and prefix matching)
- post search by full-text content, hashtags, and author handle
- hashtag and topic browsing with facet counts
- filtering by date range and media type
- relevance-tuned ranking with optional semantic ranker
- optional hybrid/vector search over post content as a future enhancement

Search results shall respect visibility rules, moderation status, and account suspension state.

---

## 9.8 Reactions and Engagement
### 9.8.1 Like
The system shall allow a user to like a post.

### 9.8.2 Dislike
The system shall allow a user to dislike a post.

### 9.8.3 Emoji Reactions
The system shall allow a user to add an emoji reaction to a post.

The system should support:
- one or more reaction types per user depending on policy
- reaction aggregation and display

### 9.8.4 GIF Responses
The system shall allow a user to respond to a post using a GIF.

A GIF response may be implemented as:
- a reply post containing a GIF attachment
- a lightweight reaction-style response, depending on final UX design

### 9.8.5 Reaction Constraints
The platform shall define business rules for mutually exclusive or compatible reactions, for example:
- whether a user can both like and dislike the same post
- whether emoji reactions may coexist with like or dislike

These rules shall be configurable and clearly specified during detailed design.

---

## 9.9 Notifications
### 9.9.1 Notification Preferences
Users shall be able to opt in or opt out of notifications.

### 9.9.2 Notification Triggers
The system should support notifications for events such as:
- new post by a followed user
- reply to user’s post
- answer to user’s thread
- reaction to user’s post
- new follower

### 9.9.3 Notification Channels
Notification channels may include:
- in-app notifications
- email notifications
- browser push notifications where supported

### 9.9.4 Delivery Control
Users shall be able to control which notification types they receive.

---

## 9.10 Reporting and Moderation
### 9.10.1 Report Content
The system shall allow users to report:
- posts
- replies
- media
- user accounts

### 9.10.2 Moderation Workflow
Moderators shall be able to:
- view reports
- review reported content
- hide or remove content
- suspend accounts
- record moderation outcomes

### 9.10.3 Abuse Controls
The platform should support:
- rate limiting
- anti-spam controls
- media scanning and filtering where practical
- profanity or harmful content checks where practical

---

## 9.11 Administration
Administrators shall be able to:
- view platform usage summaries
- manage users and account states
- review moderation actions
- manage system settings
- manage configurable limits such as post size, media size, and reaction rules

---

## 10. Data Requirements

## 10.1 Core Entity Types
Likely logical entities include:
- User
- UserProfile
- FollowRelationship
- Post
- ThreadIndex
- FeedEntry
- Reaction
- NotificationPreference
- NotificationEvent
- Report
- ModerationAction
- MediaReference

## 10.2 Cosmos DB for NoSQL Design Principles
Because Azure Cosmos DB for NoSQL is the primary data store, the system shall be designed around access patterns and partition strategy rather than strict normalisation.

The design should:
- model each major entity family in its own container with a partition key chosen for the dominant access pattern (e.g. `/userId` for per-user reads, `/threadId` for thread reads, `/feedOwnerId` for personal feeds)
- use denormalised documents for performance-critical reads (e.g. feed entries embed author handle, avatar URL, post excerpt, and counts)
- maintain aggregate counters via change feed processing rather than synchronous updates
- prefer point reads (`id` + partition key) over cross-partition queries
- use the Cosmos DB change feed to fan out writes to follower feeds, refresh search indexes, and dispatch notifications
- choose Session consistency by default, with Strong consistency reserved for security-sensitive single-document reads
- size container throughput using autoscale RU/s, with shared-throughput databases used only for low-traffic ancillary containers
- accept eventual consistency in fan-out feed materialisation and search indexing

## 10.3 Indicative Entity Model
All entities are JSON documents stored in Cosmos DB containers. Container, partition key, and `id` shape are illustrative and finalised in the technical specification.

### User Document (container: `users`, pk: `/id`)
May include:
- id (user id)
- email
- username (handle)
- account status
- created date
- security metadata

### Profile Document (container: `users`, embedded or sibling document, pk: `/id`)
May include:
- user id
- display name
- bio
- avatar URL
- banner URL
- expertise tags

### Post Document (container: `posts`, pk: `/threadId`)
May include:
- post id
- author user id
- post type
- parent post id
- root thread id
- text content
- media references
- created timestamp
- updated timestamp
- visibility state
- aggregate counters

### Follow Document (container: `follows`, pk: `/followerId`)
May include:
- follower user id
- followed user id
- created timestamp

A mirrored `followers` container partitioned on `/followedId` may be maintained via the change feed for efficient reverse lookups.

### Reaction Document (container: `reactions`, pk: `/postId`)
May include:
- post id
- reacting user id
- reaction type
- emoji value if applicable
- created timestamp

### Feed Entry Document (container: `feeds`, pk: `/feedOwnerId`)
May include:
- target user id
- feed item id
- source post id
- source author id
- created timestamp
- ranking or ordering metadata

### Notification Document (container: `notifications`, pk: `/targetUserId`)
May include:
- notification id
- target user id
- event type
- related entity id
- read status
- created timestamp

---

## 11. Functional Use Cases

## 11.1 Register New Account
**Primary Actor:** Visitor  
**Precondition:** Visitor is not signed in  
**Outcome:** A new account is created

**Flow:**
1. Visitor opens registration page.
2. Visitor enters registration details.
3. System validates required fields and uniqueness rules.
4. System creates account record.
5. System optionally sends verification message.
6. Visitor signs in or verifies account.

## 11.2 Publish a Post
**Primary Actor:** Registered User  
**Precondition:** User is authenticated  
**Outcome:** New post appears in relevant feeds and thread views

**Flow:**
1. User opens compose interface.
2. User enters text and optionally uploads media.
3. System validates content and media.
4. System stores media references and post entity.
5. System updates denormalised views, including follower feeds as designed.
6. System returns success and renders new post.

## 11.3 Follow Another User
**Primary Actor:** Registered User  
**Outcome:** Follow relationship is created and future posts influence feed generation

## 11.4 Reply in a Thread
**Primary Actor:** Registered User  
**Outcome:** Reply is attached to the target thread and visible in discussion views

## 11.5 React to a Post
**Primary Actor:** Registered User  
**Outcome:** Reaction is recorded and aggregate counts are updated

## 11.6 Receive Notification
**Primary Actor:** Registered User  
**Precondition:** User has opted into a supported notification type  
**Outcome:** User receives in-app or external notification based on preferences

---

## 12. Non-Functional Requirements

## 12.1 Performance
The system shall:
- load the main application quickly over typical broadband and mobile connections
- return common feed and profile requests within acceptable interactive response times
- process standard posting and reaction actions with low latency under normal operating load

Target values should be defined during solution design, for example:
- first meaningful interface render within a few seconds on standard connections
- common API responses within sub-second to low single-digit seconds under normal load

## 12.2 Scalability
The system shall support growth in:
- number of users
- number of posts
- number of followers per user
- media volume
- reaction volume

The architecture should scale horizontally through:
- Azure Static Web Apps for frontend delivery
- Azure Functions for elastic compute
- partition-aware data design in Azure Table Storage
- Azure Blob Storage for media scaling

## 12.3 Availability
The service should be designed for high availability within the capabilities of the chosen Azure services.

## 12.4 Security
The system shall:
- protect authentication credentials securely
- enforce authorisation checks on all protected operations
- validate and sanitise input data
- protect media upload endpoints
- implement rate limiting or abuse controls
- use HTTPS for all network traffic
- securely store secrets and configuration

## 12.5 Privacy
The system shall:
- process personal data in accordance with applicable privacy obligations
- allow users to manage their profile information
- support deletion or deactivation workflows according to policy

## 12.6 Maintainability
The solution shall be structured so that:
- frontend and backend can be deployed independently where practical
- storage entities are documented clearly
- APIs are versionable
- business rules are configurable where feasible

## 12.7 Observability
The system should support:
- application logging
- error logging
- usage analytics
- moderation and audit logging
- operational dashboards and alerting

---

## 13. UX and UI Requirements
The product shall provide:
- responsive layouts for desktop and mobile browsers
- a familiar social feed experience
- simple composition workflows for text and media posting
- clear thread navigation
- clear reaction controls
- accessible media playback controls
- clear account and notification settings

The UI should emphasise:
- readability of short-form content
- speed of interaction
- ease of discovery of profiles and threads
- low-friction engagement patterns

---

## 14. Accessibility Requirements
The system should conform as far as practical to recognised accessibility expectations for web applications, including:
- keyboard accessibility
- sufficient contrast
- semantic markup
- support for screen readers
- captions or transcripts for user-uploaded media where feasible or encouraged

---

## 15. Integration Requirements
The first release may require integration with:
- identity provider services
- email delivery service for verification and notifications
- Azure Blob Storage for media
- optional GIF provider service for GIF search and insertion
- optional push notification service

All integrations shall be abstracted to allow change without rewriting core business logic.

---

## 16. Risks and Technical Considerations
### 16.1 Cosmos DB Considerations
Azure Cosmos DB for NoSQL is well-suited to social workloads but introduces design considerations:
- partition key choice is the single biggest determinant of cost and scalability and is hard to change later
- cross-partition queries consume disproportionate RU/s and should be avoided in hot paths
- request unit (RU/s) consumption must be modelled per access pattern; autoscale RU/s should be used to absorb bursts
- denormalised feed materialisation creates write amplification proportional to follower count, which must be bounded for celebrity users
- change feed consumers must be idempotent and tolerate at-least-once delivery

### 16.2 Recommended Design Response
To address these considerations, the solution should:
- precompute follower feeds via change-feed-driven Functions, with a fan-out cap and a pull-on-read fallback for users with very large follower counts
- maintain aggregate counters (likes, replies, follower counts) asynchronously through change feed processing
- use Azure Functions on the change feed for fan-out, notifications, and AI Search index synchronisation
- store all media externally in Blob Storage and reference by URL/blob path in Cosmos DB
- delegate full-text and faceted search to Azure AI Search rather than implementing it in Cosmos DB queries
- ensure all change feed processors are idempotent (deterministic document ids, upsert semantics)

### 16.3 Media Complexity
Audio and video uploads introduce:
- larger payload handling
- transcoding or preview requirements if desired
- content moderation complexity
- increased storage and CDN costs

### 16.4 Notification Complexity
Notifications can become noisy or expensive. User preferences and throttling rules should be incorporated from the start.

---

## 17. Recommended API Capability Areas
The backend API surface should include capability areas such as:
- authentication
- user profile management
- follow management
- post creation and retrieval
- thread retrieval
- reaction management
- feed retrieval
- notification management
- media upload orchestration
- moderation and reporting
- administration

Detailed endpoint contracts are to be specified during technical design.

---

## 18. Reporting and Analytics Requirements
The system should provide operational insight into:
- user registrations
- active users
- posts created per period
- reaction activity
- follow graph growth
- media upload usage
- moderation volumes
- notification delivery volumes

---

## 19. Acceptance Criteria Summary
The first release shall be considered functionally acceptable when:
- a user can register and sign in
- a user can create and manage a public profile
- a user can follow and unfollow another user
- a user can publish a post with text and optional media
- a user can browse public posts and view a personalised feed
- a user can reply to posts in threads
- a user can react using like, dislike, emoji, and GIF-based response mechanisms
- a user can manage notification preferences and receive supported notifications
- moderators can review reports and take moderation actions
- a user can search for users, posts, and hashtags through the Azure AI Search–backed search experience
- the solution operates on Azure Static Web Apps, Azure Functions, Azure Cosmos DB for NoSQL, Azure Blob Storage, and Azure AI Search

---

## 20. Future Enhancements
Potential future enhancements include:
- AI-assisted content discovery and ranking
- topic communities and spaces
- private messaging
- richer search and semantic search
- verified practitioner profiles
- bookmarking and saved posts
- reposting or quoting features
- advanced analytics for creators
- model, tool, and project showcase pages
- community reputation or expert badges

---

## 21. Implementation Notes
The chosen Azure-native stack (Static Web Apps + Functions + Cosmos DB for NoSQL + Blob Storage + AI Search) is well suited to a microblogging workload of this shape. Each service is responsible for what it does best:

- **Static Web Apps** delivers the SPA globally over a CDN and proxies API traffic to Functions with no CORS plumbing.
- **Functions on Flex Consumption** provides elastic HTTP and event-driven compute, scales to zero, and integrates natively with Cosmos DB triggers and Blob triggers.
- **Cosmos DB for NoSQL** provides predictable single-digit-millisecond reads and writes for partition-keyed documents, with the change feed acting as the backbone for fan-out, counters, search sync, and notifications.
- **Blob Storage** keeps large binary payloads off the database hot path and is delivered through CDN/Front Door.
- **AI Search** removes the need to emulate full-text search on the primary store and provides a clear path to semantic and vector search.

The critical design discipline is:
- choose partition keys deliberately and document them
- treat the change feed as the integration backbone, not as an afterthought
- keep Functions stateless and idempotent
- never store binary blobs in Cosmos DB
- never use Cosmos DB queries for free-text search — use AI Search


