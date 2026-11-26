import { MESSAGE_MAX_CHARS } from '@assistant/shared';
import { z } from 'zod';
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL, type AiConfig } from './ai/config';
import { APP_VERSION } from './version';
import { ConfigError } from './errors';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const int = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default('./data/assistant.db'),
  STORAGE_DIR: z.string().min(1).default('./data/storage'),
  CORS_ORIGINS: csv.default(['http://localhost:5173']),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 30),

  // ---- AI provider (Phase 3). Everything is off until the owner turns it on. ----
  AI_ENABLED: flag,
  AI_PROVIDER: z.enum(['gemini']).default('gemini'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'must be a plain model id such as gemini-3.8-flash').default(DEFAULT_GEMINI_MODEL),
  GEMINI_BASE_URL: z.string().min(1).default(DEFAULT_GEMINI_BASE_URL),
  GEMINI_TERMS_REVIEWED: flag,
  AI_REQUEST_TIMEOUT_MS: int(1000, 120_000, 30_000),
  AI_MAX_RETRIES: int(0, 3, 1),
  AI_RETRY_BACKOFF_MS: int(1, 30_000, 800),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_MAX_OUTPUT_TOKENS: int(16, 8192, 2048),
  AI_CONTEXT_MAX_MESSAGES: int(1, 200, 30),
  AI_CONTEXT_MAX_CHARS: int(MESSAGE_MAX_CHARS, 200_000, 24_000),
  AI_REQUESTS_PER_MINUTE: int(1, 1000, 6),
  AI_REQUESTS_PER_DAY: int(1, 100_000, 100),
  AI_TOKENS_PER_DAY: int(1000, 100_000_000, 300_000),
  AI_QUOTA_TIMEZONE: z.string().min(1).default('America/Los_Angeles'),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  host: string;
  port: number;
  databasePath: string;
  storageDir: string;
  corsOrigins: string[];
  sessionSecret: string;
  sessionTtlHours: number;
  ai: AiConfig;
  version: string;
}

/**
 * Parses raw environment values into typed config. Non-string values (such as
 * Cloudflare bindings in a Worker `env`) are ignored. Error messages name the
 * offending variables but never echo their values.
 */
export function loadConfig(raw: Record<string, unknown>): AppConfig {
  const strings = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
  );
  const parsed = envSchema.safeParse(strings);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
  }
  const e = parsed.data;

  const extra: string[] = [];
  const baseUrl = validateBaseUrl(e.GEMINI_BASE_URL, e.NODE_ENV, extra);
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: e.AI_QUOTA_TIMEZONE });
  } catch {
    extra.push('AI_QUOTA_TIMEZONE: not a valid IANA time zone');
  }
  if (extra.length > 0) throw new ConfigError(`Invalid configuration:\n  - ${extra.join('\n  - ')}`);

  const activation: AiConfig['activation'] = !e.AI_ENABLED
    ? 'disabled'
    : !e.GEMINI_API_KEY
      ? 'missing_api_key'
      : !e.GEMINI_TERMS_REVIEWED
        ? 'terms_not_reviewed'
        : 'active';

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    host: e.API_HOST,
    port: e.API_PORT,
    databasePath: e.DATABASE_PATH,
    storageDir: e.STORAGE_DIR,
    corsOrigins: e.CORS_ORIGINS,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    ai: {
      provider: e.AI_PROVIDER,
      activation,
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      baseUrl,
      timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      maxRetries: e.AI_MAX_RETRIES,
      retryBackoffMs: e.AI_RETRY_BACKOFF_MS,
      temperature: e.AI_TEMPERATURE,
      maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
      context: { maxMessages: e.AI_CONTEXT_MAX_MESSAGES, maxChars: e.AI_CONTEXT_MAX_CHARS },
      limits: { requestsPerMinute: e.AI_REQUESTS_PER_MINUTE, requestsPerDay: e.AI_REQUESTS_PER_DAY, tokensPerDay: e.AI_TOKENS_PER_DAY },
      quotaTimeZone: e.AI_QUOTA_TIMEZONE,
    },
    version: APP_VERSION,
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTPS only. Plain http is accepted solely for loopback and never in production (used to test against a local fake). */
function validateBaseUrl(raw: string, env: string, problems: string[]): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push('GEMINI_BASE_URL: not a valid URL');
    return raw;
  }
  const httpsOk = url.protocol === 'https:';
  const loopbackOk = url.protocol === 'http:' && LOOPBACK.has(url.hostname) && env !== 'production';
  if (!httpsOk && !loopbackOk) problems.push('GEMINI_BASE_URL: must be an https URL');
  if (url.username || url.password) problems.push('GEMINI_BASE_URL: must not contain credentials');
  if (url.search || url.hash) problems.push('GEMINI_BASE_URL: must not contain a query string or fragment');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
