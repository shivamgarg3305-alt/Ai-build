import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/ai/errors';
import { GeminiProvider, type GeminiProviderOptions } from '../src/ai/gemini';
import type { AiGenerateRequest } from '../src/ai/types';
import { AI_KEY } from './helpers';

const BASE = 'https://generativelanguage.googleapis.com';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
  modelVersion: 'gemini-3.8-flash',
  ...extra,
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
function make(handler: Fetch, over: Partial<GeminiProviderOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = new GeminiProvider({
    apiKey: AI_KEY, model: 'gemini-3.8-flash', baseUrl: BASE, timeoutMs: 1000, temperature: 0.7, maxOutputTokens: 2048,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch,
    ...over,
  });
  return { provider, calls };
}
const ask = (over: Partial<AiGenerateRequest> = {}): AiGenerateRequest => ({
  messages: [{ role: 'system', content: 'SYSTEM TEXT' }, { role: 'user', content: 'Hello' }], ...over,
});
const expectKind = async (promise: Promise<unknown>, kind: string) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AiProviderError);
  expect((error as AiProviderError).kind).toBe(kind);
  return error as AiProviderError;
};

describe('Gemini provider: valid responses', () => {
  it('sends the documented request shape and parses the answer, model and token usage', async () => {
    const { provider, calls } = make(async () => json(answer('Good evening, Sir.')));
    const result = await provider.generate(
      ask({ messages: [{ role: 'system', content: 'SYSTEM TEXT' }, { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Status?' }] }),
    );
    expect(result).toEqual({ text: 'Good evening, Sir.', model: 'gemini-3.8-flash', usage: { inputTokens: 120, outputTokens: 30 }, finishReason: 'stop' });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`${BASE}/v1beta/models/gemini-3.8-flash:generateContent`);
    expect(init.method).toBe('POST');
    expect(url).not.toContain(AI_KEY); // the key is never in the URL
    expect(init.headers).toMatchObject({ 'x-goog-api-key': AI_KEY, 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      systemInstruction: { parts: [{ text: 'SYSTEM TEXT' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
        { role: 'user', parts: [{ text: 'Status?' }] },
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });
  });

  it('applies per-request temperature and output limits over the configured defaults', async () => {
    const { provider, calls } = make(async () => json(answer('ok')));
    await provider.generate(ask({ temperature: 0.1, maxOutputTokens: 64 }));
    expect(JSON.parse(String(calls[0]!.init.body)).generationConfig).toEqual({ temperature: 0.1, maxOutputTokens: 64 });
  });

  it('takes the model from configuration and encodes it into the path', async () => {
    const { provider, calls } = make(async () => json(answer('ok')), { model: 'gemini-9.9/x y' });
    await provider.generate(ask());
    expect(calls[0]!.url).toBe(`${BASE}/v1beta/models/gemini-9.9%2Fx%20y:generateContent`);
  });

  it('omits systemInstruction when there is no system message, and joins several', async () => {
    const { provider, calls } = make(async () => json(answer('ok')));
    await provider.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty('systemInstruction');
    await provider.generate({ messages: [{ role: 'system', content: 'A' }, { role: 'system', content: 'B' }, { role: 'user', content: 'Hi' }] });
    expect(JSON.parse(String(calls[1]!.init.body)).systemInstruction.parts[0].text).toBe('A\n\nB');
  });

  it('joins text parts and ignores thought parts', async () => {
    const { provider } = make(async () => json({ candidates: [{ content: { parts: [{ text: 'hidden reasoning', thought: true }, { text: 'Part one. ' }, { text: 'Part two.' }] }, finishReason: 'STOP' }] }));
    expect((await provider.generate(ask())).text).toBe('Part one. Part two.');
  });

  it('falls back to the configured model name when the response does not name one', async () => {
    const { provider } = make(async () => json(answer('ok', { modelVersion: undefined })));
    expect((await provider.generate(ask())).model).toBe('gemini-3.8-flash');
  });
});

describe('Gemini provider: token usage', () => {
  it('counts thinking tokens as output', async () => {
    const { provider } = make(async () => json(answer('ok', { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 60, totalTokenCount: 200 } })));
    expect((await provider.generate(ask())).usage).toEqual({ inputTokens: 100, outputTokens: 100 });
  });

  it('reports no usage rather than inventing it when the provider supplies none', async () => {
    const { provider } = make(async () => json(answer('ok', { usageMetadata: undefined })));
    expect((await provider.generate(ask())).usage).toBeUndefined();
  });

  it('rejects usage numbers of the wrong type as a malformed response', async () => {
    const { provider } = make(async () => json(answer('ok', { usageMetadata: { promptTokenCount: 'lots' } })));
    await expectKind(provider.generate(ask()), 'malformed_response');
  });
});

describe('Gemini provider: completed vs incomplete', () => {
  it('reports hitting the output limit as length, never as a finished answer', async () => {
    const { provider } = make(async () => json({ candidates: [{ content: { parts: [{ text: 'Half an ans' }] }, finishReason: 'MAX_TOKENS' }] }));
    expect((await provider.generate(ask())).finishReason).toBe('length');
  });

  it('reports an unknown or missing finish reason as other', async () => {
    const { provider } = make(async () => json({ candidates: [{ content: { parts: [{ text: 'Some text' }] } }] }));
    expect((await provider.generate(ask())).finishReason).toBe('other');
  });

  it('explains an empty answer caused by the output limit', async () => {
    const { provider } = make(async () => json({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
    const error = await expectKind(provider.generate(ask()), 'malformed_response');
    expect(error.message).toMatch(/AI_MAX_OUTPUT_TOKENS/);
  });
});

describe('Gemini provider: invalid configuration and credentials', () => {
  it('refuses to be built without an API key', () => {
    expect(() => new GeminiProvider({ apiKey: '', model: 'm', baseUrl: BASE, timeoutMs: 1000, temperature: 0.5, maxOutputTokens: 10 })).toThrow(expect.objectContaining({ kind: 'not_configured' }));
  });

  it('refuses to send an empty conversation', async () => {
    const { provider, calls } = make(async () => json(answer('x')));
    await expectKind(provider.generate({ messages: [{ role: 'system', content: 'only system' }] }), 'bad_request');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }],
    [401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } }],
    [403, { error: { code: 403, message: 'Permission denied.', status: 'PERMISSION_DENIED' } }],
  ])('maps HTTP %s credential failures to invalid_credentials, without leaking provider text', async (status, body) => {
    const { provider } = make(async () => json(body, status));
    const error = await expectKind(provider.generate(ask()), 'invalid_credentials');
    expect(error.message).toBe('The AI provider rejected the server credentials.');
    expect(error.retryable).toBe(false);
    expect(error.message + (error.detail ?? '')).not.toContain(AI_KEY);
  });

  it('maps a missing model (404) and other bad requests to bad_request', async () => {
    await expectKind(make(async () => json({ error: { code: 404, message: 'models/x is not found', status: 'NOT_FOUND' } }, 404)).provider.generate(ask()), 'bad_request');
    await expectKind(make(async () => json({ error: { code: 400, message: 'Invalid JSON payload', status: 'INVALID_ARGUMENT' } }, 400)).provider.generate(ask()), 'bad_request');
    await expectKind(make(async () => new Response('not json at all', { status: 400 })).provider.generate(ask()), 'bad_request');
  });
});

describe('Gemini provider: rate limits and quota', () => {
  it('maps a 429 to rate_limited and reads the retry delay Google supplies', async () => {
    const body = { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }] } };
    const error = await expectKind(make(async () => json(body, 429)).provider.generate(ask()), 'rate_limited');
    expect(error.retryAfterSeconds).toBe(34);
    expect(error.retryable).toBe(false); // retrying immediately would only burn quota
  });

  it('falls back to the Retry-After header', async () => {
    const error = await expectKind(make(async () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'slow down' } }, 429, { 'retry-after': '12' })).provider.generate(ask()), 'rate_limited');
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('recognises an exhausted daily quota', async () => {
    const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    const error = await expectKind(make(async () => json(body, 429)).provider.generate(ask()), 'quota_exhausted');
    expect(error.retryable).toBe(false);
  });
});

