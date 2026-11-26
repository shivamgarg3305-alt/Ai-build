import { z } from 'zod';
import { GEMINI_API_VERSION } from './config';
import { AiProviderError, sanitizeProviderText } from './errors';
import type { AiFinishReason, AiGenerateRequest, AiGenerateResult, AiProvider } from './types';

/**
 * Google Gemini over the official REST API (models.generateContent), using plain fetch: no SDK, so no extra
 * dependency, and it runs unchanged on Node and Cloudflare Workers.
 *
 * Request:  POST {base}/v1beta/models/{model}:generateContent
 *           header x-goog-api-key (never a query parameter, so the key cannot end up in a URL or a log)
 *           body { systemInstruction: {parts:[{text}]}, contents: [{role:'user'|'model', parts:[{text}]}],
 *                  generationConfig: { temperature, maxOutputTokens } }
 * Response: { candidates:[{content:{parts:[{text}]}, finishReason}], promptFeedback:{blockReason},
 *             usageMetadata:{promptTokenCount, candidatesTokenCount, totalTokenCount, thoughtsTokenCount?},
 *             modelVersion? }
 * Errors:   HTTP status plus { error: { code, message, status, details[] } }
 * (Google AI for Developers: API reference for models.generateContent and the API error guide.)
 *
 * Only fields that appear in that documentation are read; every one of them is optional here, and a response
 * that lacks what we need is reported as malformed rather than guessed at.
 */
export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  fetch?: typeof fetch;
}

const countSchema = z.number().int().nonnegative();
const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: countSchema.optional(),
      candidatesTokenCount: countSchema.optional(),
      totalTokenCount: countSchema.optional(),
      thoughtsTokenCount: countSchema.optional(),
    })
    .optional(),
  modelVersion: z.string().optional(),
});

const errorBodySchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
      details: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
});

/** Gemini reports retry delays as protobuf durations such as "34s" or "34.5s". */
function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match?.[1] ? Math.ceil(Number(match[1])) : undefined;
}

function retryAfterFrom(details: readonly Record<string, unknown>[] | undefined, header: string | null): number | undefined {
  for (const detail of details ?? []) {
    if (String(detail['@type'] ?? '').includes('RetryInfo')) {
      const seconds = parseDuration(detail['retryDelay']);
      if (seconds !== undefined) return seconds;
    }
  }
  const fromHeader = header ? Number(header) : NaN;
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? Math.ceil(fromHeader) : undefined;
}

/**
 * Best effort: Google documents 429 RESOURCE_EXHAUSTED for RPM, TPM, RPD and spend limits without a stable
 * machine-readable split, so a limit that names a day is treated as quota exhaustion, and anything else as a
 * short rate limit. The application's own daily limit is the backstop if this guess is wrong.
 */
function isDailyQuota(message: string, details: readonly Record<string, unknown>[] | undefined): boolean {
  const haystack = `${message} ${JSON.stringify(details ?? [])}`.toLowerCase();
  return /perday|per_day|per day|requests per day|daily/.test(haystack);
}

