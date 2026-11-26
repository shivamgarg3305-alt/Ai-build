# AI provider integration (Phase 3)

Phase 3 connects the assistant to Google Gemini and adds the conversation engine that sits between the browser, the Phase 2 identity pipeline and the model. This document covers the design, how to enable it safely, what is protected, how to test it, and what is and is not verified.

## Live status: read this first

| Question | Answer |
| --- | --- |
| Is live Gemini verified? | **No.** No Gemini credentials were available, and enabling live AI is the owner's decision (see [Before you enable it](#before-you-enable-it)). Live activation is **off by default** and sends nothing until the owner turns it on. |
| What is verified? | The provider against mocked `fetch` (every failure mode you listed), against a **local stand-in server over real HTTP**, the whole API, the web app, and the Worker + D1 runtime against the same stand-in. |
| What do those NOT prove? | That Google accepts this exact request, that the configured model id exists for your key and region, how Google's real 429 responses look in practice, or how a real model behaves. A stand-in written from the documentation can share my misreadings of it. |
| First real test | Follow [First live test](#first-live-test). It is a few minutes of work and the only way to close this gap. |

## Architecture

```
Browser (React)          POST /api/v1/assistant/respond   { messages: [{role, content}, ...] }   (bearer token)
   |                                   |
   |                      strict validation: only user/assistant roles, last must be user, unknown keys rejected
   |                                   |
   |                      fitContext()  newest messages that fit; reports what was dropped
   |                                   |
   |                      loadAssembly()  Phase 2: identity + constitution + personality + preferences
   |                                   |   + server notes ("no long-term memory", "N messages left out")
   |                      buildAiRequest()  the assembled text is the ONLY system message
   |                                   |
   |                      reserveUsage()  one atomic statement checks every limit and books the attempt
   |                                   |
   |                      registry.get('gemini').generate()   <-- the existing AiProvider interface
   |                                   |
   |                      finalizeUsage()  tokens, status, cool-down; retries ONLY transient failures, once
   v                                   v
Reply + trace  <---  { message, complete, finishReason, trace{requestId, timestamp, provider, model,
                       instruction{fingerprints, versions}, usage}, context{received, sent, dropped} }
```

| Piece | File | Role |
| --- | --- | --- |
| Provider configuration | `apps/api/src/ai/config.ts`, `src/env.ts` | The one place defaults and env parsing live (model name, URL, limits). |
| Gemini provider | `src/ai/gemini.ts` | Implements `AiProvider` over the REST API with `fetch`. No SDK, so no new dependency, and it runs on Node and Workers. |
| Error normalization | `src/ai/errors.ts` | `AiProviderError` with a provider-neutral `kind`; text is sanitised at construction. |
| Registration | `src/ai/setup.ts` | Registers Gemini in the **existing** `AiProviderRegistry`, and only when activation is `active`. |
| Usage ledger | `src/ai/usage.ts`, migration `0003_ai_usage.sql` | Limits, cool-downs, token accounting, traceability. |
| Context boundary | `src/assistant/context.ts` | `fitContext()`: what the model sees, and an honest account of what it does not. |
| Engine | `src/assistant/respond.ts` | Ties the above together. Also `getAiStatus()`. |
| Routes | `src/routes/v1/assistant.ts` | `POST /respond`, `GET /ai/status` (both authenticated). |

### Provider independence

Conversation logic never mentions Gemini. It uses `services.ai` (the existing registry) and the `AiProvider` interface. To add or swap a provider: implement `AiProvider`, map its failures to `AiProviderError`, register it in `ai/setup.ts`, and add its config in `ai/config.ts`/`env.ts`. Cool-downs, limits, retries, traceability and the API errors all work unchanged.

**One interface change, and why.** `AiGenerateResult` gained an optional `finishReason: 'stop' | 'length' | 'other'`. Without it a reply cut off at the output limit is indistinguishable from a finished one, which the requirements forbid. It is optional, so every existing implementation and test stayed valid; the registry, `AiMessage`, `AiGenerateRequest` and `AiProvider` are unchanged. A provider that reports no reason is treated as finished.

### Error normalization

| `AiErrorKind` | From Gemini | Retried automatically? | API response |
| --- | --- | --- | --- |
| `invalid_credentials` | 401, 403, 400 `API_KEY_INVALID` | no (provider paused 5 min) | 503 `ai_misconfigured` |
| `bad_request` | 404 model not found, other 4xx | no (provider paused 5 min) | 503 `ai_misconfigured` |
| `rate_limited` | 429 | no (cool-down until the provider's `retryDelay`, at least 60 s if none) | 429 `ai_rate_limited` + `Retry-After` |
| `quota_exhausted` | 429 whose body names a daily quota | no (cool-down until the next quota-day reset) | 429 `ai_quota_exhausted` + `Retry-After` |
| `timeout` | our timeout, or 504 | no | 504 `ai_timeout` |
| `network` | fetch failed | **yes, once** | 502 `ai_unreachable` |
| `provider_unavailable` | 500, 503, 408 | **yes, once** | 503 `ai_provider_unavailable` |
| `content_blocked` | `promptFeedback.blockReason`, or a safety `finishReason` | no | 422 `ai_response_blocked` (no text returned) |
| `malformed_response` | not JSON, wrong shape, no candidates, empty answer | no | 502 `ai_bad_response` |
| `cancelled` | the client disconnected | no | 408 `request_cancelled` |

Google documents `429 RESOURCE_EXHAUSTED` for several different limits without a stable machine-readable split between "too fast" and "out for the day". The provider treats a limit that names a day as quota exhaustion and anything else as a short rate limit. That is a **heuristic**. If it guesses wrong, the local daily limit is the backstop and the cool-down still stops repeated calls.

## Before you enable it

Live activation needs **three separate switches**, all set by the owner: `AI_ENABLED=true`, `GEMINI_API_KEY`, and `GEMINI_TERMS_REVIEWED=true`. Until all three are set the server registers no provider and sends nothing; `GET /assistant/ai/status` and the Settings screen say which one is missing.

Why a deliberate gate: Google's terms for the Gemini API place conditions on **who may use it and what may be sent**. From Google's Gemini API Additional Terms (the newest version I could read was archived on 20 November 2025; **read the current version yourself**, it may have changed):

- **Eligibility.** API clients must not be directed at, or likely to be used by, anyone under 18. The account holder must be an adult who accepts the terms. This is the owner's to satisfy and confirm; I cannot and did not do it for you.
- **Unpaid (free) tier data use.** Content you send (prompts, system instructions, files) and responses may be used to provide and improve Google's products, and human reviewers may read and annotate it (disconnected from your account). Google's guidance for this tier is not to submit sensitive, confidential or personal information.
- **EEA, Switzerland, UK.** Making an API client available to users there is limited to Paid Services under those terms.
- **Paid terms.** Activating a Cloud Billing account treats all use of the API as a Paid Service for data-use purposes, which changes how Google may use your data, but it also opens the door to **charges**, which conflicts with the ₹0 target. The app never enables billing and never switches to a paid model.

**Consequence for this project.** This is a *personal* assistant, and on the unpaid tier its natural content (preferences, conversation) is exactly what Google's guidance says not to send. So: do not put confidential personal information into the conversation on the free tier; do not send private archives (Phase 4) or personal memory (Phase 5) to it without a privacy review and a decision about the paid terms. The conversation screen repeats this as a visible notice whenever live AI is active.

**If these requirements cannot be met**, leave `AI_ENABLED` unset. Everything else works, the composer explains why sending is off, and nothing is transmitted. That is the state this repository ships in.

## Secure credential setup

1. The **owner** creates the key in Google AI Studio under their own account (the key page is linked from ai.google.dev). Do not share the key with a developer or paste it into chats, tickets or code.
2. **Local:** put it in `.env` (git-ignored; `npm run setup` creates the file with mode 600):
   ```
   AI_ENABLED=true
   GEMINI_API_KEY=<your key>
   GEMINI_TERMS_REVIEWED=true
   ```
3. **Cloudflare:** `npx wrangler secret put GEMINI_API_KEY` (a secret, never a `[vars]` entry), and set `AI_ENABLED = "true"` and `GEMINI_TERMS_REVIEWED = "true"` in `[vars]`.
4. Restart the API. Check Settings → Assistant AI or `GET /api/v1/assistant/ai/status`; the state should read `ready`.
5. Rotate the key in AI Studio if it is ever exposed; replace it the same way.

How the key is protected: it lives only in the server environment and in `AiConfig.apiKey`; it is sent only in the `x-goog-api-key` header over HTTPS (never in a URL or query string); the logger redacts any field named like a key; `AiProviderError` strips anything shaped like a Google key from provider text; no response, status endpoint or web bundle contains it. All of this is tested, and verified against real processes (zero occurrences in API and Worker logs). Application-level protections reduce risk; they do not guarantee security.

## Configuration reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_ENABLED` | `false` | Master switch. |
| `GEMINI_API_KEY` | none | Server-side secret. |
| `GEMINI_TERMS_REVIEWED` | `false` | The owner's confirmation that the terms were read. |
| `AI_PROVIDER` | `gemini` | Selects the provider (only `gemini` exists). |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model id; plain `[A-Za-z0-9._-]` only, because it goes into a URL path. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | Must be `https`. Plain `http` is accepted only for loopback and never in production (used to test against a local stand-in). No credentials or query string allowed. |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | Per provider call. |
| `AI_MAX_RETRIES` | `1` | Extra attempts for transient failures only. |
| `AI_RETRY_BACKOFF_MS` | `800` | First retry delay; doubles. |
| `AI_TEMPERATURE` | `0.7` | Server-side only; clients cannot set it. |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | Thinking tokens count toward this; raise it if replies are cut off or empty. |
| `AI_CONTEXT_MAX_MESSAGES` / `AI_CONTEXT_MAX_CHARS` | `30` / `24000` | What is sent from the supplied conversation. Chars must be at least 8000 (one full message). |
| `AI_REQUESTS_PER_MINUTE` | `6` | Local limit. |
| `AI_REQUESTS_PER_DAY` | `100` | Local limit, counted per quota day. |
| `AI_TOKENS_PER_DAY` | `300000` | Local limit. See the note on instruction size below. |
| `AI_QUOTA_TIMEZONE` | `America/Los_Angeles` | Google resets daily quotas at midnight Pacific time. |

Invalid values stop the server at startup with a message that names the variable and never echoes secrets.

### Model configuration

The model name is read once from `GEMINI_MODEL` into the central config; it appears nowhere else in the code. Google's model catalog (ai.google.dev/models) listed `gemini-3.8-flash` as a current stable Flash model when this was written, which is why it is the default. **I could not verify that it is available on the free tier for your key and region**; confirm in Google AI Studio and change `GEMINI_MODEL` if not. If the model is wrong, Google answers 404 or 400 and the app reports `ai_misconfigured` and pauses for five minutes instead of retrying.

**Every request carries the full identity instruction: about 6,300 characters, roughly 1,600 tokens.** That is the price of the permanent constitution, and it counts against Google's per-minute token limits as well as your local daily budget. The local daily token budget therefore must be much larger than a single conversation: below about 5,000 nothing can run.

## Usage monitoring and zero-cost protection

The app never switches provider or model, never enables billing, and never retries a request that cannot succeed.

- **Ledger.** Every attempt is a row in `ai_usage`: request id, provider, model, status, provider-reported tokens, latency, and the instruction fingerprints. **No prompt, message or instruction text is stored.**
- **Limits.** Before each call, **one SQL statement** checks the per-minute count, the daily request count and the daily token budget (estimates for in-flight requests, provider-reported numbers once known) and records the attempt. Because check and insert are one statement, simultaneous requests cannot overshoot: verified with 8 simultaneous requests against a limit of 3 on Node/SQLite and on D1 (exactly 3 passed).
- **Cool-downs.** After a rate limit, a quota failure, or rejected credentials/model, further requests are refused locally **without calling the provider** until the cool-down ends: the provider's `retryDelay` (at least 60 s), the next Pacific midnight for a daily quota, or five minutes for configuration errors. Cool-downs live in the database, so they survive restarts and apply across stateless Worker instances. When one ends, requests resume with no restart. Verified: 5 further requests after a quota failure reached the provider 0 times, including after a restart.
- **Quota exhaustion for the user.** The API returns 429 `ai_quota_exhausted` with `Retry-After` and `details.retryAfterSeconds`. The server does not store the message (permanent storage is Phase 4), so the **browser keeps it**: the failed message stays in the thread, marked failed, with Retry and Edit. Nothing is lost.
- **Monitoring.** `GET /api/v1/assistant/ai/status` and Settings → Assistant AI show state (`ready`, `disabled`, `cooling_down`, `limit_reached`), requests and tokens today against the limits, any pause and its reason. It calls no provider, so it costs no quota.
- **Free quotas change.** Google sets quotas per project (not per key), differs by model, can change at any time, and is shown in AI Studio. Nothing here promises unlimited or free use. Set `AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY` and `AI_TOKENS_PER_DAY` **at or below** what AI Studio shows for your project.

## Response traceability

Every response carries `trace`: `requestId`, `timestamp`, `provider`, `model` (as reported by the provider), `instruction.permanentFingerprint`, `instruction.fingerprint`, `instruction.versions` (identity, constitution, personality) and `usage` when the provider reports it (never invented).

The fingerprint is the SHA-256 of the exact system message sent for that response: one assembly object produces both the text sent and the fingerprint reported. Tested by hashing what the provider received and comparing, including across configuration changes between requests, and verified over real HTTP. The `ai_usage` row holds the same association. The ledger stores the **configured** model (cool-downs are keyed on it) while `trace.model` is the model Google reports serving.

**Phase 4 integration point.** The shared `responseTraceSchema` is the object to store in `messages.metadata` next to each assistant message (the column already exists from Phase 1). Fingerprints and versions are enough to identify the instruction; its text is not stored per message.

## Conversation context

The model remembers nothing between requests. The browser supplies the thread; `fitContext()` keeps the newest messages that fit `AI_CONTEXT_MAX_MESSAGES` / `AI_CONTEXT_MAX_CHARS`, in order, always including the latest user message and never starting with an assistant message. A latest message that cannot fit is rejected (413), never truncated.

Nothing is dropped silently: the response reports `context.dropped`, the web app shows a note, and the model is told in its own instruction ("N earlier messages were left out ... do not pretend to recall them"). A standing note tells it that no long-term memory exists yet.

**Phase 4 and 5 integration.** `respond()` already accepts `sessionContext` and `taskInstructions` from server code (the Phase 2 layers 5 and 6, behind the same guard), and `fitContext()` is the single place history is trimmed. Phase 4 supplies the stored history to `fitContext()`; Phase 5 supplies memory as session context. The HTTP route accepts neither from clients, so users cannot submit system text. The provider needs no change.

## Streaming

**Not implemented in this phase.** Responses are delivered whole. Reason: reliable streaming needs partial-state handling in the usage ledger (tokens and quota for an interrupted stream), a second code path in every client, and cancellation semantics that this phase's tests are better spent proving on the simple path first. What *is* in place: a reply is never presented as finished unless the provider says it stopped normally (`finishReason: 'stop'`); a reply cut off at the output limit is returned with `complete: false` and shown as cut off; blocked or empty answers return an error and no text; and cancelling a request aborts the upstream call (verified: the provider connection was closed and the ledger recorded `cancelled`). The seam for streaming is an optional second method on `AiProvider`, alongside `generate`.

## Privacy and security measures

- Credentials server-side only; bearer-token authentication on both routes (the existing auth, no second system).
- Strict request validation: roles limited to user/assistant, last message must be the user's, unknown fields (`system`, `model`, `provider`, `temperature`, `apiKey`, `sessionContext`, ...) rejected, 8,000 characters per message, 1 MB body limit.
- Provider, model, temperature and limits are never client input.
- Responses validated against a shared schema before they are returned and again in the browser; message text is rendered as text, never as HTML.
- Logs carry request id, provider, model, token counts, latency and the fingerprint. They never carry message text, instruction text or keys (tested and verified).
- Local rate and usage limits protect the one expensive endpoint; they do not replace a rate limit on sign-in (see the README).
- The browser stores only the session token (in `localStorage`, documented trade-off) and keeps the conversation in memory.

## API reference (all require a bearer token)

`GET /api/v1/assistant/ai/status` returns state, activation, provider, model, `blockedUntil`/`blockedReason`, usage, limits and the data notice. Never the key.

`POST /api/v1/assistant/respond` takes `{ "messages": [{ "role": "user" | "assistant", "content": "..." }] }` and returns `{ message, complete, finishReason, trace, context }`.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Bad body (details name the fields). |
| 401 | `unauthorized`, `invalid_session` | Sign in again. |
| 408 | `request_cancelled` | The client disconnected. |
| 413 | `message_too_long` | Shorten the latest message. |
| 422 | `ai_response_blocked` | The provider blocked it; rephrase. |
| 429 | `ai_rate_limited`, `ai_usage_limit_reached`, `ai_quota_exhausted` | See `Retry-After` and `details.source` (`local` or `provider`). |
| 502/503/504 | `ai_unreachable`, `ai_provider_unavailable`, `ai_timeout`, `ai_bad_response`, `ai_error` | Transient; the client may retry. |
| 503 | `ai_disabled`, `ai_not_configured`, `ai_terms_not_reviewed`, `ai_misconfigured` | Owner action needed; `details.retryable` is false. |

Every AI error carries `details.retryable` so clients know whether a retry can help.

## Testing

```bash
npm run check                       # typecheck, API tests, web tests, build
npm test -w @assistant/api          # provider, config, usage ledger, context, conversation API (Phase 1-3)
npm test -w @assistant/web          # message submission, loading, rendering, errors, retry, cancel, auth, mobile contract
```

What the automated tests are, and are not:

- **Provider tests** use an injected `fetch` returning Gemini-shaped responses, plus a real HTTP server on loopback. They cover valid responses, token usage, invalid configuration and credentials, network failure, timeout, cancellation, rate limit, quota exhaustion, provider 5xx, malformed responses and blocked content.
- **They are mocked.** They prove the provider handles the responses I wrote down from Google's documentation. **They do not prove that a live Gemini connection works.**
- **Frontend tests** run in jsdom, which does no layout. The mobile test pins the CSS/HTML contracts for phones (device-width viewport, 16px inputs so iOS does not zoom, 44px touch targets, safe areas, `dvh`, mobile-first breakpoints). It cannot show that the screen *looks* right. Check it on a real phone.

### First live test

Do this once, after the steps in [Secure credential setup](#secure-credential-setup):

1. Start the API and open Settings → Assistant AI. Expect state `ready`, and your model name.
2. In Conversation send a harmless message such as "Hello". Expect a reply that addresses you as "Sir", an expanded **Details** line showing the model and token counts, and no error.
3. Open Details: `Instruction` and `Permanent layers` fingerprints should be present. Send a second message and confirm the first reply is not repeated and the thread is sent (the model should be able to refer to your first message).
4. Check Settings: requests today should have risen by the number of messages, and tokens today by roughly 1,700+ per message.
5. Optional: `npm run eval -w @assistant/api -- --yes` runs 10 behavior scenarios (public test prompts, default instruction, **no personal data**) against the live model. It spends 10 requests of your quota, which are **not** recorded in the ledger. Most results will read `needs_review`; that is honest, a script cannot judge quality.
6. If anything fails, use the table below. Do not change code to make a failing live check pass until you know which assumption was wrong.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Composer says live AI is switched off | `AI_ENABLED` is not `true` | Intended default. Enable only after [Before you enable it](#before-you-enable-it). |
| "no provider credentials" | `GEMINI_API_KEY` unset (or empty) | Set it; restart. |
| "terms review" | `GEMINI_TERMS_REVIEWED` is not `true` | Read the terms, then set it yourself. |
| `ai_misconfigured` and a pause | Key rejected (401/403/400), model id not found (404), or a precondition such as free tier unavailable in your region (400 `FAILED_PRECONDITION`) | Check the key and `GEMINI_MODEL` in AI Studio; server logs show the provider's status word. The pause lasts 5 minutes. |
| `ai_rate_limited` with `source: local` | Your `AI_REQUESTS_PER_MINUTE` | Wait, or raise it only if AI Studio allows. |
| `ai_rate_limited` with `source: provider` | Google's per-minute limit | Wait for `Retry-After`. |
| `ai_quota_exhausted` | Google's daily quota | Resets at midnight Pacific; messages stay in the browser. |
| `ai_usage_limit_reached` | Your local daily limit | Resets with the Pacific day; raise only within your real quota. |
| Replies end mid-sentence | Output limit | The UI marks them cut off. Raise `AI_MAX_OUTPUT_TOKENS` (thinking tokens count toward it). |
| `ai_bad_response` saying the output limit was used up | Thinking consumed the budget | Raise `AI_MAX_OUTPUT_TOKENS`. |
| `ai_timeout` | Provider slow | Raise `AI_REQUEST_TIMEOUT_MS`, or retry. |
| `ai_response_blocked` | Provider safety filter | Rephrase. |
| Status `degraded` or schema `missing` | Migration `0003` not applied | `npm run db:migrate` (or `wrangler d1 migrations apply DB --remote`). |
| Browser shows "Can't reach the server" | API not running, wrong `VITE_API_BASE_URL`, or CORS (`CORS_ORIGINS` must list the web origin exactly) | Start the API; check the setting. |

## Sources

Read from Google's documentation while writing this: the `models.generateContent` reference and `GenerateContentResponse` (ai.google.dev/api), the API error guide (ai.google.dev/gemini-api/docs/generate-content/api-errors), rate limits (ai.google.dev/gemini-api/docs/rate-limits: limits are per project, daily limits reset at midnight Pacific time), the model catalog (ai.google.dev/models) and the Gemini API Additional Terms (ai.google.dev/gemini-api/terms; archived versions through 20 November 2025 were what I could read). Terms, quotas and models change: re-check them.
