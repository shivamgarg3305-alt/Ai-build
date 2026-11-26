import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage } from './ConversationPage';
import { apiError, deferred, json, mockFetch, reply, status } from '../test/helpers';

beforeEach(() => localStorage.setItem('assistant.session', 'tok-123'));

const composer = () => screen.getByLabelText('Message') as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const type = (text: string) => fireEvent.change(composer(), { target: { value: text } });
const readyRoutes = (respond: Parameters<typeof mockFetch>[0][string]) => ({
  'GET /assistant/ai/status': () => json(status()),
  'POST /assistant/respond': respond,
});
async function open() {
  render(<ConversationPage />);
  await waitFor(() => expect(composer().disabled).toBe(false));
}

describe('Conversation: availability', () => {
  it('shows a loading state while it checks the assistant, with the composer off', async () => {
    const pending = deferred<Response>();
    mockFetch({ 'GET /assistant/ai/status': () => pending.promise });
    render(<ConversationPage />);
    expect(screen.getByText('Checking the assistant…')).toBeTruthy();
    expect(composer().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    pending.resolve(json(status()));
    await waitFor(() => expect(composer().disabled).toBe(false));
  });

  it('keeps sending switched off, and says why, while live AI is disabled on the server', async () => {
    const { count } = mockFetch({ 'GET /assistant/ai/status': () => json(status({ state: 'disabled', activation: 'disabled', dataNotice: null })), 'POST /assistant/respond': () => json(reply('no')) });
    render(<ConversationPage />);
    expect(await screen.findByText(/switched off on the server/)).toBeTruthy();
    expect(composer().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    fireEvent.submit(composer().closest('form')!);
    expect(count('POST /assistant/respond')).toBe(0);
  });

  it.each([
    ['missing_api_key', /no provider credentials/],
    ['terms_not_reviewed', /terms review/],
  ] as const)('explains the %s blocker', async (activation, text) => {
    mockFetch({ 'GET /assistant/ai/status': () => json(status({ state: 'disabled', activation, dataNotice: null })) });
    render(<ConversationPage />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(composer().disabled).toBe(true);
  });

  it('pauses while the provider is cooling down, and can check again', async () => {
    const calls = mockFetch({ 'GET /assistant/ai/status': () => json(status({ state: 'cooling_down', blockedUntil: '2026-11-15T23:00:00.000Z', blockedReason: 'quota_exhausted' })) });
    render(<ConversationPage />);
    expect(await screen.findByText(/paused until/)).toBeTruthy();
    expect(composer().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(calls.count('GET /assistant/ai/status')).toBe(2));
  });

  it('shows a usage-limit state', async () => {
    mockFetch({ 'GET /assistant/ai/status': () => json(status({ state: 'limit_reached' })) });
    render(<ConversationPage />);
    expect(await screen.findByText(/usage limit set for this assistant/)).toBeTruthy();
    expect(composer().disabled).toBe(true);
  });

  it('reports when the status cannot be read, and retries', async () => {
    let attempts = 0;
    mockFetch({ 'GET /assistant/ai/status': () => (++attempts === 1 ? apiError(500, 'internal_error', 'Something went wrong on the server.') : json(status())) });
    render(<ConversationPage />);
    expect(await screen.findByText('Something went wrong on the server.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(composer().disabled).toBe(false));
  });

  it('shows the data-handling notice when live AI is active', async () => {
    mockFetch(readyRoutes(() => json(reply('x'))));
    await open();
    expect(screen.getByText(/Do not enter sensitive information/)).toBeTruthy();
  });
});

describe('Conversation: sending and receiving', () => {
  it('shows the message at once, a thinking state, then the reply', async () => {
    const pending = deferred<Response>();
    const { calls } = mockFetch(readyRoutes(() => pending.promise));
    await open();

    type('Good evening');
    fireEvent.click(sendButton());

    expect(await screen.findByText('Good evening')).toBeTruthy();
    expect(composer().value).toBe(''); // cleared for the next message
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Thinking…');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

    pending.resolve(json(reply('Good evening, Sir.')));
    expect(await screen.findByText('Good evening, Sir.')).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();

    // exactly what is allowed on the wire: authenticated, only user/assistant messages, no system or provider fields
    const call = calls.find((c) => c.key === 'POST /assistant/respond')!;
    expect(call.headers.get('authorization')).toBe('Bearer tok-123');
    expect(call.body).toEqual({ messages: [{ role: 'user', content: 'Good evening' }] });
  });

  it('sends the whole visible thread, in order, with each new message', async () => {
    let n = 0;
    const { calls } = mockFetch(readyRoutes(() => json(reply(`Reply ${++n}, Sir.`))));
    await open();
    type('first');
    fireEvent.click(sendButton());
    await screen.findByText('Reply 1, Sir.');
    type('second');
    fireEvent.click(sendButton());
    await screen.findByText('Reply 2, Sir.');

    const bodies = calls.filter((c) => c.key === 'POST /assistant/respond').map((c) => c.body);
    expect(bodies[1]).toEqual({ messages: [
      { role: 'user', content: 'first' }, { role: 'assistant', content: 'Reply 1, Sir.' }, { role: 'user', content: 'second' },
    ] });
  });

  it('sends on Enter but not on Shift+Enter', async () => {
    const { count } = mockFetch(readyRoutes(() => json(reply('ok, Sir.'))));
    await open();
    type('line one');
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(count('POST /assistant/respond')).toBe(0);
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await screen.findByText('ok, Sir.');
    expect(count('POST /assistant/respond')).toBe(1);
  });

  it('never sends an empty or whitespace-only message', async () => {
    const { count } = mockFetch(readyRoutes(() => json(reply('x'))));
    await open();
    expect(sendButton().disabled).toBe(true);
    type('    ');
    expect(sendButton().disabled).toBe(true);
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(count('POST /assistant/respond')).toBe(0);
  });

  it('scrolls to the latest message as the thread grows', async () => {
    mockFetch(readyRoutes(() => json(reply('Answer, Sir.'))));
    await open();
    const scroll = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scroll.mockClear();
    type('hello');
    fireEvent.click(sendButton());
    await screen.findByText('Answer, Sir.');
    expect(scroll).toHaveBeenCalled();
  });

  it('refreshes the usage status after each exchange', async () => {
    const { count } = mockFetch(readyRoutes(() => json(reply('ok, Sir.'))));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    await screen.findByText('ok, Sir.');
    await waitFor(() => expect(count('GET /assistant/ai/status')).toBe(2));
  });
});

describe('Conversation: rendering the response honestly', () => {
  it('shows the model, usage and instruction fingerprint for traceability', async () => {
    mockFetch(readyRoutes(() => json(reply('Traced, Sir.'))));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    await screen.findByText('Traced, Sir.');
    const details = screen.getByText('Details').closest('details')!;
    fireEvent.click(screen.getByText('Details'));
    expect(within(details).getByText('gemini / gemini-3.8-flash')).toBeTruthy();
    expect(within(details).getByText('1740 (1700 in, 40 out)')).toBeTruthy();
    expect(within(details).getByText('bbbbbbbbbbbb')).toBeTruthy(); // first 12 chars of the instruction fingerprint
  });

  it('does not present a cut-off reply as finished', async () => {
    mockFetch(readyRoutes(() => json(reply('The plan starts with', { complete: false, finishReason: 'length' }))));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    expect(await screen.findByText(/cut off before it finished/)).toBeTruthy();
  });

  it('says when earlier messages were left out of what the assistant could see', async () => {
    mockFetch(readyRoutes(() => json(reply('Noted, Sir.', { context: { received: 12, sent: 8, dropped: 4, truncated: true } }))));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    expect(await screen.findByText(/4 earlier messages were left out/)).toBeTruthy();
  });

  it('renders message text as text, never as HTML', async () => {
    mockFetch(readyRoutes(() => json(reply('<img src=x onerror=alert(1)> done, Sir.'))));
    await open();
    type('hi');
    fireEvent.click(sendButton());
    await screen.findByText('<img src=x onerror=alert(1)> done, Sir.');
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('Conversation: errors and retry', () => {
  it('keeps the message, explains quota exhaustion, and offers a retry', async () => {
    let attempts = 0;
    const { calls } = mockFetch(readyRoutes(() => {
      if (++attempts === 1) return apiError(429, 'ai_quota_exhausted', "The AI provider's quota is exhausted. Your message is kept; try again after the quota resets.", { retryable: true, retryAfterSeconds: 3600 });
      return json(reply('Back again, Sir.'));
    }));
    await open();
    type('Important question');
    fireEvent.click(sendButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('quota is exhausted');
    expect(alert.textContent).toContain('about 60 minutes');
    expect(screen.getByText('Important question')).toBeTruthy(); // never lost
    expect(screen.getByText(/Retry or edit the message above/)).toBeTruthy();
    expect(sendButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Back again, Sir.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const respondCalls = calls.filter((c) => c.key === 'POST /assistant/respond');
    expect(respondCalls[1]!.body).toEqual({ messages: [{ role: 'user', content: 'Important question' }] }); // same message, once
  });

  it('reports a network failure clearly and recovers on retry', async () => {
    let attempts = 0;
    mockFetch(readyRoutes(() => {
      if (++attempts === 1) throw new TypeError('Failed to fetch');
      return json(reply('Reconnected, Sir.'));
    }));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Reconnected, Sir.')).toBeTruthy();
  });

  it('offers no retry for an error that retrying cannot fix, and lets the user edit instead', async () => {
    mockFetch(readyRoutes(() => apiError(422, 'ai_response_blocked', 'The AI provider blocked this request (SAFETY).', { retryable: false })));
    await open();
    type('Something the provider refuses');
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain('blocked');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(composer().value).toBe('Something the provider refuses'); // restored, not lost
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [503, 'ai_disabled', 'Live AI responses are switched off on this server.'],
    [503, 'ai_misconfigured', 'The AI provider rejected the server configuration.'],
    [429, 'ai_rate_limited', 'Too many requests in the last minute. Please wait a moment.'],
    [504, 'ai_timeout', 'The AI provider did not answer in time.'],
  ])('shows the server message for HTTP %i %s', async (httpStatus, code, message) => {
    mockFetch(readyRoutes(() => apiError(httpStatus, code, message, { retryable: code === 'ai_rate_limited' || code === 'ai_timeout' })));
    await open();
    type('hello');
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('lets the user stop a request in flight, keeping the message', async () => {
    const { calls } = mockFetch(readyRoutes((call) => new Promise<Response>((_resolve, reject) => {
      call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    await open();
    type('Take your time');
    fireEvent.click(sendButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Cancelled');
    expect(screen.getByText('Take your time')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /assistant/respond')!.signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