const BLOCKING_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE']);

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiProviderOptions) {
    if (!options.apiKey) throw new AiProviderError('not_configured', 'The Gemini API key is not configured.');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const { model, timeoutMs } = this.options;
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const turns = request.messages.filter((m) => m.role !== 'system');
    if (turns.length === 0) throw new AiProviderError('bad_request', 'There is no message to send to the model.');

    const body = {
      ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
      contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: request.temperature ?? this.options.temperature,
        maxOutputTokens: request.maxOutputTokens ?? this.options.maxOutputTokens,
      },
    };
    const url = `${this.options.baseUrl}/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:generateContent`;

    const outcome = await this.send(url, body, request.signal, timeoutMs);
    return outcome.ok ? this.parseSuccess(outcome.text) : this.mapFailure(outcome.status, outcome.text, outcome.retryAfterHeader);
  }

  /** One HTTP round trip with a timeout and caller cancellation. Never includes request details in errors. */
  private async send(url: string, body: unknown, signal: AbortSignal | undefined, timeoutMs: number) {
    if (signal?.aborted) throw new AiProviderError('cancelled', 'The request was cancelled.');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, retryAfterHeader: res.headers.get('retry-after') };
    } catch (error) {
      if (timedOut) throw new AiProviderError('timeout', 'The AI provider did not answer in time.');
      if (signal?.aborted) throw new AiProviderError('cancelled', 'The request was cancelled.');
      throw new AiProviderError('network', 'The AI provider could not be reached.', {
        detail: sanitizeProviderText(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private parseSuccess(text: string): AiGenerateResult {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiProviderError('malformed_response', 'The AI provider returned a response that is not valid JSON.');
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new AiProviderError('malformed_response', 'The AI provider returned a response in an unexpected format.');
    const { candidates, promptFeedback, usageMetadata, modelVersion } = parsed.data;

    if (promptFeedback?.blockReason) {
      throw new AiProviderError('content_blocked', `The AI provider blocked this request (${promptFeedback.blockReason}).`);
    }
    const candidate = candidates?.[0];
    if (!candidate) throw new AiProviderError('malformed_response', 'The AI provider returned no answer.');

    const reason = candidate.finishReason;
    if (reason && BLOCKING_FINISH.has(reason)) {
      throw new AiProviderError('content_blocked', `The AI provider stopped the answer (${reason}).`);
    }
    // Thought summaries (thought: true) are not part of the answer.
    const answer = (candidate.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    if (answer.trim() === '') {
      throw new AiProviderError(
        'malformed_response',
        reason === 'MAX_TOKENS'
          ? 'The model used its whole output limit before producing an answer. Raise AI_MAX_OUTPUT_TOKENS.'
          : 'The AI provider returned an empty answer.',
      );
    }

    const finishReason: AiFinishReason = reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : 'other';
    const result: AiGenerateResult = { text: answer, model: modelVersion ?? this.options.model, finishReason };
    if (usageMetadata?.promptTokenCount !== undefined || usageMetadata?.candidatesTokenCount !== undefined) {
      // Thinking tokens are billed and counted as output, so they are included here.
      result.usage = {
        inputTokens: usageMetadata.promptTokenCount ?? 0,
        outputTokens: (usageMetadata.candidatesTokenCount ?? 0) + (usageMetadata.thoughtsTokenCount ?? 0),
      };
    }
    return result;
  }

  private mapFailure(status: number, text: string, retryAfterHeader: string | null): never {
    let parsed: z.infer<typeof errorBodySchema>['error'];
    try {
      parsed = errorBodySchema.parse(JSON.parse(text)).error;
    } catch {
      parsed = undefined;
    }
    const message = parsed?.message ?? '';
    const details = parsed?.details;
    const detail = sanitizeProviderText(`${parsed?.status ?? ''} ${message}`);
    const reasons = JSON.stringify(details ?? []);
    const base = { httpStatus: status, detail };

    if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(`${message} ${reasons}`)) {
      throw new AiProviderError('invalid_credentials', 'The AI provider rejected the server credentials.', base);
    }
    if (status === 429) {
      const retryAfterSeconds = retryAfterFrom(details, retryAfterHeader);
      if (isDailyQuota(message, details)) {
        throw new AiProviderError('quota_exhausted', 'The AI provider quota is exhausted.', { ...base, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) });
      }
      throw new AiProviderError('rate_limited', 'The AI provider is rate limiting requests.', { ...base, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) });
    }
    if (status === 504) throw new AiProviderError('timeout', 'The AI provider could not finish in time.', base);
    if (status === 408 || status >= 500) throw new AiProviderError('provider_unavailable', 'The AI provider is temporarily unavailable.', base);
    if (status === 404) throw new AiProviderError('bad_request', 'The configured model was not found or is not available to this key.', base);
    throw new AiProviderError('bad_request', 'The AI provider rejected the request.', base);
  }
}
