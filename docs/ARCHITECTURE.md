# Architecture

## Principles

1. **The app core is runtime-agnostic.** `createApp(services)` in `apps/api/src/app.ts` imports no Node or Cloudflare APIs. Two thin entry points assemble the real dependencies: `node.ts` (SQLite + local filesystem) and `worker.ts` (D1). Tests build the same app with an in-memory database.
2. **Everything external sits behind an interface** (`Database`, `ObjectStorage`, `AiProvider`, `JobQueue`) so a future phase adds an adapter instead of rewriting callers.
3. **Secure and boring by default**: loopback bind, CORS allow-list, no secret defaults, validated config, generic 500s, redacted logs.
4. **No fake functionality.** Where something does not exist, the code or UI says so (a 501 error, a disabled composer, an empty state).

## Components

| Component | Where | Notes |
| --- | --- | --- |
| Frontend | `apps/web` | React 18, Vite, React Router. Tokens and layout in `src/styles.css` |
| Backend API | `apps/api/src/app.ts`, `routes/v1/` | Hono. All routes under `/api/v1` |
| Database layer | `apps/api/src/db/` | `Database` interface; `sqlite.ts` (node:sqlite), `d1.ts` (Cloudflare D1) |
| Migrations | `apps/api/migrations/` | Plain SQL, shared by both adapters |
| Authentication | `apps/api/src/auth/`, `middleware/require-auth.ts` | See below |
| Configuration | `apps/api/src/env.ts`, `load-env.ts` | Zod-validated env, typed `AppConfig` |
| Logging / errors | `logger.ts`, `errors.ts`, `middleware/` | JSON-lines logs; `AppError` + one error handler |
| Storage | `apps/api/src/storage/` | `ObjectStorage`; local FS implementation |
| Background jobs | `apps/api/src/jobs/` | `JobQueue`; in-process runner with retry |
| Shared types/validation | `packages/shared` | Zod schemas used by API handlers and the web client |
| Assistant identity and instructions | `apps/api/src/assistant/` | Six-layer instruction system; see [IDENTITY.md](IDENTITY.md) |
| Behavior evaluation | `apps/api/evals/` | Scenarios, conformance checks, runner; `npm run eval -- --yes` runs them against the live provider |
| AI provider | `apps/api/src/ai/` | `AiProvider` interface, the registry, `GeminiProvider`, normalized `AiProviderError`, usage ledger. See [AI_PROVIDER.md](AI_PROVIDER.md) |
| Conversation engine | `apps/api/src/assistant/respond.ts`, `context.ts` | Validates, fits context, assembles the Phase 2 instruction, enforces limits, calls the provider, returns reply + trace |

## Request flow

```
request -> requestContext (id, scoped logger, access log)
        -> secureHeaders -> CORS (/api) -> body limit 1 MB (/api)
        -> /api/v1/<route> -> parseJson (Zod) -> handler -> Database / services
        -> errors of any kind -> errorHandler -> { "error": { code, message, requestId, details? } }
```

Handlers throw `AppError` for expected failures (400/401/403/404/501). Anything else is logged in full and returned as a generic `internal_error` 500, so internal messages never reach clients. Validation failures return `validation_error` with per-field `details`.

## Database

SQLite dialect everywhere. IDs are application-generated UUID text; timestamps are ISO-8601 UTC text; JSON is stored as text. Foreign keys are enforced (`PRAGMA foreign_keys=ON` locally; always on in D1) with `ON DELETE CASCADE` for user-owned data and `SET NULL` where history should survive (audit logs, message references).

`Database.batch()` is atomic on both adapters (transaction locally, `D1.batch` on Cloudflare). Application code never touches `node:sqlite` or a D1 binding directly.

Why both adapters: Node + SQLite gives fast tests and a zero-account local setup; D1 is the zero-cost production target. They share migrations and SQL, so behaviour stays aligned (verified: the same migration applied to local D1 and the same auth flow passed under workerd).

Tables not yet used by code (`conversations`, `messages`, `attachments`, `memories`, `projects`, `tasks`, `permissions`, `actions`) are schema only. They exist so later phases are additive migrations (`0002_...`) rather than reshaping.

## Authentication

- **Single owner.** `POST /auth/register` works once. The check and insert are one atomic statement (`INSERT ... WHERE NOT EXISTS`), so concurrent attempts cannot create two owners (tested).
- **Passwords**: PBKDF2-SHA256 via WebCrypto (identical on Node and Workers), random 16-byte salt, 100,000 iterations (the Workers ceiling), constant-time comparison. Unknown emails are checked against a decoy hash so response time does not reveal which emails exist.
- **Sessions**: a random 256-bit token is returned once; only `HMAC-SHA256(SESSION_SECRET, token)` is stored, so a database leak does not yield usable tokens. Clients send `Authorization: Bearer <token>`.
- **Audit**: register, login, login failure and logout write `audit_logs` rows. Credentials are never recorded.
- **Trade-offs** are listed under Known problems in the README (bearer vs cookie, no rate limit, iteration cap).