describe('Gemini provider: network, timeout and cancellation', () => {
  it('maps a network failure to a retryable error and redacts key-shaped text', async () => {
    const { provider } = make(async () => {
      throw new TypeError('fetch failed: https://x/?key=AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE123456 refused');
    });
    const error = await expectKind(provider.generate(ask()), 'network');
    expect(error.retryable).toBe(true);
    expect(error.detail).not.toMatch(/AIza/);
    expect(error.message).toBe('The AI provider could not be reached.');
  });

  it('times out when the provider does not answer, and aborts the request', async () => {
    let aborted = false;
    const { provider } = make(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      { timeoutMs: 30 },
    );
    const error = await expectKind(provider.generate(ask()), 'timeout');
    expect(aborted).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('honours caller cancellation mid-flight', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const { provider } = make((_url, init) => new Promise<Response>((_resolve, reject) => {
      started();
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = provider.generate(ask({ signal: controller.signal }));
    await ready;
    controller.abort();
    await expectKind(pending, 'cancelled');
  });

  it('does not call the provider at all when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, calls } = make(async () => json(answer('x')));
    await expectKind(provider.generate(ask({ signal: controller.signal })), 'cancelled');
    expect(calls).toHaveLength(0);
  });
});

describe('Gemini provider: provider-side failures and malformed responses', () => {
  it.each([[500, 'provider_unavailable', true], [503, 'provider_unavailable', true], [408, 'provider_unavailable', true], [504, 'timeout', false]])(
    'maps HTTP %s to %s (retryable: %s)',
    async (status, kind, retryable) => {
      const error = await expectKind(make(async () => json({ error: { code: status, status: 'UNAVAILABLE', message: 'try later' } }, status)).provider.generate(ask()), kind);
      expect(error.retryable).toBe(retryable);
    },
  );

  it('rejects a body that is not JSON', async () => {
    await expectKind(make(async () => new Response('<html>oops</html>', { status: 200 })).provider.generate(ask()), 'malformed_response');
  });

  it('rejects a body of the wrong shape', async () => {
    await expectKind(make(async () => json({ candidates: 'nope' })).provider.generate(ask()), 'malformed_response');
  });

  it('rejects a response with no candidates', async () => {
    await expectKind(make(async () => json({})).provider.generate(ask()), 'malformed_response');
  });

  it('reports a blocked prompt and a safety-stopped answer as content_blocked, returning no text', async () => {
    await expectKind(make(async () => json({ promptFeedback: { blockReason: 'SAFETY' } })).provider.generate(ask()), 'content_blocked');
    const stopped = json({ candidates: [{ content: { parts: [{ text: 'partial unsafe text' }] }, finishReason: 'SAFETY' }] });
    await expectKind(make(async () => stopped).provider.generate(ask()), 'content_blocked');
  });
});

describe('Gemini provider over real HTTP (local stand-in server)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  const listen = (handler: (req: IncomingMessage, body: string, res: import('node:http').ServerResponse) => void) =>
    new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => handler(req, body, res));
      }).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`));
    });

  it('transmits the key only in the header and the conversation only in the body', async () => {
    const seen: { url?: string; key?: string | string[]; body?: string } = {};
    const baseUrl = await listen((req, body, res) => {
      Object.assign(seen, { url: req.url, key: req.headers['x-goog-api-key'], body });
      res.setHeader('content-type', 'application/json').end(JSON.stringify(answer('Over the wire, Sir.')));
    });
    const provider = new GeminiProvider({ apiKey: AI_KEY, model: 'gemini-3.8-flash', baseUrl, timeoutMs: 2000, temperature: 0.7, maxOutputTokens: 100 });
    const result = await provider.generate(ask());
    expect(result.text).toBe('Over the wire, Sir.');
    expect(seen.url).toBe('/v1beta/models/gemini-3.8-flash:generateContent');
    expect(seen.url).not.toContain(AI_KEY);
    expect(seen.key).toBe(AI_KEY);
    expect(JSON.parse(seen.body!).contents[0].parts[0].text).toBe('Hello');
  });

  it('times out against a server that never answers', async () => {
    const baseUrl = await listen(() => undefined);
    const provider = new GeminiProvider({ apiKey: AI_KEY, model: 'm', baseUrl, timeoutMs: 150, temperature: 0.7, maxOutputTokens: 100 });
    await expectKind(provider.generate(ask()), 'timeout');
  });

  it('maps a real 429 response', async () => {
    const baseUrl = await listen((_req, _body, res) => {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json').end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } }));
    });
    const provider = new GeminiProvider({ apiKey: AI_KEY, model: 'm', baseUrl, timeoutMs: 2000, temperature: 0.7, maxOutputTokens: 100 });
    const error = await expectKind(provider.generate(ask()), 'rate_limited');
    expect(error.retryAfterSeconds).toBe(7);
  });
});
