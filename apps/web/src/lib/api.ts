import {
  API_PREFIX,
  aiStatusSchema,
  authSessionResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  respondResponseSchema,
  type AiStatus,
  type AuthSessionResponse,
  type ConversationMessage,
  type HealthResponse,
  type PublicUser,
  type RespondResponse,
} from '@assistant/shared';
import { clearToken, getToken, notifyUnauthorized } from './session';

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 15_000;
/** Longer than the server's provider timeout plus one retry, so the server's answer arrives before we give up. */
const RESPOND_TIMEOUT_MS = 100_000;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Whether trying the same request again can help. Server errors say so explicitly in details.retryable. */
  get retryable(): boolean {
    const flag = (this.details as { retryable?: unknown } | undefined)?.retryable;
    return typeof flag === 'boolean' ? flag : this.code === 'network_error' || this.code === 'timeout';
  }

  get retryAfterSeconds(): number | undefined {
    const value = (this.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    return typeof value === 'number' ? value : undefined;
  }
}

interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal | undefined;
  schema?: Parser<T>;
  /** Sign-in and registration are not authenticated requests. */
  auth?: boolean;
  timeoutMs?: number;
}

async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, signal, schema, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (token) headers['authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(`${base}${API_PREFIX}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ApiError('timeout', 'The assistant took too long to answer. Please try again.', undefined, { retryable: true });
    if (signal?.aborted) throw new ApiError('cancelled', 'Cancelled.', undefined, { retryable: true });
    throw new ApiError('network_error', 'Cannot reach the server. Check your connection and try again.', undefined, { retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (res.status === 204) return undefined as T;
  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const failure = errorResponseSchema.safeParse(payload);
    if (res.status === 401 && auth) {
      clearToken();
      notifyUnauthorized();
    }
    throw new ApiError(
      failure.success ? failure.data.error.code : 'bad_response',
      failure.success ? failure.data.error.message : `The server returned an unexpected response (${res.status}).`,
      res.status,
      failure.success ? failure.data.error.details : undefined,
    );
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError('bad_response', 'The server returned a response this app does not understand.', res.status);
  return parsed.data;
}

// ---- health (public) -------------------------------------------------------------------------------------------
/** A 503 still carries a valid body describing what is wrong, so it is returned, not thrown. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 8000);
  signal?.addEventListener('abort', () => timeout.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(`${base}${API_PREFIX}/health`, { signal: timeout.signal, headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError('network_error', 'The API did not respond. Start it with npm run dev:api, or check VITE_API_BASE_URL.', undefined, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  const body: unknown = await res.json().catch(() => null);
  const health = healthResponseSchema.safeParse(body);
  if (health.success && (res.status === 200 || res.status === 503)) return health.data;

  const failure = errorResponseSchema.safeParse(body);
  throw new ApiError(
    failure.success ? failure.data.error.code : 'bad_response',
    failure.success ? failure.data.error.message : `The API returned an unexpected response (${res.status}).`,
    res.status,
  );
}

// ---- authentication (existing Phase 1 API) ------------------------------------------------------------------------
export const login = (email: string, password: string): Promise<AuthSessionResponse> =>
  apiRequest('/auth/login', { method: 'POST', body: { email, password }, schema: authSessionResponseSchema, auth: false });

export const register = (email: string, displayName: string, password: string): Promise<AuthSessionResponse> =>
  apiRequest('/auth/register', { method: 'POST', body: { email, displayName, password }, schema: authSessionResponseSchema, auth: false });

export const fetchMe = async (): Promise<PublicUser> => (await apiRequest('/auth/me', { schema: meResponseSchema })).user;

export const logout = (): Promise<void> => apiRequest<void>('/auth/logout', { method: 'POST' });

// ---- assistant ---------------------------------------------------------------------------------------------------
export const fetchAiStatus = (signal?: AbortSignal): Promise<AiStatus> => apiRequest('/assistant/ai/status', { schema: aiStatusSchema, signal });

/** Sends ONLY user/assistant messages. The server builds the system instruction and chooses the provider and model. */
export const sendConversation = (messages: readonly ConversationMessage[], signal?: AbortSignal): Promise<RespondResponse> =>
  apiRequest('/assistant/respond', { method: 'POST', body: { messages }, schema: respondResponseSchema, signal, timeoutMs: RESPOND_TIMEOUT_MS });