## Assistant instruction system

Layers 1 to 3 (identity, constitution, personality profile) are versioned source code with a lock file and an append-only database ledger; layer 3's proactivity setting and layer 4 (preferences) are database rows behind authenticated, audited, guard-screened routes; layers 5 and 6 are per request. `assembleInstructions()` builds one system instruction; `buildAiRequest()` makes it the only system message of a provider request. Like the rest of the API, none of this imports a Node or Cloudflare API. It runs unchanged on both (verified). Details, change procedure and limits: [IDENTITY.md](IDENTITY.md).

## AI conversation engine

`POST /api/v1/assistant/respond` is provider-independent: it works only through `services.ai` (the existing registry) and `AiProvider`. Flow: strict validation, `fitContext`, `loadAssembly` (Phase 2), `buildAiRequest` (the assembled text is the only system message), an atomic usage reservation, the provider call, finalization (tokens, cool-down, retry only for transient failures). The reply carries a `trace` tying it to the exact instruction used. Provider failures are normalized into `AiProviderError` kinds and mapped to API errors. Configuration lives in one place (`ai/config.ts` and `env.ts`); live requests are impossible unless three owner-set switches are on. Details, limits and the free-tier cautions: [AI_PROVIDER.md](AI_PROVIDER.md).

## Frontend

The app is gated by sign-in (existing auth API; the token is kept in `localStorage`). The Conversation screen talks to the engine through a small hook (`useConversation`) that keeps the thread in memory, marks a message `failed` rather than losing it, and sends the whole visible thread on each request. Mobile-first. One `<nav>` is a floating glass tab bar on phones and a left rail from 900px up. It respects iOS safe-area insets and `viewport-fit=cover`. A skip link, visible focus rings, `aria-current` on the active route, live regions for loading and error states, and `prefers-reduced-motion` support cover the accessibility basics. State screens use one shared `StatePanel`. The API client validates every response with the shared Zod schemas before use.

## Extension points for later phases

| Phase work | Where it plugs in |
| --- | --- |
| Another provider | Implement `AiProvider`, map failures to `AiProviderError`, register it in `ai/setup.ts` |
| Stored conversation (Phase 4) | Feed stored history to `fitContext`; store `responseTraceSchema` in `messages.metadata` |
| Memory (Phase 5) | Supply it to `respond()` as `sessionContext` (guarded layer 5) |
| Conversations, memory, tasks | New `routes/v1/*.ts` modules + migrations; tables already exist |
| R2 attachments | Implement `ObjectStorage` over an R2 binding |
| Proactive work | Implement `JobQueue` over Cron Triggers / Queues |
| Permissions and actions | Tables exist; add a policy check in middleware before action execution |

## Approved future design requirements (recorded in F0, not implemented)

These requirements were approved during the PAPPU architecture review. They describe work for later stages (F5 data rights, F8 memory). **None of them is implemented yet.** They are recorded here so that the later stages are built to them.

1. **Attachment-deletion decisions live in the independent deletion journal.** When an attachment is deleted and owner-confirmed or owner-stated memories depend on it, your per-memory decision (keep as your own attested statement, or delete the memory) must be stored *explicitly inside the deletion journal entry*: memory ids and decisions, no content. A reference to an audit record in the primary database is not enough, because restoring the primary database rewinds that audit record and the replay could no longer reproduce the decision.
2. **The second D1 database is a separate database, not an independent backup.** The deletion journal is planned to live in its own D1 database so that restoring the primary database does not rewind it. That database is still in the same Cloudflare account, so it does not protect against losing or compromising the account. External copies of the journal, included in owner-held exports, remain necessary, and recovery takes the union of all copies.
3. **Journal HMAC keys are versioned.** Every journal entry records the version of the key that signed it (`key_version`). Old key versions are kept, for verification only, so historical entries can still be verified after a rotation. A documented procedure must cover key rotation (new version for new entries, old versions retained), loss of a key (entries signed with it become unverifiable and must be reported, never silently trusted or dropped), and recovery. Replay refuses entries whose signature cannot be verified with a known key version.
4. **Owner-stated memory requires server-side owner-session validation.** Inserting a memory with origin `owner_stated` (and every change to `owner_confirmed`) must be validated on the server against an authenticated, non-revoked session belonging to the same owner. A client-supplied flag must never be enough. Tests must reject an insert without a session, with another user's session, with a revoked session, and from the AI or tool layer.
