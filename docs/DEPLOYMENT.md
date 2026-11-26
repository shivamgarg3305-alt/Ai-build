# Deployment

> The local development path and the Worker + D1 path were verified (see README). The steps below that touch a real Cloudflare account were **not executed** and are written from Cloudflare's CLI behaviour; expect to adjust.

All of this works on Cloudflare's free plans (limits in the README). You need a free Cloudflare account and nothing else. Nothing below enables a paid feature.

## Option A: Cloudflare (Worker + D1 for the API, Pages for the web app)

### 1. API

From `apps/api`:

```bash
npx wrangler login
npx wrangler d1 create assistant                 # prints a database_id
```

Edit `wrangler.toml`:
- `database_id` = the id printed above
- `CORS_ORIGINS` = your web app's exact origin(s), e.g. `https://assistant-web.pages.dev`

Then:

```bash
npx wrangler d1 migrations apply DB --remote     # create the schema
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
npx wrangler deploy                              # prints https://assistant-api.<you>.workers.dev
curl -s https://assistant-api.<you>.workers.dev/api/v1/health
```

The health check should return `"status":"ok"` with `"driver":"d1"`, `"schema":"ready"` and `"instructions":{"status":"ok",...}`. Migrations `0001`, `0002` and `0003` must all be applied; until they are, health is `degraded`. On first use, a deployment records the version and hash of each permanent instruction layer in `instruction_revisions`. If a later deployment changes a layer's content without bumping its version, health turns `degraded` and the assistant routes refuse to serve (see docs/IDENTITY.md).

Create the owner account once (registration closes after the first user):

```bash
curl -s -X POST https://assistant-api.<you>.workers.dev/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","displayName":"You","password":"a long passphrase"}'
```

Test `login` immediately afterwards. On the Free plan, password hashing may exceed the 10 ms CPU limit (README, Known problems #3).

### Enabling live AI on the Worker (optional, owner only)

Live AI is **off** unless you turn it on. Read [docs/AI_PROVIDER.md](AI_PROVIDER.md#before-you-enable-it) first: eligibility, and the data-use terms of Google's unpaid tier. Then:

```bash
npx wrangler secret put GEMINI_API_KEY          # paste the key when prompted; never put it in wrangler.toml
# in wrangler.toml [vars]: AI_ENABLED = "true"  and  GEMINI_TERMS_REVIEWED = "true"
npx wrangler deploy
curl -s -H "authorization: Bearer $TOKEN" https://assistant-api.<you>.workers.dev/api/v1/assistant/ai/status
```

Expect `"state":"ready"`. Workers Free allows 10 ms of CPU per request; waiting for Gemini does not count as CPU time, but password hashing at sign-in may (README, Known problem #3). Set the local limits (`AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY`, `AI_TOKENS_PER_DAY`) at or below your AI Studio quota.

### 2. Web

Build with the API URL baked in, then publish `apps/web/dist`:

```bash
VITE_API_BASE_URL=https://assistant-api.<you>.workers.dev npm run build -w @assistant/web
npx wrangler pages project create assistant-web --production-branch main
npx wrangler pages deploy apps/web/dist --project-name assistant-web
```

Pages serves `index.html` for unknown paths when there is no `404.html`, which the client-side router relies on; confirm deep links like `/settings` load after deploying. The web origin must match `CORS_ORIGINS` exactly.

### Secrets and local Worker testing

- `SESSION_SECRET` is a Wrangler secret, never a `[vars]` entry and never committed.
- For `wrangler dev`, put it in `apps/api/.dev.vars` (git-ignored).
- Local D1: `npx wrangler d1 migrations apply DB --local`, then `npx wrangler dev --local`.

## Option B: self-host on any machine with Node 22.13+

```bash
npm ci
npm run build
export NODE_ENV=production SESSION_SECRET=<32+ random chars> CORS_ORIGINS=https://your-web-origin \
       DATABASE_PATH=/var/lib/assistant/assistant.db STORAGE_DIR=/var/lib/assistant/storage API_HOST=0.0.0.0
npm run db:migrate
npm run start -w @assistant/api
```

Serve `apps/web/dist` with any static host and put TLS in front of both (a reverse proxy such as Caddy or nginx). Back up `DATABASE_PATH` and `STORAGE_DIR`.

## Rolling out schema changes

Add the next numbered migration file, apply it to the target database (`db:migrate` locally, `wrangler d1 migrations apply DB --remote` on Cloudflare), then deploy the code that uses it. Never edit an applied migration.

## Production checklist

- [ ] `SESSION_SECRET` set as a secret, 32+ random characters
- [ ] `CORS_ORIGINS` lists only your real web origin(s)
- [ ] `NODE_ENV=production`
- [ ] Migrations applied before the new code is deployed
- [ ] Health check returns `ok`, including `checks.instructions` (migration `0003` applied)
- [ ] Live AI left OFF unless the owner has reviewed the terms; if on, `GEMINI_API_KEY` is a secret and the local limits are at or below the provider quota
- [ ] After any identity, constitution or personality change: version bumped and `npm run assistant:lock -w @assistant/api` committed
- [ ] Rate limiting in front of `/api/v1/auth/*` (Cloudflare rules or equivalent)
- [ ] Owner account created, then confirm a second `register` returns 403
