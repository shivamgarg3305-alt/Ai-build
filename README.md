# PAPPU

PAPPU is a long-term, professional personal AI assistant: one permanent identity, one lifelong conversation, and (eventually) memory, voice, an avatar and carefully permissioned actions, all running at ₹0 on free and open-source infrastructure where practical.

**Status: early foundation.** This repository contains the technical foundation: a web app, a versioned API, a database layer, single-owner authentication, the assistant's six-layer identity and instruction system, and an AI provider integration that is **switched off**. Most PAPPU capabilities are planned, not built. See [Implemented vs planned](#implemented-vs-planned) before relying on anything.

> Naming: the product is PAPPU. Internal package names (`@assistant/api`, `@assistant/web`, `@assistant/shared`) and some code identifiers still say "assistant"; renaming them is deliberately out of scope for the current stage. The assistant's identity text does not yet contain the name PAPPU; that is a planned, versioned identity change (see docs/IDENTITY.md for how such changes are made).

## Architecture at a glance

```
apps/web  (React + Vite PWA shell)  ──HTTP──►  apps/api  (Hono, TypeScript)
                                                 ├─ auth, sessions, audit
                                                 ├─ assistant/  six-layer identity + instruction pipeline
                                                 ├─ ai/         provider interface, Gemini provider (OFF), usage ledger
                                                 └─ db/         one Database interface
                                                      ├─ node:sqlite  (local development, tests)
                                                      └─ Cloudflare D1 (Workers deployment target, not yet deployed)
packages/shared  Zod schemas and types used by both apps
```

