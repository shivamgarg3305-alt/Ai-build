import { respondResponseSchema, type AiStatus, type ConversationMessage, type RespondResponse } from '@assistant/shared';
import { GEMINI_DATA_NOTICE, type AiActivation } from '../ai/config';
import { AiProviderError, sanitizeProviderText } from '../ai/errors';
import type { AiGenerateResult, AiProvider } from '../ai/types';
import {
  finalizeUsage,
  getUsageSnapshot,
  reserveUsage,
  secondsUntilQuotaDayEnds,
  type ReserveResult,
  type UsageOutcome,
} from '../ai/usage';
import { AppError } from '../errors';
import type { Services } from '../services';
import { fitContext } from './context';
import { buildAiRequest } from './pipeline';
import { loadAssembly } from './service';

export interface RespondInput {
  messages: readonly ConversationMessage[];
  /** Server-side seam for later phases (memory, voice). NOT accepted from HTTP clients. */
  sessionContext?: readonly string[];
  taskInstructions?: readonly string[];
}

export interface RespondContext {
  services: Services;
  userId: string;
  requestId: string;
  signal?: AbortSignal | undefined;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const NO_MEMORY_NOTE =
  'No long-term memory is available yet. Only the messages supplied in this request are known to you. Do not claim to remember anything else.';
const droppedNote = (n: number): string =>
  `${n} earlier message${n === 1 ? ' was' : 's were'} of this conversation left out because of length limits and ${n === 1 ? 'is' : 'are'} not available to you. Do not pretend to recall ${n === 1 ? 'it' : 'them'}.`;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function activationError(activation: Exclude<AiActivation, 'active'>): AppError {
  const details = { retryable: false };
  if (activation === 'disabled') return new AppError(503, 'ai_disabled', 'Live AI responses are switched off on this server.', details);
  if (activation === 'missing_api_key') return new AppError(503, 'ai_not_configured', 'AI is enabled, but no provider credentials are configured on the server.', details);
  return new AppError(503, 'ai_terms_not_reviewed', 'AI is enabled, but the owner has not confirmed that the provider data terms were reviewed.', details);
}

/** Why the usage guard refused a request, as an API error. */
function refusalError(refusal: Extract<ReserveResult, { ok: false }>): AppError {
  const base = { retryAfterSeconds: refusal.retryAfterSeconds, source: refusal.source };
  if (refusal.reason === 'per_minute') {
    return new AppError(429, 'ai_rate_limited', 'Too many requests in the last minute. Please wait a moment.', { ...base, retryable: true });
  }
  if (refusal.reason === 'per_day_requests' || refusal.reason === 'per_day_tokens') {
    const scope = refusal.reason === 'per_day_requests' ? 'day_requests' : 'day_tokens';
    return new AppError(429, 'ai_usage_limit_reached', "The daily AI usage limit set for this assistant has been reached. Your message is kept; try again after the limit resets.", { ...base, scope, retryable: true });
  }
  // A cool-down left by an earlier provider failure: no request is sent to a provider known to be refusing.
  switch (refusal.blockedKind) {
    case 'quota_exhausted':
      return new AppError(429, 'ai_quota_exhausted', "The AI provider's quota is exhausted. Your message is kept; try again after the quota resets.", { ...base, retryable: true });
    case 'rate_limited':
      return new AppError(429, 'ai_rate_limited', 'The AI provider is rate limiting requests. Please try again shortly.', { ...base, retryable: true });
    case 'invalid_credentials':
    case 'bad_request':
    case 'not_configured':
      return new AppError(503, 'ai_misconfigured', 'The AI provider rejected the server configuration. The owner must check the credentials and model. Requests are paused briefly.', { ...base, retryable: false });
    default:
      return new AppError(503, 'ai_provider_unavailable', 'The AI provider is temporarily unavailable. Please try again shortly.', { ...base, retryable: true });
  }
}

/** A provider failure as an API error. Only the normalised, user-safe message is exposed. */
function failureError(error: AiProviderError, cooldownSeconds?: number): AppError {
  // When a cool-down was set, that is when requests will next be sent: tell the client, not just the provider's hint.
  const retry = cooldownSeconds ?? error.retryAfterSeconds;
  const details = (retryable: boolean) => ({ retryable, ...(retry !== undefined ? { retryAfterSeconds: retry } : {}), source: 'provider' as const });
  switch (error.kind) {
    case 'rate_limited':
      return new AppError(429, 'ai_rate_limited', 'The AI provider is rate limiting requests. Please try again shortly.', details(true));
    case 'quota_exhausted':
      return new AppError(429, 'ai_quota_exhausted', "The AI provider's quota is exhausted. Your message is kept; try again after the quota resets.", details(true));
    case 'timeout':
      return new AppError(504, 'ai_timeout', 'The AI provider did not answer in time.', details(true));
    case 'network':
      return new AppError(502, 'ai_unreachable', 'The AI provider could not be reached.', details(true));
    case 'provider_unavailable':
      return new AppError(503, 'ai_provider_unavailable', 'The AI provider is temporarily unavailable.', details(true));
    case 'cancelled':
      return new AppError(408, 'request_cancelled', 'The request was cancelled.', { retryable: true });
    case 'content_blocked':
      return new AppError(422, 'ai_response_blocked', error.message, { retryable: false });
    case 'invalid_credentials':
    case 'bad_request':
    case 'not_configured':
      return new AppError(503, 'ai_misconfigured', 'The AI provider rejected the server configuration. The owner must check the credentials and model.', { retryable: false });
    case 'malformed_response':
      return new AppError(502, 'ai_bad_response', error.message, { retryable: true });
    default:
      return new AppError(502, 'ai_error', 'The AI provider failed unexpectedly.', { retryable: true });
  }
}

/** How long to stop sending requests after a failure that would just fail again. */
function cooldownUntil(error: AiProviderError, now: Date, timeZone: string): Date | undefined {
  const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  switch (error.kind) {
    case 'rate_limited':
      return after(Math.max(error.retryAfterSeconds ?? 60, 5));
    case 'quota_exhausted':
      return after(Math.max(secondsUntilQuotaDayEnds(now, timeZone), error.retryAfterSeconds ?? 0));
    case 'invalid_credentials':
    case 'bad_request':
    case 'not_configured':
      return after(300);
    default:
      return undefined;
  }
}

const statusOf = (error: AiProviderError): UsageOutcome['status'] =>
  error.kind === 'rate_limited' ? 'rate_limited' : error.kind === 'quota_exhausted' ? 'quota_exhausted' : error.kind === 'cancelled' ? 'cancelled' : error.kind === 'timeout' ? 'timeout' : 'error';

/**
 * Receives the conversation supplied by the application, builds the instruction with the Phase 2 pipeline,
 * enforces the usage limits, calls the provider, and returns the reply together with a trace that ties it to
 * the exact instruction used. Persistence of the conversation is Phase 4; nothing about it is stored here.
 */
export async function respond(ctx: RespondContext, input: RespondInput): Promise<RespondResponse> {
  const { services, userId, requestId } = ctx;
  const { config, db, logger } = services;
  const ai = config.ai;
  const clock = ctx.now ?? (() => new Date());
  const sleep = ctx.sleep ?? defaultSleep;

  if (ai.activation !== 'active') throw activationError(ai.activation);
  let provider: AiProvider;
  try {
    provider = services.ai.get(ai.provider);
  } catch {
    throw new AppError(503, 'ai_not_configured', 'No AI provider is available on this server.', { retryable: false });
  }

  // 1. Context the model will actually see, with an honest account of anything left out.
  const fitted = fitContext(input.messages, ai.context);
  const notes = [NO_MEMORY_NOTE, ...(fitted.dropped > 0 ? [droppedNote(fitted.dropped)] : [])];

  // 2. The Phase 2 instruction: identity, constitution, personality, preferences, session, task.
  const assembly = await loadAssembly(db, userId, {
    sessionContext: [...notes, ...(input.sessionContext ?? [])],
    taskInstructions: input.taskInstructions ?? [],
  });
  if (assembly.rejected.length > 0) {
    logger.warn('instruction items were rejected during assembly', { count: assembly.rejected.length, rules: assembly.rejected.map((r) => r.ruleId) });
  }
  const versions = Object.fromEntries(assembly.layers.filter((l) => l.version).map((l) => [l.id, l.version as string]));
  const request = buildAiRequest({
    assembly,
    messages: fitted.messages,
    temperature: ai.temperature,
    maxOutputTokens: ai.maxOutputTokens,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  const inputChars = assembly.text.length + fitted.messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedInput = Math.ceil(inputChars / 3);

  // 3. Reserve a slot against the limits, call the provider, retry only transient failures.
  const maxAttempts = 1 + ai.maxRetries;
  for (let attempt = 1; ; attempt++) {
    if (ctx.signal?.aborted) throw new AppError(408, 'request_cancelled', 'The request was cancelled.', { retryable: true });

    const reserved = await reserveUsage(db, {
      userId, requestId, provider: provider.name, model: ai.model, attempt,
      estimatedTokens: estimatedInput + ai.maxOutputTokens,
      limits: ai.limits, timeZone: ai.quotaTimeZone, now: clock(),
      instruction: { permanentFingerprint: assembly.permanentFingerprint, fingerprint: assembly.fingerprint, versions },
    });
    if (!reserved.ok) throw refusalError(reserved);

    const started = Date.now();
    let result: AiGenerateResult | undefined;
    let failure: AiProviderError | undefined;
    try {
      result = await provider.generate(request);
    } catch (caught) {
      failure =
        caught instanceof AiProviderError
          ? caught
          : new AiProviderError('unknown', 'The AI provider failed unexpectedly.', { detail: sanitizeProviderText(caught instanceof Error ? caught.message : String(caught)) });
    }
    const latencyMs = Date.now() - started;

    if (failure) {
      const blockedUntil = cooldownUntil(failure, clock(), ai.quotaTimeZone);
      await finalizeUsage(db, reserved.id, {
        status: statusOf(failure), errorKind: failure.kind, latencyMs, now: clock(),
        ...(blockedUntil ? { blockedUntil } : {}),
      });
      logger.warn('ai request failed', { provider: provider.name, model: ai.model, kind: failure.kind, httpStatus: failure.httpStatus, attempt, latencyMs, detail: failure.detail });
      if (failure.retryable && attempt < maxAttempts && !ctx.signal?.aborted) {
        await sleep(ai.retryBackoffMs * 2 ** (attempt - 1));
        continue;
      }
      const cooldownSeconds = blockedUntil ? Math.max(1, Math.ceil((blockedUntil.getTime() - clock().getTime()) / 1000)) : undefined;
      throw failureError(failure, cooldownSeconds);
    }
    if (!result) throw new AppError(502, 'ai_error', 'The AI provider failed unexpectedly.', { retryable: true });

    // 4. Account for the usage; never present a cut-off reply as a finished one.
    const finishReason = result.finishReason ?? 'stop';
    const reported = result.usage;
    const inputTokens = reported?.inputTokens ?? estimatedInput; // estimate only for the ledger when the provider reported none
    const outputTokens = reported?.outputTokens ?? Math.ceil(result.text.length / 3);
    await finalizeUsage(db, reserved.id, {
      status: finishReason === 'stop' ? 'completed' : 'incomplete', inputTokens, outputTokens, latencyMs, now: clock(),
    });
    logger.info('ai response', {
      provider: provider.name, model: result.model, finishReason, usageIn: inputTokens, usageOut: outputTokens, latencyMs, attempt,
      fingerprint: assembly.fingerprint,
    });

    return respondResponseSchema.parse({
      message: { role: 'assistant', content: result.text },
      complete: finishReason === 'stop',
      finishReason,
      trace: {
        requestId,
        timestamp: clock().toISOString(),
        provider: provider.name,
        model: result.model,
        instruction: {
          permanentFingerprint: assembly.permanentFingerprint,
          fingerprint: assembly.fingerprint,
          versions: {
            identity: versions['identity'] ?? 'unknown',
            constitution: versions['constitution'] ?? 'unknown',
            personality: versions['personality'] ?? 'unknown',
          },
        },
        ...(reported ? { usage: { inputTokens: reported.inputTokens, outputTokens: reported.outputTokens, totalTokens: reported.inputTokens + reported.outputTokens } } : {}),
      },
      context: { received: fitted.received, sent: fitted.messages.length, dropped: fitted.dropped, truncated: fitted.truncated },
    });
  }
}

/** Provider readiness and usage for the status endpoint. Calls no provider, so it consumes no quota. */
export async function getAiStatus(services: Services, now: Date = new Date()): Promise<AiStatus> {
  const { ai } = services.config;
  const snapshot = await getUsageSnapshot(services.db, { provider: ai.provider, model: ai.model, timeZone: ai.quotaTimeZone, now });
  const registered = services.ai.list().includes(ai.provider);
  const limitReached =
    snapshot.requestsToday >= ai.limits.requestsPerDay ||
    snapshot.tokensToday >= ai.limits.tokensPerDay ||
    snapshot.requestsLastMinute >= ai.limits.requestsPerMinute;
  const state: AiStatus['state'] =
    ai.activation !== 'active' || !registered ? 'disabled' : snapshot.blockedUntil ? 'cooling_down' : limitReached ? 'limit_reached' : 'ready';
  return {
    state,
    activation: ai.activation,
    provider: ai.provider,
    model: ai.model,
    blockedUntil: snapshot.blockedUntil,
    blockedReason: snapshot.blockedReason,
    usage: { quotaDay: snapshot.quotaDay, requestsToday: snapshot.requestsToday, tokensToday: snapshot.tokensToday, requestsLastMinute: snapshot.requestsLastMinute },
    limits: ai.limits,
    dataNotice: ai.activation === 'active' ? GEMINI_DATA_NOTICE : null,
  };
}
