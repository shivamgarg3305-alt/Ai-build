# Assistant: foundation (Phase 1), permanent identity (Phase 2) and Gemini conversation engine (Phase 3)

The technical foundation for a lifelong personal AI assistant: a React web app, a versioned HTTP API, a SQLite/D1 database layer with migrations, an authentication base, and the interfaces that later phases plug into.

**A working conversation engine now exists, but live Gemini is not verified and is OFF by default.** You can sign in and the Conversation screen is functional, but no message reaches Google until the owner deliberately enables it ([docs/AI_PROVIDER.md](docs/AI_PROVIDER.md): eligibility, data-use terms, three switches). No real credentials were available, so the Gemini connection was tested against mocks and a local stand-in server, **never against Google**. **This is still not the finished assistant.** Phase 2 adds the assistant's permanent identity, personality and constitution and the instruction pipeline that will feed a model ([docs/IDENTITY.md](docs/IDENTITY.md)). There is still no chat, no memory behaviour, no AI provider and no task logic, so **no model behavior has been tested**. The Conversation, Memory and Tasks screens are honest empty states. What exists and works is listed in [What is implemented](#what-is-implemented).

## Requirements

- Node.js **22.13 or newer** (the local database uses the built-in `node:sqlite` module)
- npm 10+
- Nothing else: no accounts, API keys, Docker or paid services are needed to run locally.

## Quick start

```bash
npm install
npm run setup        # creates .env with a freshly generated SESSION_SECRET
npm run db:migrate   # creates the local SQLite database and tables
npm run dev          # API on http://127.0.0.1:8787, web on http://localhost:5173
```

Open http://localhost:5173. On first run, choose "Create the owner account" (registration closes after that), then sign in. **Settings** shows live API, database and AI status. Live AI is off until you enable it (docs/AI_PROVIDER.md). Check the API directly:

```bash
curl -s http://127.0.0.1:8787/api/v1/health
```

If you skip `db:migrate`, the health check returns HTTP 503 with `"schema":"missing"` (by design).

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Create `.env` from `.env.example` with a random `SESSION_SECRET` (never overwrites an existing `.env`) |
| `npm run dev` | API (watch mode) and web dev server together |
| `npm run dev:api` / `npm run dev:web` | Either one alone |
| `npm run db:migrate` | Apply pending migrations to the local SQLite database |
| `npm run typecheck` | Strict TypeScript check of all workspaces |
| `npm test` | API test suite (Vitest) |
| `npm run build` | Typecheck, then bundle the API (`apps/api/dist/node.js`) and build the web app (`apps/web/dist`) |
| `npm run check` | typecheck + test + build |
| `npm run assistant:lock -w @assistant/api` | After a deliberate, version-bumped change to the identity, constitution or personality profile, record the new hashes (see docs/IDENTITY.md) |
| `npm run eval -w @assistant/api -- --yes` | Run the 10 behavior scenarios against the live provider (public test prompts, default instruction, no personal data; spends quota; needs `--yes`). Without an active provider it exits with code 2 |
| `npm run start -w @assistant/api` | Run the built API bundle (needs the same env vars) |

## Repository layout

```
apps/api/            Hono API (TypeScript). Runs on Node or Cloudflare Workers.
  migrations/        Numbered .sql files: the schema, used by both SQLite and D1
  src/               app.ts, env.ts, logger.ts, errors.ts, db/, auth/, middleware/,
                     routes/v1/, storage/, ai/, jobs/, node.ts, worker.ts
  src/assistant/     Identity, constitution, personality, guard, assembly, ledger, pipeline,
                     context (fitContext) and respond (the conversation engine)
  src/ai/            Provider interface, registry, Gemini provider, errors, usage ledger, config
  evals/             Behavior scenarios, conformance checks, runner (needs a provider)
  scripts/           lock-instructions.ts
  test/              Vitest tests
  wrangler.toml      Cloudflare Worker + D1 config (placeholders to fill in)
apps/web/            React + Vite + TypeScript, mobile-first PWA shell
packages/shared/     Zod schemas and types shared by API and web
docs/                ARCHITECTURE.md, IDENTITY.md, AI_PROVIDER.md, DEPLOYMENT.md
scripts/             setup-env.mjs
```

