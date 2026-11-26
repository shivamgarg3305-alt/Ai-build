import type { AiStatus, RespondResponse } from '@assistant/shared';
import { vi } from 'vitest';

export interface Call {
  key: string;
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}
export type Handler = (call: Call) => Response | Promise<Response>;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const apiError = (status: number, code: string, message: string, details?: unknown): Response =>
  json({ error: { code, message, requestId: 'req-test', ...(details !== undefined ? { details } : {}) } }, status);

/** Replaces fetch with a router keyed by "METHOD /path" (relative to /api/v1). Unmocked requests fail loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname.replace('/api/v1', '')}`;
    const call: Call = {
      key, url: url.pathname, method, headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, signal: init?.signal,
    };
    calls.push(call);
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked request: ${key}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn, count: (key: string) => calls.filter((c) => c.key === key).length };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

export const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  state: 'ready',
  activation: 'active',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  blockedUntil: null,
  blockedReason: null,
  usage: { quotaDay: '2026-11-15', requestsToday: 3, tokensToday: 4200, requestsLastMinute: 0 },
  limits: { requestsPerMinute: 6, requestsPerDay: 100, tokensPerDay: 300_000 },
  dataNotice: 'Messages are sent to a third-party AI provider. Do not enter sensitive information.',
  ...over,
});

export const reply = (text: string, over: Partial<RespondResponse> = {}): RespondResponse => ({
  message: { role: 'assistant', content: text },
  complete: true,
  finishReason: 'stop',
  trace: {
    requestId: 'b7c1e2a4-0000-4000-8000-000000000001',
    timestamp: '2026-11-15T10:00:00.000Z',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    instruction: {
      permanentFingerprint: 'aaaaaaaaaaaa1111111111111111',
      fingerprint: 'bbbbbbbbbbbb2222222222222222',
      versions: { identity: '1.0.0', constitution: '1.0.0', personality: '1.0.0' },
    },
    usage: { inputTokens: 1700, outputTokens: 40, totalTokens: 1740 },
  },
  context: { received: 1, sent: 1, dropped: 0, truncated: false },
  ...over,
});