The app core (`createApp`) imports no Node- or Cloudflare-specific API; `apps/api/src/node.ts` and `apps/api/src/worker.ts` are thin entry points. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/IDENTITY.md](docs/IDENTITY.md), [docs/AI_PROVIDER.md](docs/AI_PROVIDER.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

- Node.js **22.13 or newer** (the local database uses the built-in `node:sqlite` module, which prints an "experimental" warning on Node 22)
- npm 10 or newer
- Git

No accounts, API keys, Docker or paid services are needed to run PAPPU locally.

## Setup from a fresh clone

```bash
git clone <repository-url> pappu && cd pappu
npm ci               # install exactly what package-lock.json specifies
npm run setup        # create .env from .env.example with a random SESSION_SECRET
npm run db:migrate   # create the local SQLite database (apps/api/data/assistant.db)
npm run dev          # API on http://127.0.0.1:8787, web on http://localhost:5173
```

Open http://localhost:5173, choose "Create the owner account" (registration closes after the first account), then sign in. Check the API directly with:

```bash
curl -s http://127.0.0.1:8787/api/v1/health
```

Without `db:migrate`, the health check returns HTTP 503 with `"schema":"missing"` (by design).

## Environment configuration

- `npm run setup` copies [`.env.example`](.env.example) to `.env` and generates `SESSION_SECRET`. It never overwrites an existing `.env` and never prints the secret.
- `.env` is git-ignored. Never commit it, and never put real values in `.env.example`.
- The API reads `.env` from its working directory or the repository root, and validates every value at startup (`apps/api/src/env.ts`). Invalid configuration stops the API; error messages name the variable but never echo its value.
- `VITE_API_BASE_URL` (web, build time only) is read by Vite from the shell or `apps/web/.env*`, not from the root `.env`. Leave it unset in development.
- Cloudflare secrets are set with `npx wrangler secret put <NAME>`, and local Worker secrets go in `apps/api/.dev.vars` (git-ignored). See docs/DEPLOYMENT.md.

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | none, **required** | 32+ characters; changing it signs everyone out |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8787` | Loopback by default |
| `DATABASE_PATH` | `./data/assistant.db` | Relative to `apps/api` |
| `STORAGE_DIR` | `./data/storage` | Local object storage root |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins |
| `SESSION_TTL_HOURS` | `720` | Session lifetime |
| `AI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_TERMS_REVIEWED` | off / none / `false` | **Live AI is off and activation is currently blocked** pending the compliance and privacy review. See docs/AI_PROVIDER.md |

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Install dependencies exactly as locked |
| `npm run setup` | Create `.env` from `.env.example` with a random `SESSION_SECRET` |
| `npm run db:migrate` | Apply pending migrations to the local SQLite database |
| `npm run dev` | API (watch mode) and web dev server together; `npm run dev:api` / `npm run dev:web` run one |
| `npm run typecheck` | Strict TypeScript check of every workspace |
| `npm test` | All tests: API (Vitest), web (Vitest + jsdom) and repository scripts (`node --test`) |
| `npm run test:scripts` | Only the repository-script tests (secret scanner, setup script) |
| `npm run secrets:scan` | Scan every file Git would commit for credentials; exits 1 on a finding, never prints the value |
| `npm run build` | Typecheck, bundle the API (`apps/api/dist/node.js`) and build the web app (`apps/web/dist`) |
| `npm run check` | Secret scan, typecheck, all tests, build: run this before opening a pull request |
| `npm run start -w @assistant/api` | Run the built API bundle (needs the same environment) |
| `npm run assistant:lock -w @assistant/api` | Record new hashes after a deliberate, version-bumped identity change (docs/IDENTITY.md) |
| `npm run eval -w @assistant/api -- --yes` | Behaviour scenarios against a live provider. With no active provider it exits with code 2 (expected today) |

No linter is configured yet; TypeScript strict mode is the static check.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request, on pushes to `main`, and on demand:

1. **Secret scan** (`node scripts/check-secrets.mjs`): no dependencies needed.
2. **Check**: `npm ci` from the lockfile, `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=high`.

## Database and migrations

Schema lives in `apps/api/migrations/NNNN_name.sql`; the same files run on local SQLite and on Cloudflare D1.

- **Local:** `npm run db:migrate` applies pending files in order, each in a transaction, recorded in a `_migrations` table. Re-running is safe.
- **D1:** `npx wrangler d1 migrations apply DB --local` (or `--remote`) from `apps/api`; Wrangler keeps its own `d1_migrations` table. Never apply the same database with both runners.
- Never edit an applied migration; add the next numbered file.

Tables in use today: `users`, `sessions`, `audit_logs`, `instruction_revisions`, `personality_settings`, `user_preferences`, `ai_usage`. Present in the schema but **not used by any code**: `conversations`, `messages`, `attachments`, `memories`, `projects`, `tasks`, `permissions`, `actions`. The planned replacement design is in docs/ARCHITECTURE.md.

## Implemented vs planned

### Implemented (tested with mocks and local runs)

- **API:** `GET /api/v1/health`; `POST /api/v1/auth/register | login | logout`; `GET /api/v1/auth/me`; assistant routes for identity (read-only), personality setting, preferences, instruction preview, AI status and `POST /assistant/respond`. Zod validation, one JSON error shape, request ids, structured logs with secret redaction, CORS allow-list, secure headers, 1 MB body limit.
- **Authentication:** single owner (the first account; later registrations get 403), PBKDF2-SHA256 password hashing, opaque bearer sessions stored only as keyed hashes, audit records for auth events.
- **Identity system:** six instruction layers (identity, constitution, personality, user preferences, session context, task instructions). Layers 1–3 are versioned, hash-locked code with a tamper-evident ledger; "Sir" is the fixed address term. See docs/IDENTITY.md.
- **AI provider layer:** provider interface and registry, a Gemini provider over REST, normalized errors, usage limits and cool-downs, response traces. **Off by default and never tested against Google.**
- **Web app:** sign-in and owner creation, a Conversation screen (send, thinking state, errors, retry, stop), Settings with live API and AI status, a responsive shell, a PWA manifest.
- **Repository hygiene:** `.gitignore`, `.env.example`, a working setup script, a secret scanner with tests, CI.

### Not implemented (planned; do not rely on these)

- **Saved conversations:** the conversation lives in the browser and is lost on reload. The lifelong archive is planned.
- Long-term memory and personal understanding; the Memory and Tasks screens are empty states.
- Live AI use (blocked until the provider's terms, age/access requirements and privacy implications are resolved), streaming replies.
- Voice, the 3D avatar, the approved logo (the current icon is a placeholder), wake phrase.
- Attachments and document ingestion, integrations (email, calendar), Digital Operator actions and approvals.
- Background jobs, reminders and notifications; data export, deletion and backup tooling.
- Login rate limiting, passkeys, device management, a hardened session cookie (see Known limitations).
- Any deployment: the Cloudflare configuration has placeholders and has never been deployed.

## Known limitations

1. **No brute-force protection on login** yet.
2. **Password hashing:** PBKDF2 at 100,000 iterations (the Workers WebCrypto ceiling, per the project's notes), below current OWASP guidance; whether it fits the Workers Free CPU limit is unmeasured.
3. **The session token is kept in `localStorage`** and there is no Content Security Policy yet.
4. **First-registration claims ownership:** a freshly deployed instance must be registered by the owner immediately.
5. **Expired sessions** are removed only when presented; jobs are not durable; only local file storage exists.
6. **PWA is partial** (no service worker, no PNG icons), and the UI has not been verified on real devices.
7. **`node:sqlite` is experimental** in Node 22.
8. **The health endpoint is public** and reports version and environment.
9. **The secret scanner** checks the current files Git would commit, not past Git history, and only catches the credential formats it knows.

## Free-tier notes

Nothing in this repository calls a paid service. Free plans and their limits change, so re-check them before relying on them. The Cloudflare Workers Free plan allows 10 ms of CPU time per request; Gemini's unpaid tier allows Google to use submitted content and have it reviewed by humans. Both are discussed in docs/DEPLOYMENT.md and docs/AI_PROVIDER.md.