## Configuration

All configuration is environment variables, validated at startup (`apps/api/src/env.ts`); the API refuses to start with invalid config and never prints secret values. See `.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | none, **required** | 32+ characters. Keys the hash of session tokens; changing it signs everyone out |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8787` | Loopback by default; set `0.0.0.0` to reach it from a phone on your LAN |
| `DATABASE_PATH` | `./data/assistant.db` | Relative to `apps/api` |
| `STORAGE_DIR` | `./data/storage` | Local object storage root |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins allowed to call the API |
| `AI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_TERMS_REVIEWED` | off / none / `false` | The three switches that all must be set before anything is sent to Google. Plus `GEMINI_MODEL`, limits, timeouts and context sizes: see [docs/AI_PROVIDER.md](docs/AI_PROVIDER.md#configuration-reference) |
| `SESSION_TTL_HOURS` | `720` | Session lifetime |
| `VITE_API_BASE_URL` | empty | Web only, build time. Leave empty in dev (Vite proxies `/api`) |

Secrets live only in the API's environment. The web app receives no secrets. `.env`, `.dev.vars` and `data/` are git-ignored.

## Database and migrations

Schema lives in `apps/api/migrations/NNNN_name.sql`. The same files run on local SQLite and on Cloudflare D1.

- **Local:** `npm run db:migrate` applies pending files in order, each in a transaction, and records them in a `_migrations` table. Re-running is safe.
- **Cloudflare D1:** `npx wrangler d1 migrations apply DB --local` (or `--remote`) from `apps/api`. Wrangler tracks them in its own `d1_migrations` table.
- **Adding a migration:** create the next numbered file (`0002_add_thing.sql`). Never edit an applied migration. Do not apply the same database with both runners, since each keeps its own ledger.

Tables: `users`, `sessions`, `conversations`, `messages`, `attachments`, `memories`, `projects`, `tasks`, `permissions`, `actions`, `audit_logs` (migration 0001) `instruction_revisions`, `personality_settings`, `user_preferences` (migration 0002) and `ai_usage` (migration 0003: usage limits, cool-downs and response traceability; stores no message text). Used by code today: `users`, `sessions`, `audit_logs` and the four tables from Phases 2 and 3.

## What is implemented

- **API**: `GET /api/v1/health` (checks the database and schema), and `POST /api/v1/auth/register | login | logout`, `GET /api/v1/auth/me`. Request validation (Zod), central error handling with one JSON error shape, request IDs, structured logging with secret redaction, CORS allow-list, secure headers, 1 MB body limit.
- **Auth foundation**: single-owner registration (first account wins, later attempts get 403), PBKDF2-SHA256 password hashing, opaque bearer sessions stored only as keyed hashes, audit records for auth events.
- **Database layer**: one `Database` interface, adapters for `node:sqlite` and D1.
- **Storage abstraction**: `ObjectStorage` interface and a local filesystem implementation with path-traversal protection.
- **AI provider interface**: `AiProvider` interface and a registry. No provider is implemented.
- **Background jobs**: `JobQueue` interface and an in-process runner with validated payloads, retries and backoff (not durable; see limitations).
- **Assistant identity (Phase 2)**: six instruction layers (identity, constitution, personality, user preferences, session context, task instructions) assembled into one system instruction. The permanent layers are versioned, hash-locked code with an append-only ledger in the database; the proactivity setting and preferences are persisted per user; an override guard screens the lower layers; the pipeline hands a provider a request whose only system message is the assembled instruction. Full explanation in [docs/IDENTITY.md](docs/IDENTITY.md).
- **Gemini conversation engine (Phase 3)**: `POST /api/v1/assistant/respond` builds the Phase 2 instruction, fits the supplied conversation to the model's limits (reporting anything left out), enforces request and token limits with provider cool-downs, calls Gemini through the existing provider registry, and returns the reply with a trace (instruction fingerprints and versions, provider, model, request id, timestamp, token usage). Non-streaming; see the docs for why.
- **Web**: sign-in (using the existing auth API), a functional Conversation screen (send, thinking state, errors, retry, stop, scroll, data-handling notice) and an AI status card; responsive shell (bottom tab bar on phones, sidebar on desktop), dark glass design system, loading/error/empty states, live system-status card, PWA manifest.

## Assistant API (all routes require a bearer token)

| Route | Purpose |
| --- | --- |
| `GET /api/v1/assistant/identity` | Read-only view of identity, constitution, personality, layer order and the revision ledger |
| `GET`, `PUT /api/v1/assistant/personality` | Read or change the proactivity setting (audited) |
| `GET`, `POST /api/v1/assistant/preferences`, `DELETE /api/v1/assistant/preferences/:id` | Manage layer 4 (the guard rejects override attempts with HTTP 422) |
| `POST /api/v1/assistant/instructions/preview` | Show the exact assembled instruction for optional session and task input, plus anything rejected |
| `GET /api/v1/assistant/ai/status` | AI state, usage against limits, any provider pause. Calls no provider |
| `POST /api/v1/assistant/respond` | The conversation endpoint: `{ messages: [{role, content}] }` in, reply and trace out. Only user and assistant messages are accepted; unknown fields are rejected |

There is deliberately no route that modifies the identity, constitution or personality profile.

## Testing

`npm test` runs 318 tests: 267 for the API and 51 for the web app. Phase 1 (50): config, logging/redaction, migrations, database behaviour, health, error handling, CORS, body limits, the auth lifecycle, storage safety, jobs and the AI registry. Phase 3 added 117 API tests (config, the Gemini provider against mocks and a real local HTTP server, the usage ledger, context fitting, the conversation API, failure and cool-down handling, cancellation, fingerprint association, log privacy) and all 51 web tests (message submission, thinking state, rendering, errors, retry, cancel, sign-in, a mobile-CSS contract). Phase 2 (100): the exact identity wording, the 14 principles and 8 behavioral rules, layer order and precedence, injection-proof rendering, the override guard (24 attacks, 12 benign inputs, evasion attempts), the assistant API, restart persistence against a database file, ledger tamper detection, the provider pipeline, and the behavior-evaluation harness. Mutation checks confirmed that changing the identity, dropping "Sir" or disabling the guard makes tests fail. **These verify the instruction architecture, not what a model does with it.** The web app has no automated tests yet. `npm audit` reported 0 vulnerabilities on 2026-11-14.

## Free-tier limits (checked 2026-11-14)

Everything here runs at zero cost. If you deploy to Cloudflare, these are the free-plan limits that matter. Re-check them before relying on them; they change.

| Service | Free allowance | Source |
| --- | --- | --- |
| Workers | 100,000 requests/day; **10 ms CPU time per invocation**; 50 subrequests; exceeding CPU returns error 1102 | developers.cloudflare.com/workers/platform/limits |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage; queries fail when a daily limit is hit | developers.cloudflare.com/d1/platform/pricing |
| R2 (not used in Phase 1) | 10 GB-month storage, 1M Class A and 10M Class B operations/month | cloudflare.com/plans |
| Gemini API (not used until enabled) | **Not verified.** Google applies quotas per project (not per key), differs by model, and resets daily quotas at midnight Pacific time; the numbers are in Google AI Studio and change. On the unpaid tier Google may use content to improve its products and have it human-reviewed | ai.google.dev/gemini-api/docs/rate-limits and the Gemini API Additional Terms |
| Pages (static hosting) | Static requests unlimited, 500 builds/month (from a third-party summary; confirm on Cloudflare's Pages limits page) | |

Not verified here: whether enabling R2 requires a payment method on file, and Google Gemini's free-tier terms. Check both before Phase 2. Nothing in this repository calls a paid service.

## Known problems and limitations

1. ~~No login screen.~~ Fixed in Phase 3: the web app has sign-in and owner-account creation on top of the existing auth API.
2. **No brute-force protection on login.** The API is stateless, so there is no rate limiter. Add a Cloudflare rate-limiting rule or a database-backed throttle before exposing it.
3. **Password hashing strength and CPU limit.** PBKDF2 is capped at 100,000 iterations because that is the Workers maximum; this is below current OWASP guidance, partly offset by the 12-character minimum. On the Workers **Free** plan the 10 ms CPU cap may be exceeded by hashing (error 1102). Local runs do not enforce this, so it is **unverified**. Test `register` and `login` after deploying.
4. **Bearer tokens.** The session token is kept in `localStorage` so the installed app stays signed in. Any script running on that origin could read it, so the app must stay free of injected content. Cookies are an alternative to evaluate.
5. **Expired sessions** are removed only when presented; there is no cleanup job.
6. **Jobs are not durable.** The in-process runner loses pending jobs on restart, and on Workers it only lives as long as the request. No jobs are defined in Phase 1.
7. **Storage.** Only the local filesystem adapter exists. The Worker entry has no storage; an R2 adapter is future work.
8. **PWA is partial.** Manifest and iOS meta tags only: no service worker (no offline support) and no PNG `apple-touch-icon`.
9. **UI not verified in a browser.** It compiles, builds and is served, and its API calls work through the dev proxy, but it was not rendered or screenshotted. Check it on a real device.
10. **`node:sqlite` is experimental** in Node 22 and prints a warning; the adapter is isolated in one file.
11. **The health endpoint is public** and discloses version and environment.
12. **Deployment is documented, not executed.** Cloudflare deployment steps were not run against a real account (the Worker and D1 were verified locally with wrangler).

## Phase 3 limitations

1. **Live Gemini is unverified.** Everything was tested against mocks and a local stand-in written from Google's documentation. It cannot show that Google accepts the request, that your model id and region work, how real 429s look, or how the model behaves. See [First live test](docs/AI_PROVIDER.md#first-live-test).
2. **Privacy on the free tier.** Google's unpaid-tier terms (the newest I could read was archived 20 Nov 2025; read the current one) allow it to use content to improve products and human reviewers to read it, and advise against sensitive or confidential information. A personal assistant's natural content is exactly that. Decide before enabling; the app shows a notice while live AI is active.
3. **Account eligibility is the owner's to confirm**: an adult account holder, an eligible region. The app cannot check it and sends nothing until `GEMINI_TERMS_REVIEWED=true`.
4. **No streaming.** Replies arrive whole. Partial replies are never shown as complete.
5. **No stored conversation.** The thread lives in the browser and is lost on reload (Phase 4). A failed message is kept in the page, not on the server.
6. **The quota-versus-rate-limit split is a heuristic** (Google does not document a stable machine-readable one); local limits are the backstop.
7. **Every request carries about 1,600 tokens of identity instruction**, which counts against token limits.
8. **Local usage limits are estimates** until Google reports real tokens; set them at or below your AI Studio quota.
9. **Mobile layout is not visually verified**: only CSS/HTML contracts are tested in jsdom.
10. **The sign-in endpoint still has no brute-force protection** (Phase 1 limit #2); the AI endpoint has its own usage limits.

## Phase 2 limitations

1. **No model behavior is verified.** No AI provider is connected, so nothing tests whether a model follows the instructions. `npm run eval` exits with code 2 for that reason. A prompt cannot guarantee behavior.
2. **The override guard is a pattern list**, with known false positives and false negatives (both are demonstrated in its tests). The structural protections are the real defense.
3. **The ledger is tamper-evident, not tamper-proof**, and is checked at startup and first use.
4. **Conversation messages are not screened**; they stay in the user role and rely on the model honoring the precedence rule.
5. See docs/IDENTITY.md for the full list.

## Remaining work (not started, by design)

Phase 4 (lifelong conversation archive, storing the response trace in `messages.metadata`); live Gemini verification and a behavior eval run against a real model (owner); sign-in rate limiting; streaming; memory read/write; attachments on R2; durable jobs and proactive triggers; permission/action approval flow; PNG icons and service worker; web tests; CI.
