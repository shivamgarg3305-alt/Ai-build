import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchAiStatus, login, sendConversation } from './api';
import { onUnauthorized } from './session';
import { apiError, json, mockFetch, reply, status } from '../test/helpers';

describe('api client', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the bearer token and only the messages, and validates the reply', async () => {
    localStorage.setItem('assistant.session', 'tok-abc');
    const { calls } = mockFetch({ 'POST /assistant/respond': () => json(reply('Hello, Sir.')) });
    const result = await sendConversation([{ role: 'user', content: 'hi' }]);
    expect(result.message.content).toBe('Hello, Sir.');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok-abc');
    expect(calls[0]!.body).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('rejects a reply that does not match the shared schema', async () => {
    mockFetch({ 'POST /assistant/respond': () => json({ message: { role: 'assistant' } }) });
    await expect(sendConversation([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('turns a server error into an ApiError with its code, details and retry hints', async () => {
    mockFetch({ 'POST /assistant/respond': () => apiError(429, 'ai_rate_limited', 'Slow down.', { retryable: true, retryAfterSeconds: 30 }) });
    const error = await sendConversation([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'ai_rate_limited', status: 429, retryable: true, retryAfterSeconds: 30 });
  });

  it('treats a non-JSON error body as a generic bad response', async () => {
    mockFetch({ 'GET /assistant/ai/status': () => new Response('<html>502</html>', { status: 502 }) });
    await expect(fetchAiStatus()).rejects.toMatchObject({ code: 'bad_response', status: 502 });
  });

  it('reports a network failure as retryable', async () => {
    mockFetch({ 'GET /assistant/ai/status': () => { throw new TypeError('Failed to fetch'); } });
    await expect(fetchAiStatus()).rejects.toMatchObject({ code: 'network_error', retryable: true });
  });

  it('times out a request that never answers', async () => {
    vi.useFakeTimers();
    mockFetch({ 'GET /assistant/ai/status': (call) => new Promise<Response>((_res, reject) => call.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))) });
    const pending = fetchAiStatus().catch((e: unknown) => e as ApiError);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await pending).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('signs the user out when the server rejects the stored token', async () => {
    localStorage.setItem('assistant.session', 'expired');
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    mockFetch({ 'GET /assistant/ai/status': () => apiError(401, 'invalid_session', 'Your session is invalid or has expired.') });
    await expect(fetchAiStatus()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('assistant.session')).toBeNull();
    off();
  });

  it('does not treat a wrong password as an expired session', async () => {
    localStorage.setItem('assistant.session', 'still-valid');
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    const { calls } = mockFetch({ 'POST /auth/login': () => apiError(401, 'invalid_credentials', 'Email or password is incorrect.') });
    await expect(login('a@b.test', 'wrong')).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem('assistant.session')).toBe('still-valid');
    expect(calls[0]!.headers.get('authorization')).toBeNull(); // sign-in never sends a stale token
    off();
  });

  it('parses the AI status with the shared schema', async () => {
    mockFetch({ 'GET /assistant/ai/status': () => json(status({ state: 'limit_reached' })) });
    expect((await fetchAiStatus()).state).toBe('limit_reached');
  });
});
