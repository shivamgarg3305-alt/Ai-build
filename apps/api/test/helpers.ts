import { fileURLToPath } from 'node:url';
import { AiProviderRegistry } from '../src/ai/registry';
import type { AiGenerateRequest, AiGenerateResult, AiProvider } from '../src/ai/types';
import { createApp } from '../src/app';
import { migrateSqlite } from '../src/db/migrate-node';
import { SqliteDatabase } from '../src/db/sqlite';
import { loadConfig } from '../src/env';
import { InProcessJobRunner } from '../src/jobs/in-process';
import { createLogger } from '../src/logger';
import type { Services } from '../src/services';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
export const SECRET = 'test-secret-'.padEnd(48, 'x');
export const PASSWORD = 'correct horse battery staple';

export function createTestApp(options: { migrate?: boolean; dbPath?: string; env?: Record<string, string>; provider?: AiProvider; overrides?: Partial<Services> } = {}) {
  const db = SqliteDatabase.open(options.dbPath ?? ':memory:');
  if (options.migrate !== false) migrateSqlite(db, MIGRATIONS_DIR);
  const logger = createLogger({ level: 'silent' });
  const ai = new AiProviderRegistry();
  if (options.provider) ai.register(options.provider);
  const services: Services = {
    config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: SECRET, CORS_ORIGINS: 'http://localhost:5173', ...options.env }),
    logger,
    db,
    ai,
    jobs: new InProcessJobRunner(logger, () => 1),
    ...options.overrides,
  };
  return { app: createApp(services), db, services };
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type Requester = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

/** Registers the owner account on a fresh app and returns its bearer token. */
export async function registerOwner(app: Requester): Promise<string> {
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', displayName: 'Owner', password: PASSWORD }),
  });
  return ((await res.json()) as { token: string }).token;
}

export async function loginOwner(app: Requester): Promise<string> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: PASSWORD }),
  });
  return ((await res.json()) as { token: string }).token;
}

/** A small authenticated API caller: call('POST', '/assistant/preferences', { text }). */
export function client(app: Requester, token: string) {
  return (method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

export const AI_KEY = 'test-key-not-a-real-credential-0123456789';

/** Live AI switched on, with limits and backoff relaxed so tests can focus on one behaviour at a time. */
export const AI_ACTIVE_ENV: Record<string, string> = {
  AI_ENABLED: 'true',
  GEMINI_API_KEY: AI_KEY,
  GEMINI_TERMS_REVIEWED: 'true',
  AI_RETRY_BACKOFF_MS: '1',
  AI_REQUESTS_PER_MINUTE: '1000',
  AI_REQUESTS_PER_DAY: '100000',
  AI_TOKENS_PER_DAY: '100000000',
};

type Handler = (request: AiGenerateRequest, call: number) => Promise<AiGenerateResult> | AiGenerateResult;

/** A scripted stand-in for the Gemini provider that records exactly what it was sent. */
export function fakeProvider(handler?: Handler) {
  const requests: AiGenerateRequest[] = [];
  const provider: AiProvider = {
    name: 'gemini',
    async generate(request) {
      requests.push(request);
      return (handler ?? (() => ({ text: 'Understood, Sir.', model: 'gemini-test-1', usage: { inputTokens: 120, outputTokens: 30 }, finishReason: 'stop' as const })))(request, requests.length);
    },
  };
  return { provider, requests };
}
