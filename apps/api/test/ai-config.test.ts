import { describe, expect, it } from 'vitest';
import { AiProviderRegistry } from '../src/ai/registry';
import { DEFAULT_GEMINI_MODEL } from '../src/ai/config';
import { registerAiProviders } from '../src/ai/setup';
import { loadConfig } from '../src/env';
import { ConfigError } from '../src/errors';
import { createLogger } from '../src/logger';
import { AI_KEY, SECRET } from './helpers';

const base = { SESSION_SECRET: SECRET };
const cfg = (env: Record<string, string> = {}) => loadConfig({ ...base, ...env });

describe('AI configuration', () => {
  it('is fully OFF by default, with conservative limits', () => {
    const { ai } = cfg();
    expect(ai.activation).toBe('disabled');
    expect(ai.apiKey).toBeUndefined();
    expect(ai).toMatchObject({
      provider: 'gemini', model: DEFAULT_GEMINI_MODEL, baseUrl: 'https://generativelanguage.googleapis.com',
      timeoutMs: 30_000, maxRetries: 1, temperature: 0.7, maxOutputTokens: 2048,
      limits: { requestsPerMinute: 6, requestsPerDay: 100, tokensPerDay: 300_000 },
      quotaTimeZone: 'America/Los_Angeles',
    });
  });

  it('activates only when enabled AND keyed AND the terms review is confirmed', () => {
    expect(cfg({ AI_ENABLED: 'true' }).ai.activation).toBe('missing_api_key');
    expect(cfg({ AI_ENABLED: 'true', GEMINI_API_KEY: AI_KEY }).ai.activation).toBe('terms_not_reviewed');
    expect(cfg({ AI_ENABLED: 'true', GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true' }).ai.activation).toBe('active');
    expect(cfg({ AI_ENABLED: 'false', GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true' }).ai.activation).toBe('disabled');
    expect(cfg({ GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true' }).ai.activation).toBe('disabled');
  });

  it('takes the model, limits and timeouts from configuration', () => {
    const { ai } = cfg({ GEMINI_MODEL: 'gemini-9.9-test', AI_REQUEST_TIMEOUT_MS: '5000', AI_MAX_OUTPUT_TOKENS: '512', AI_TEMPERATURE: '0.2', AI_REQUESTS_PER_DAY: '40' });
    expect(ai).toMatchObject({ model: 'gemini-9.9-test', timeoutMs: 5000, maxOutputTokens: 512, temperature: 0.2 });
    expect(ai.limits.requestsPerDay).toBe(40);
  });

  it.each(['a/b', '../x', 'model name', 'm?x=1', '-bad'])('rejects the unsafe model id %j (it goes into a URL path)', (model) => {
    expect(() => cfg({ GEMINI_MODEL: model })).toThrow(/GEMINI_MODEL/);
  });

  it('requires https for the API base URL', () => {
    expect(() => cfg({ GEMINI_BASE_URL: 'http://example.com' })).toThrow(/https/);
    expect(() => cfg({ GEMINI_BASE_URL: 'ftp://example.com' })).toThrow(/https/);
    expect(() => cfg({ GEMINI_BASE_URL: 'not a url' })).toThrow(/GEMINI_BASE_URL/);
    expect(() => cfg({ GEMINI_BASE_URL: 'https://user:pw@example.com' })).toThrow(/credentials/);
    expect(() => cfg({ GEMINI_BASE_URL: 'https://example.com/?key=abc' })).toThrow(/query string/);
    expect(cfg({ GEMINI_BASE_URL: 'https://proxy.example.com/gemini/' }).ai.baseUrl).toBe('https://proxy.example.com/gemini');
  });

  it('allows plain http only for loopback and never in production', () => {
    expect(cfg({ NODE_ENV: 'test', GEMINI_BASE_URL: 'http://127.0.0.1:9999' }).ai.baseUrl).toBe('http://127.0.0.1:9999');
    expect(() => cfg({ NODE_ENV: 'production', GEMINI_BASE_URL: 'http://127.0.0.1:9999' })).toThrow(/https/);
    expect(() => cfg({ NODE_ENV: 'test', GEMINI_BASE_URL: 'http://169.254.169.254' })).toThrow(/https/);
  });

  it('rejects out-of-range values', () => {
    expect(() => cfg({ AI_MAX_OUTPUT_TOKENS: '0' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
    expect(() => cfg({ AI_TEMPERATURE: '3' })).toThrow(/AI_TEMPERATURE/);
    expect(() => cfg({ AI_CONTEXT_MAX_CHARS: '100' })).toThrow(/AI_CONTEXT_MAX_CHARS/); // must fit one full message
    expect(() => cfg({ AI_REQUESTS_PER_MINUTE: '0' })).toThrow(/AI_REQUESTS_PER_MINUTE/);
    expect(() => cfg({ AI_QUOTA_TIMEZONE: 'Mars/Olympus' })).toThrow(/AI_QUOTA_TIMEZONE/);
  });

  it('never echoes the API key in a configuration error', () => {
    try {
      cfg({ GEMINI_API_KEY: AI_KEY, AI_TEMPERATURE: '99' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(AI_KEY);
    }
  });

  it('keeps the key out of logs even if the config object is logged', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    log.info('config', { ai: cfg({ AI_ENABLED: 'true', GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true' }).ai });
    expect(lines.join('\n')).not.toContain(AI_KEY);
    expect(lines.join('\n')).toContain('[redacted]');
  });
});

describe('provider registration', () => {
  it('registers nothing unless activation is active, so nothing can be transmitted', () => {
    const envs: Record<string, string>[] = [{}, { AI_ENABLED: 'true' }, { AI_ENABLED: 'true', GEMINI_API_KEY: AI_KEY }, { GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true' }];
    for (const env of envs) {
      const registry = new AiProviderRegistry();
      expect(registerAiProviders(registry, cfg(env))).toBe(false);
      expect(registry.list()).toEqual([]);
    }
  });

  it('registers Gemini as the default provider in the existing registry when active', () => {
    const registry = new AiProviderRegistry();
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(registerAiProviders(registry, cfg({ AI_ENABLED: 'true', GEMINI_API_KEY: AI_KEY, GEMINI_TERMS_REVIEWED: 'true', GEMINI_MODEL: 'gemini-9.9-test' }), { fetch: fakeFetch })).toBe(true);
    expect(registry.list()).toEqual(['gemini']);
    expect(registry.get().name).toBe('gemini');
    return registry.get().generate({ messages: [{ role: 'user', content: 'hi' }] }).then(() => {
      expect(fetched[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-9.9-test:generateContent');
    });
  });
});
